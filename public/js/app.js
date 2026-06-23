const socket = io();

const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");
const joinError = document.getElementById("joinError");
const usersList = document.getElementById("usersList");
const onlineCount = document.getElementById("onlineCount");
const groupTab = document.getElementById("groupTab");
const groupBadge = document.getElementById("groupBadge");
const chatTitle = document.getElementById("chatTitle");
const chatStatus = document.getElementById("chatStatus");
const messages = document.getElementById("messages");
const typingIndicator = document.getElementById("typingIndicator");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const menuButton = document.getElementById("menuButton");
const sidebar = document.getElementById("sidebar");

const state = {
  me: null,
  users: [],
  chat: { type: "group", withId: null },
  groupMessages: [],
  privateMessages: new Map(),
  unread: new Map(),
  groupUnread: 0,
  typingTimeout: null,
  typingClearTimeout: null,
};

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setJoinError(message) {
  joinError.textContent = message || "";
}

function isMine(message) {
  return state.me && message.senderId === state.me.id;
}

function activePrivateUser() {
  return state.users.find((user) => user.id === state.chat.withId);
}

function setBadge(element, count) {
  element.textContent = String(count);
  element.classList.toggle("is-hidden", count <= 0);
}

function renderUsers() {
  const otherUsers = state.users.filter((user) => !state.me || user.id !== state.me.id);
  usersList.innerHTML = "";
  onlineCount.textContent = `${state.users.length} online`;

  if (!otherUsers.length) {
    const empty = document.createElement("div");
    empty.className = "chat-tab";
    empty.textContent = "Abhi sirf aap online ho.";
    usersList.appendChild(empty);
    return;
  }

  otherUsers.forEach((user) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-tab";
    button.classList.toggle(
      "active",
      state.chat.type === "private" && state.chat.withId === user.id
    );

    const main = document.createElement("span");
    main.className = "tab-main";

    const avatar = document.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = user.avatar;

    const labels = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = user.name;
    const status = document.createElement("small");
    status.textContent = "Private Chat";

    labels.append(name, status);
    main.append(avatar, labels);
    button.appendChild(main);

    const unreadCount = state.unread.get(user.id) || 0;
    if (unreadCount > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = String(unreadCount);
      button.appendChild(badge);
    }

    button.addEventListener("click", () => openPrivateChat(user.id));
    usersList.appendChild(button);
  });
}

function renderHeader() {
  groupTab.classList.toggle("active", state.chat.type === "group");

  if (state.chat.type === "group") {
    chatTitle.textContent = "Pindi Gang";
    chatStatus.textContent = "Group chat active";
    return;
  }

  const user = activePrivateUser();
  chatTitle.textContent = user ? user.name : "Private Chat";
  chatStatus.textContent = "Private Chat - only you two";
}

function currentMessages() {
  if (state.chat.type === "group") return state.groupMessages;
  return state.privateMessages.get(state.chat.withId) || [];
}

function renderMessages() {
  messages.innerHTML = "";

  currentMessages().forEach((message) => {
    const row = document.createElement("div");
    row.className = "message-row";
    row.classList.toggle("mine", isMine(message));
    row.classList.toggle("system", Boolean(message.system) || message.senderId === "system");

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (!message.system && message.senderId !== "system") {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      const sender = document.createElement("span");
      sender.textContent = isMine(message) ? "You" : message.senderName;
      const time = document.createElement("span");
      time.textContent = formatTime(message.createdAt);
      meta.append(sender, time);
      bubble.appendChild(meta);
    }

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text;
    bubble.appendChild(text);
    row.appendChild(bubble);
    messages.appendChild(row);
  });

  messages.scrollTop = messages.scrollHeight;
}

function render() {
  setBadge(groupBadge, state.groupUnread);
  renderHeader();
  renderUsers();
  renderMessages();
}

function openGroupChat() {
  state.chat = { type: "group", withId: null };
  state.groupUnread = 0;
  typingIndicator.textContent = "";
  sidebar.classList.remove("open");
  render();
}

function openPrivateChat(withId) {
  state.chat = { type: "private", withId };
  state.unread.set(withId, 0);
  typingIndicator.textContent = "";
  socket.emit("get_private_history", { withId });
  sidebar.classList.remove("open");
  render();
}

function addPrivateMessage(message) {
  const otherId = isMine(message) ? message.receiverId : message.senderId;
  const existing = state.privateMessages.get(otherId) || [];
  state.privateMessages.set(otherId, [...existing, message]);

  const isActivePrivate = state.chat.type === "private" && state.chat.withId === otherId;
  if (!isActivePrivate && !isMine(message)) {
    state.unread.set(otherId, (state.unread.get(otherId) || 0) + 1);
  }
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();

  if (!name) {
    setJoinError("Naam likhna zaroori hai.");
    return;
  }

  setJoinError("");
  socket.emit("join", { name });
});

groupTab.addEventListener("click", openGroupChat);

menuButton.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  if (state.chat.type === "group") {
    socket.emit("group_message", { text });
  } else {
    socket.emit("private_message", { toId: state.chat.withId, text });
  }

  messageInput.value = "";
  socket.emit("typing", {
    toId: state.chat.type === "private" ? state.chat.withId : null,
    isTyping: false,
  });
});

messageInput.addEventListener("input", () => {
  socket.emit("typing", {
    toId: state.chat.type === "private" ? state.chat.withId : null,
    isTyping: true,
  });

  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    socket.emit("typing", {
      toId: state.chat.type === "private" ? state.chat.withId : null,
      isTyping: false,
    });
  }, 1200);
});

socket.on("joined", (user) => {
  state.me = user;
  joinScreen.classList.add("is-hidden");
  chatScreen.classList.remove("is-hidden");
  messageInput.focus();
});

socket.on("join_error", ({ message }) => {
  setJoinError(message);
});

socket.on("user_list", (users) => {
  state.users = users;

  if (
    state.chat.type === "private" &&
    !state.users.some((user) => user.id === state.chat.withId)
  ) {
    openGroupChat();
    return;
  }

  render();
});

socket.on("group_history", (history) => {
  state.groupMessages = history;
  render();
});

socket.on("group_message", (message) => {
  state.groupMessages.push(message);
  state.groupMessages = state.groupMessages.slice(-50);

  if (state.chat.type !== "group") {
    state.groupUnread += 1;
  }

  render();
});

socket.on("private_history", ({ withId, messages: history }) => {
  state.privateMessages.set(withId, history);
  render();
});

socket.on("private_message", (message) => {
  addPrivateMessage(message);
  render();
});

socket.on("private_notify", () => {
  render();
});

socket.on("typing", ({ scope, fromId, name, isTyping }) => {
  const isRelevantGroup = state.chat.type === "group" && scope === "group";
  const isRelevantPrivate =
    state.chat.type === "private" && scope === "private" && state.chat.withId === fromId;

  if (!isRelevantGroup && !isRelevantPrivate) return;

  clearTimeout(state.typingClearTimeout);
  typingIndicator.textContent = isTyping ? `${name} likh raha hai...` : "";

  if (isTyping) {
    state.typingClearTimeout = setTimeout(() => {
      typingIndicator.textContent = "";
    }, 2000);
  }
});
