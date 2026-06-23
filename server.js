require("dotenv").config();

const crypto = require("crypto");
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const {
  initDb,
  getAccount,
  saveAccount,
  touchAccount,
  saveFriendship,
  removeFriendship,
  getFriendIds,
  saveCustomGroup,
  addGroupMembers,
  getCustomGroup,
  getCustomGroupsForUser,
  saveMessage,
  getMessageById,
  saveMessageView,
  saveReaction,
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
const INACTIVITY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PRESENCE_SYSTEM_DELAY_MS = 30 * 1000;
const TIMED_MESSAGE_SECONDS = new Set([5, 10, 15]);
const stickerIds = new Set([
  "angry",
  "cry",
  "fire",
  "grinning",
  "handshake",
  "heart",
  "heart_eyes",
  "hundred",
  "joy",
  "party",
  "star_struck",
  "thinking",
  "wink",
]);
const users = new Map();
const socketsByUser = new Map();
const pendingPresenceLeaves = new Map();

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

function cleanPin(pin) {
  const value = String(pin || "").trim();
  return /^\d{4}$/.test(value) ? value : "";
}

function cleanText(text) {
  return String(text || "").trim().slice(0, 1000);
}

function nameKey(name) {
  return cleanName(name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
}

function hashPin(userId, pin) {
  return crypto.createHash("sha256").update(`${userId}:${pin}`).digest("hex");
}

function isInactive(account) {
  if (!account?.lastSeen) return false;
  return Date.now() - new Date(account.lastSeen).getTime() > INACTIVITY_TTL_MS;
}

function cleanMediaUrl(mediaUrl) {
  const value = String(mediaUrl || "");
  const isAudioData =
    /^data:audio\/[a-z0-9.+-]+(?:;codecs=[^;]+)?;base64,/i.test(value);
  return isAudioData && value.length < 1_500_000 ? value : "";
}

function cleanMessagePayload({ text, kind, mediaUrl, timerSeconds, oneView } = {}) {
  const safeKind = kind === "voice" || kind === "sticker" ? kind : "text";
  const safeText = cleanText(text);
  const safeTimerSeconds = Number(timerSeconds);
  const expiresAt = TIMED_MESSAGE_SECONDS.has(safeTimerSeconds)
    ? new Date(Date.now() + safeTimerSeconds * 1000).toISOString()
    : null;
  const isOneView = Boolean(oneView);
  const meta = {
    expiresAt,
    oneView: isOneView,
  };

  if (safeKind === "sticker") {
    const stickerId = safeText.replace(/[^a-z0-9_]/gi, "");
    if (!stickerIds.has(stickerId)) return null;
    return {
      kind: "sticker",
      text: stickerId,
      mediaUrl: `/stickers/fluent/${stickerId}.svg`,
      ...meta,
    };
  }

  if (safeKind === "voice") {
    const safeMediaUrl = cleanMediaUrl(mediaUrl);
    if (!safeMediaUrl) return null;
    return {
      kind: "voice",
      text: safeText || "Voice message",
      mediaUrl: safeMediaUrl,
      ...meta,
    };
  }

  if (!safeText) return null;

  return {
    kind: "text",
    text: safeText,
    mediaUrl: null,
    ...meta,
  };
}

function avatarFor(name) {
  return cleanName(name).charAt(0).toUpperCase() || "P";
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

function userRoom(userId) {
  return `user:${userId}`;
}

function onlineUserIds() {
  return Array.from(socketsByUser.keys());
}

function publicUsers() {
  return onlineUserIds()
    .map((userId) => users.get(Array.from(socketsByUser.get(userId) || [])[0]))
    .filter(Boolean)
    .map((user) => ({
      id: user.id,
      name: user.name,
      avatar: user.avatar,
    }));
}

function addOnlineSocket(socketId, user) {
  users.set(socketId, user);
  if (!socketsByUser.has(user.id)) socketsByUser.set(user.id, new Set());
  socketsByUser.get(user.id).add(socketId);
}

function removeOnlineSocket(socketId) {
  const user = users.get(socketId);
  users.delete(socketId);

  if (!user) return null;

  const socketIds = socketsByUser.get(user.id);
  let becameOffline = true;
  if (socketIds) {
    socketIds.delete(socketId);
    becameOffline = !socketIds.size;
    if (becameOffline) socketsByUser.delete(user.id);
  }

  return { user, becameOffline };
}

function firstSocketForUser(userId) {
  const socketIds = socketsByUser.get(userId);
  if (!socketIds?.size) return null;
  return users.get(Array.from(socketIds)[0]) || null;
}

async function publicGroupsFor(userId) {
  return getCustomGroupsForUser(userId);
}

async function emitUserList() {
  io.emit("user_list", publicUsers());
}

async function emitSocialState(userId) {
  io.to(userRoom(userId)).emit("social_state", {
    friends: await getFriendIds(userId),
    customGroups: await publicGroupsFor(userId),
  });
}

async function emitSocialStateForUsers(userIds) {
  await Promise.all(Array.from(userIds).map((userId) => emitSocialState(userId)));
}

function cancelPendingPresenceLeave(userId) {
  const pending = pendingPresenceLeaves.get(userId);
  if (!pending) return false;

  clearTimeout(pending);
  pendingPresenceLeaves.delete(userId);
  return true;
}

async function broadcastSystemMessage(text) {
  const systemMessage = await saveMessage({
    type: "group",
    senderId: "system",
    senderName: "System",
    text,
  });

  io.to("group").emit("group_message", {
    ...systemMessage,
    system: true,
  });
}

function schedulePresenceLeave(user) {
  cancelPendingPresenceLeave(user.id);

  const timeout = setTimeout(async () => {
    pendingPresenceLeaves.delete(user.id);
    if (socketsByUser.has(user.id)) return;

    try {
      await broadcastSystemMessage(`${user.name} left Pindi Gang`);
    } catch (error) {
      console.error("Failed to save delayed presence message", error);
    }
  }, PRESENCE_SYSTEM_DELAY_MS);

  pendingPresenceLeaves.set(user.id, timeout);
}

function makeGroupId() {
  return `room_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

async function joinCustomGroupRooms(socket, userId) {
  const groups = await getCustomGroupsForUser(userId);
  groups.forEach((group) => socket.join(group.id));
}

io.on("connection", (socket) => {
  socket.on("join", async ({ name, pin, avatar } = {}) => {
    const safeName = cleanName(name);
    const safePin = cleanPin(pin);
    const userId = nameKey(safeName);

    if (!safeName || !userId) {
      socket.emit("join_error", { message: "Name required." });
      return;
    }

    if (!safePin) {
      socket.emit("join_error", { message: "4 digit key required." });
      return;
    }

    const pinHash = hashPin(userId, safePin);
    const existingAccount = await getAccount(userId);
    const isNewAccount = !existingAccount;

    if (existingAccount && existingAccount.pinHash !== pinHash) {
      socket.emit("join_error", { message: "Wrong key for this username." });
      return;
    }

    const safeAvatar = existingAccount?.avatar || cleanAvatar(avatar, safeName);
    const account = await saveAccount({
      id: userId,
      name: existingAccount?.name || safeName,
      pinHash,
      avatar: safeAvatar,
    });

    const user = {
      id: account.id,
      name: account.name,
      avatar: account.avatar || safeAvatar,
      pinSaved: true,
    };

    const wasOnline = socketsByUser.has(user.id);
    const resumedQuickly = cancelPendingPresenceLeave(user.id);

    addOnlineSocket(socket.id, user);
    socket.join("group");
    socket.join(userRoom(user.id));
    await joinCustomGroupRooms(socket, user.id);

    socket.emit("joined", {
      ...user,
      inactivityExpiresAt: Date.now() + INACTIVITY_TTL_MS,
    });

    if (!isNewAccount || isInactive(existingAccount)) {
      socket.emit("group_history", await getGroupHistory());
    }

    await emitSocialState(user.id);

    if (!wasOnline && !resumedQuickly) {
      await broadcastSystemMessage(`${account.name} joined Pindi Gang`);
    }

    await emitUserList();
  });

  socket.on("group_message", async (payload = {}) => {
    const user = users.get(socket.id);
    const safePayload = cleanMessagePayload(payload);

    if (!user || !safePayload) return;
    await touchAccount(user.id);

    const message = await saveMessage({
      type: "group",
      kind: safePayload.kind,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
      expiresAt: safePayload.expiresAt,
      oneView: safePayload.oneView,
    });

    io.to("group").emit("group_message", message);
  });

  socket.on("custom_group_message", async ({ groupId, ...payload } = {}) => {
    const user = users.get(socket.id);
    const group = await getCustomGroup(groupId);
    const safePayload = cleanMessagePayload(payload);

    if (
      !user ||
      !group ||
      !group.members.some((member) => member.id === user.id) ||
      !safePayload
    ) {
      return;
    }

    await touchAccount(user.id);

    const message = await saveMessage({
      type: "group",
      kind: safePayload.kind,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      receiverId: group.id,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
      expiresAt: safePayload.expiresAt,
      oneView: safePayload.oneView,
    });

    io.to(group.id).emit("custom_group_message", {
      groupId: group.id,
      message,
    });
  });

  socket.on("private_message", async ({ toId, ...payload } = {}) => {
    const sender = users.get(socket.id);
    const receiver = firstSocketForUser(toId);
    const safePayload = cleanMessagePayload(payload);

    if (!sender || !receiver || !safePayload) return;
    await touchAccount(sender.id);

    const message = await saveMessage({
      type: "private",
      kind: safePayload.kind,
      senderId: sender.id,
      senderName: sender.name,
      senderAvatar: sender.avatar,
      receiverId: receiver.id,
      text: safePayload.text,
      mediaUrl: safePayload.mediaUrl,
      expiresAt: safePayload.expiresAt,
      oneView: safePayload.oneView,
    });

    socket.emit("private_message", message);
    socket.to(userRoom(receiver.id)).emit("private_message", message);
    socket.to(userRoom(receiver.id)).emit("private_notify", {
      fromId: sender.id,
      fromName: sender.name,
    });
  });

  socket.on("get_private_history", async ({ withId } = {}) => {
    const user = users.get(socket.id);
    const other = await getAccount(withId);

    if (!user || !other) return;

    socket.emit("private_history", {
      withId,
      messages: await getPrivateHistory(user.id, withId),
    });
  });

  socket.on("add_friend", async ({ userId } = {}) => {
    const user = users.get(socket.id);
    const other = firstSocketForUser(userId);

    if (!user || !other || user.id === other.id) return;
    await touchAccount(user.id);
    await saveFriendship(user.id, other.id);
    await emitSocialState(user.id);
    await emitSocialState(other.id);
  });

  socket.on("remove_friend", async ({ userId } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    await removeFriendship(user.id, userId);
    await emitSocialState(user.id);
    await emitSocialState(userId);
  });

  socket.on("create_custom_group", async ({ name, memberIds = [] } = {}) => {
    const user = users.get(socket.id);
    const safeName = cleanName(name);
    if (!user || !safeName) return;

    await touchAccount(user.id);

    const members = new Set([user.id]);
    memberIds.forEach((memberId) => {
      if (firstSocketForUser(memberId)) members.add(memberId);
    });

    const group = {
      id: makeGroupId(),
      name: safeName,
      ownerId: user.id,
      members,
    };

    await saveCustomGroup({
      id: group.id,
      name: group.name,
      ownerId: group.ownerId,
      memberIds: Array.from(members),
    });

    members.forEach((memberId) => {
      const socketIds = socketsByUser.get(memberId) || [];
      socketIds.forEach((socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (memberSocket) memberSocket.join(group.id);
      });
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

    await emitSocialStateForUsers(members);
    socket.emit("custom_group_created", { groupId: group.id });
  });

  socket.on("add_group_members", async ({ groupId, memberIds = [] } = {}) => {
    const user = users.get(socket.id);
    const group = await getCustomGroup(groupId);
    if (!user || !group || !group.members.some((member) => member.id === user.id)) return;

    await touchAccount(user.id);

    const existingMemberIds = new Set(group.members.map((member) => member.id));
    const addedUsers = memberIds
      .map((memberId) => firstSocketForUser(memberId))
      .filter((member) => member && !existingMemberIds.has(member.id));

    if (!addedUsers.length) return;

    await addGroupMembers(
      group.id,
      addedUsers.map((member) => member.id)
    );

    addedUsers.forEach((member) => {
      const socketIds = socketsByUser.get(member.id) || [];
      socketIds.forEach((socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        if (memberSocket) memberSocket.join(group.id);
      });
    });

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

    const updatedGroup = await getCustomGroup(group.id);
    await emitSocialStateForUsers(updatedGroup.members.map((member) => member.id));
  });

  socket.on("get_custom_group_history", async ({ groupId } = {}) => {
    const user = users.get(socket.id);
    const group = await getCustomGroup(groupId);
    if (!user || !group || !group.members.some((member) => member.id === user.id)) return;

    socket.emit("custom_group_history", {
      groupId,
      messages: await getGroupHistory(groupId),
    });
  });

  socket.on("typing", async ({ toId, isTyping } = {}) => {
    const user = users.get(socket.id);
    if (!user) return;
    await touchAccount(user.id);

    if (toId) {
      socket.to(userRoom(toId)).emit("typing", {
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

  socket.on("react_message", async ({ messageId, emoji } = {}) => {
    const user = users.get(socket.id);
    const safeEmoji = String(emoji || "").trim().slice(0, 8);
    const message = await getMessageById(messageId);

    if (!user || !message || !safeEmoji) return;
    await touchAccount(user.id);

    const reactions = await saveReaction({
      messageId: message.id,
      userId: user.id,
      emoji: safeEmoji,
    });

    const payload = {
      messageId: message.id,
      reactions,
    };

    if (message.type === "private") {
      io.to(userRoom(message.senderId)).emit("message_reactions", payload);
      io.to(userRoom(message.receiverId)).emit("message_reactions", payload);
      return;
    }

    io.to(message.receiverId || "group").emit("message_reactions", payload);
  });

  socket.on("view_message", async ({ messageId } = {}) => {
    const user = users.get(socket.id);
    const message = await getMessageById(messageId);

    if (!user || !message || message.senderId === user.id || !message.oneView) return;

    if (message.type === "private") {
      const canView = message.senderId === user.id || message.receiverId === user.id;
      if (!canView) return;
    } else if (message.receiverId && message.receiverId !== "group") {
      const group = await getCustomGroup(message.receiverId);
      if (!group?.members.some((member) => member.id === user.id)) return;
    }

    await saveMessageView({ messageId: message.id, userId: user.id });
  });

  socket.on("disconnect", async () => {
    const presence = removeOnlineSocket(socket.id);

    if (!presence) return;

    if (presence.becameOffline) {
      schedulePresenceLeave(presence.user);
    }

    await emitUserList();
  });

  socket.on("logout", async () => {
    const presence = removeOnlineSocket(socket.id);
    if (!presence) {
      socket.emit("logged_out");
      socket.disconnect(true);
      return;
    }

    cancelPendingPresenceLeave(presence.user.id);
    if (presence.becameOffline) {
      await broadcastSystemMessage(`${presence.user.name} left Pindi Gang`);
    }

    await emitUserList();
    socket.emit("logged_out");
    socket.disconnect(true);
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
