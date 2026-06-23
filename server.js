require("dotenv").config();

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  initDb,
  saveMessage,
  getGroupHistory,
  getPrivateHistory,
} = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 2_000_000,
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3000;
const users = new Map();
const friends = new Map();
const customGroups = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, users: users.size });
});

function cleanName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function cleanText(text) {
  return String(text || "").trim().slice(0, 1000);
}

function cleanMediaUrl(mediaUrl) {
  const value = String(mediaUrl || "");
  const isAudioData = /^data:audio\/(webm|ogg|mpeg|mp4|wav);base64,/i.test(value);
  return isAudioData && value.length < 1_500_000 ? value : "";
}

function cleanMessagePayload({ text, kind, mediaUrl } = {}) {
  const safeKind = kind === "voice" ? "voice" : "text";
  const safeText = cleanText(text);

  if (safeKind === "voice") {
    const safeMediaUrl = cleanMediaUrl(mediaUrl);
    if (!safeMediaUrl) return null;
    return {
      kind: "voice",
      text: safeText || "Voice message",
      mediaUrl: safeMediaUrl,
    };
  }

  if (!safeText) return null;

  return {
    kind: "text",
    text: safeText,
    mediaUrl: null,
  };
}

function cleanAvatar(avatar, name) {
  const initialAvatar = {
    type: "initial",
    value: avatarFor(name),
  };

  if (!avatar || typeof avatar !== "object") return initialAvatar;

  if (avatar.type === "preset") {
    const value = String(avatar.value || "").trim().slice(0, 24);
    return value ? { type: "preset", value } : initialAvatar;
  }

  if (avatar.type === "image") {
    const value = String(avatar.value || "");
    const isImageData = /^data:image\/(png|jpe?g|webp);base64,/i.test(value);
    return isImageData && value.length < 350000 ? { type: "image", value } : initialAvatar;
  }

  return initialAvatar;
}

function avatarFor(name) {
  return cleanName(name).charAt(0).toUpperCase() || "P";
}

function publicUsers() {
  return Array.from(users.values()).map((user) => ({
    id: user.id,
    name: user.name,
    avatar: user.avatar,
  }));
}

function publicGroupsFor(userId) {
  return Array.from(customGroups.values())
    .filter((group) => group.members.has(userId))
    .map((group) => ({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      members: Array.from(group.members)
        .map((memberId) => users.get(memberId))
        .filter(Boolean)
        .map((member) => ({
          id: member.id,
          name: member.name,
          avatar: member.avatar,
        })),
    }));
}

function publicFriendIds(userId) {
  return Array.from(friends.get(userId) || []);
}

function emitUserList() {
  io.emit("user_list", publicUsers());
}

function emitSocialState(userId) {
  io.to(userId).emit("social_state", {
    friends: publicFriendIds(userId),
    customGroups: publicGroupsFor(userId),
  });
}

function emitSocialStateForUsers(userIds) {
  userIds.forEach((userId) => emitSocialState(userId));
}

function addFriendship(userA, userB) {
  if (!friends.has(userA)) friends.set(userA, new Set());
  if (!friends.has(userB)) friends.set(userB, new Set());
  friends.get(userA).add(userB);
  friends.get(userB).add(userA);
}

function removeFromSocialState(userId) {
  friends.delete(userId);
  friends.forEach((friendSet) => friendSet.delete(userId));

  customGroups.forEach((group) => {
    group.members.delete(userId);
    if (group.ownerId === userId || group.members.size === 0) {
      customGroups.delete(group.id);
      return;
    }
    emitSocialStateForUsers(group.members);
  });
}

