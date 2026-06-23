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
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 3000;
const users = new Map();

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

function emitUserList() {
  io.emit("user_list", publicUsers());
}

io.on("connection", (socket) => {
  socket.on("join", async ({ name } = {}) => {
    const safeName = cleanName(name);

    if (!safeName) {
      socket.emit("join_error", { message: "Naam zaroori hai." });
      return;
    }

    const user = {
      id: socket.id,
      name: safeName,
      avatar: avatarFor(safeName),
    };

    users.set(socket.id, user);
    socket.join("group");
    socket.emit("joined", user);
    socket.emit("group_history", await getGroupHistory());

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

  socket.on("group_message", async ({ text } = {}) => {
    const user = users.get(socket.id);
    const safeText = cleanText(text);

    if (!user || !safeText) return;

    const message = await saveMessage({
      type: "group",
      senderId: user.id,
      senderName: user.name,
      text: safeText,
    });

    io.to("group").emit("group_message", message);
  });

  socket.on("private_message", async ({ toId, text } = {}) => {
    const sender = users.get(socket.id);
    const receiver = users.get(toId);
    const safeText = cleanText(text);

    if (!sender || !receiver || !safeText) return;

    const message = await saveMessage({
      type: "private",
      senderId: sender.id,
      senderName: sender.name,
      receiverId: receiver.id,
      text: safeText,
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