function makeGroupId() {
  return `room_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

io.on("connection", (socket) => {
  socket.on("join", async ({ name, avatar } = {}) => {
    const safeName = cleanName(name);

    if (!safeName) {
      socket.emit("join_error", { message: "Naam zaroori hai." });
      return;
    }

    const user = {
      id: socket.id,
      name: safeName,
      avatar: cleanAvatar(avatar, safeName),
    };

    users.set(socket.id, user);
    friends.set(socket.id, new Set());
    socket.join("group");
    socket.emit("joined", user);
    emitSocialState(socket.id);

    const systemMessage = await saveMessage({
      type: "group",
      senderId: "system",
      senderName: "System",
      text: `${safeName} joined Pindi Gang`,
    });

    socket.to("group").emit("group_message", {
      ...systemMessage,
      system: true,
    });

    emitUserList();
  });

  socket.on("group_message", async (payload = {}) => {
    const user = users.get(socket.id);
    const safePayload = cleanMessagePayload(payload);

    if (!user || !safePayload) return;

    const message = await saveMessage({
      type: "group",
      kind: safePayload.kind,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
    });

    io.to("group").emit("group_message", message);
  });

  socket.on("custom_group_message", async ({ groupId, ...payload } = {}) => {
    const user = users.get(socket.id);
    const group = customGroups.get(groupId);
    const safePayload = cleanMessagePayload(payload);

    if (!user || !group || !group.members.has(socket.id) || !safePayload) return;

    const message = await saveMessage({
      type: "group",
      kind: safePayload.kind,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      receiverId: group.id,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
    });

    io.to(group.id).emit("custom_group_message", {
      groupId: group.id,
      message,
    });
  });

  socket.on("private_message", async ({ toId, ...payload } = {}) => {
    const sender = users.get(socket.id);
    const receiver = users.get(toId);
    const safePayload = cleanMessagePayload(payload);

    if (!sender || !receiver || !safePayload) return;

    const message = await saveMessage({
      type: "private",
      kind: safePayload.kind,
      senderId: sender.id,
      senderName: sender.name,
      senderAvatar: sender.avatar,
      receiverId: receiver.id,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
    });

    socket.emit("private_message", message);
    socket.to(receiver.id).emit("private_message", message);
    socket.to(receiver.id).emit("private_notify", {
      fromId: sender.id,
      fromName: sender.name,
    });
  });

  socket.on("get_private_history", async ({ withId } = {}) => {
    const user = users.get(socket.id);
    const other = users.get(withId);

    if (!user || !other) return;

    socket.emit("private_history", {
      withId,
      messages: await getPrivateHistory(user.id, withId),
    });
  });

  socket.on("add_friend", ({ userId } = {}) => {
    const user = users.get(socket.id);
    const other = users.get(userId);
    if (!user || !other || user.id === other.id) return;

    addFriendship(user.id, other.id);
    emitSocialState(user.id);
    emitSocialState(other.id);
  });

  socket.on("remove_friend", ({ userId } = {}) => {
    if (friends.has(socket.id)) friends.get(socket.id).delete(userId);
    if (friends.has(userId)) friends.get(userId).delete(socket.id);
    emitSocialState(socket.id);
    emitSocialState(userId);
  });

  socket.on("create_custom_group", async ({ name, memberIds = [] } = {}) => {
    const user = users.get(socket.id);
    const safeName = cleanName(name);
    if (!user || !safeName) return;

    const members = new Set([socket.id]);
    memberIds.forEach((memberId) => {
      if (users.has(memberId)) members.add(memberId);
    });

    const group = {
      id: makeGroupId(),
      name: safeName,
      ownerId: socket.id,
      members,
    };

    customGroups.set(group.id, group);
    members.forEach((memberId) => {
      const memberSocket = io.sockets.sockets.get(memberId);
      if (memberSocket) memberSocket.join(group.id);
    });

    const systemMessage = await saveMessage({
      type: "group",
      senderId: "system",
      senderName: "System",
      receiverId: group.id,
      text: `${user.name} created ${group.name}`,
    });

    io.to(group.id).emit("custom_group_message", {
      groupId: group.id,
      message: { ...systemMessage, system: true },
    });

    emitSocialStateForUsers(members);
    socket.emit("custom_group_created", { groupId: group.id });
  });

  socket.on("add_group_members", async ({ groupId, memberIds = [] } = {}) => {
    const user = users.get(socket.id);
    const group = customGroups.get(groupId);
    if (!user || !group || !group.members.has(socket.id)) return;

    const addedUsers = [];
    memberIds.forEach((memberId) => {
      const member = users.get(memberId);
      if (!member || group.members.has(memberId)) return;
      group.members.add(memberId);
      const memberSocket = io.sockets.sockets.get(memberId);
      if (memberSocket) memberSocket.join(group.id);
      addedUsers.push(member);
    });

    if (!addedUsers.length) return;

    const systemMessage = await saveMessage({
      type: "group",
      senderId: "system",
      senderName: "System",
      receiverId: group.id,
      text: `${user.name} added ${addedUsers.map((member) => member.name).join(", ")}`,
    });

    io.to(group.id).emit("custom_group_message", {
      groupId: group.id,
      message: { ...systemMessage, system: true },
    });

    emitSocialStateForUsers(group.members);
  });

  socket.on("get_custom_group_history", async ({ groupId } = {}) => {
    const user = users.get(socket.id);
    const group = customGroups.get(groupId);
    if (!user || !group || !group.members.has(socket.id)) return;

    socket.emit("custom_group_history", {
      groupId,
      messages: await getGroupHistory(groupId),
    });
  });

  socket.on("typing", ({ toId, isTyping } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (toId) {
      socket.to(toId).emit("typing", {
        scope: "private",
        fromId: user.id,
        name: user.name,
        isTyping: Boolean(isTyping),
      });
      return;
    }

    socket.to("group").emit("typing", {
      scope: "group",
      fromId: user.id,
      name: user.name,
      isTyping: Boolean(isTyping),
    });
  });

  socket.on("disconnect", async () => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    removeFromSocialState(socket.id);

    if (!user) return;

    const systemMessage = await saveMessage({
      type: "group",
      senderId: "system",
      senderName: "System",
      text: `${user.name} left Pindi Gang`,
    });

    socket.to("group").emit("group_message", {
      ...systemMessage,
      system: true,
    });

    emitUserList();
  });
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`PindiBoys running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
