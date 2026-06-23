const socket = io();

const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");
const avatarPreview = document.getElementById("avatarPreview");
const avatarUpload = document.getElementById("avatarUpload");
const joinError = document.getElementById("joinError");
const usersList = document.getElementById("usersList");
const onlineCount = document.getElementById("onlineCount");
const searchInput = document.getElementById("searchInput");
const groupTab = document.getElementById("groupTab");
const groupBadge = document.getElementById("groupBadge");
const chatHeaderAvatar = document.getElementById("chatHeaderAvatar");
const chatTitle = document.getElementById("chatTitle");
const chatStatus = document.getElementById("chatStatus");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileStatus = document.getElementById("profileStatus");
const messages = document.getElementById("messages");
const typingIndicator = document.getElementById("typingIndicator");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const menuButton = document.getElementById("menuButton");
const sidebar = document.getElementById("sidebar");
const presetButtons = Array.from(document.querySelectorAll(".preset-avatar"));

const avatarPresets = {
  rider: { text: "RD", gradient: "linear-gradient(135deg, #ff8a5b, #f05a88)" },
  gamer: { text: "GM", gradient: "linear-gradient(135deg, #4d7cff, #8b5cf6)" },
  star: { text: "ST", gradient: "linear-gradient(135deg, #f7c948, #ff9e43)" },
  boss: { text: "BS", gradient: "linear-gradient(135deg, #1fbd8a, #2b5bc4)" },
};

const groupUser = {
  id: "group",
  name: "Pindi Gang",
  avatar: { type: "preset", value: "boss" },
};

const state = {
  me: null,
  users: [],
  chat: { type: "group", withId: null },
  groupMessages: [],
  privateMessages: new Map(),
  unread: new Map(),
  groupUnread: 0,
  search: "",
  selectedAvatar: { type: "initial", value: "PB" },
  uploadedImage: "",
  typingTimeout: null,
  typingClearTimeout: null,
};

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function initials(name) {
  return String(name || "PB")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
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

function userById(id) {
  if (state.me && state.me.id === id) return state.me;
  return state.users.find((user) => user.id === id);
}

function selectedChatUser() {
  return state.chat.type === "group" ? groupUser : activePrivateUser() || groupUser;
}

function setBadge(element, count) {
  element.textContent = String(count);
  element.classList.toggle("is-hidden", count <= 0);
}

function avatarDataFor(user) {
  const avatar = user && user.avatar ? user.avatar : { type: "initial", value: initials(user?.name) };
  if (avatar.type === "image" && avatar.value) return avatar;
  if (avatar.type === "preset" && avatarPresets[avatar.value]) return avatar;
  return { type: "initial", value: initials(user?.name || avatar.value) };
}

function applyAvatar(el, user) {
  const data = avatarDataFor(user);
  el.innerHTML = "";
  el.style.background = "";

  if (data.type === "image") {
    const image = document.createElement("img");
    image.alt = `${user?.name || "User"} avatar`;
    image.src = data.value;
    el.appendChild(image);
    return el;
  }

  if (data.type === "preset") {
    const preset = avatarPresets[data.value];
    el.style.background = preset.gradient;
    el.textContent = preset.text;
    return el;
  }

  el.textContent = data.value || initials(user?.name);
  return el;
}

function makeAvatar(user, className = "") {
  const avatar = document.createElement("span");
  avatar.className = `avatar ${className}`.trim();
  return applyAvatar(avatar, user);
}

function renderAvatarPreview() {
  applyAvatar(avatarPreview, {
    name: nameInput.value || "PindiBoys",
    avatar: state.selectedAvatar,
  });
}

function setActivePreset(value) {
  presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.avatar === value);
  });
}

function renderUsers() {
  const query = state.search.toLowerCase();
  const otherUsers = state.users
    .filter((user) => !state.me || user.id !== state.me.id)
    .filter((user) => user.name.toLowerCase().includes(query));

  usersList.innerHTML = "";
  onlineCount.textContent = `${state.users.length} online`;

  if (!otherUsers.length) {
    const empty = document.createElement("div");
    empty.className = "chat-tab empty-tab";
    empty.textContent = query ? "Koi user nahi mila." : "Abhi sirf aap online ho.";
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
    main.appendChild(makeAvatar(user));

    const labels = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = user.name;
    const status = document.createElement("small");
    status.textContent = "Private Chat";

    labels.append(name, status);
    main.appendChild(labels);
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
  const user = selectedChatUser();
  groupTab.classList.toggle("active", state.chat.type === "group");
  applyAvatar(chatHeaderAvatar, user);
  applyAvatar(profileAvatar, user);

  if (state.chat.type === "group") {
    chatTitle.textContent = "Pindi Gang";
    chatStatus.textContent = "Group chat active";
    profileName.textContent = "Pindi Gang";
    profileStatus.textContent = `${state.users.length} boys online`;
    return;
  }

  chatTitle.textContent = user.name;
  chatStatus.textContent = "Private Chat - only you two";
  profileName.textContent = user.name;
  profileStatus.textContent = "Private Chat";
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

    const showAvatar = !isMine(message) && message.senderId !== "system";
    if (showAvatar) {
      row.appendChild(makeAvatar(userById(message.senderId) || { name: message.senderName }, "message-avatar"));
    }

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

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 256;
        canvas.width = size;
        canvas.height = size;

        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const x = (size - width) / 2;
        const y = (size - height) / 2;

        ctx.drawImage(image, x, y, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.avatar;
    state.uploadedImage = "";
    avatarUpload.value = "";

    if (value === "initial") {
      state.selectedAvatar = { type: "initial", value: initials(nameInput.value || "PB") };
    } else {
      state.selectedAvatar = { type: "preset", value };
    }

    setActivePreset(value);
    renderAvatarPreview();
  });
});

avatarUpload.addEventListener("change", async () => {
  const file = avatarUpload.files && avatarUpload.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    setJoinError("Sirf image file upload ho sakti hai.");
    return;
  }

  try {
    const imageData = await resizeImage(file);
    state.uploadedImage = imageData;
    state.selectedAvatar = { type: "image", value: imageData };
    setActivePreset("");
    setJoinError("");
    renderAvatarPreview();
  } catch (_error) {
    setJoinError("Image read nahi ho saki. Dusri image try karo.");
  }
});

nameInput.addEventListener("input", () => {
  if (state.selectedAvatar.type === "initial") {
    state.selectedAvatar = { type: "initial", value: initials(nameInput.value || "PB") };
    renderAvatarPreview();
  }
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim();
  renderUsers();
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = nameInput.value.trim();

  if (!name) {
    setJoinError("Naam likhna zaroori hai.");
    return;
  }

  setJoinError("");
  socket.emit("join", { name, avatar: state.selectedAvatar });
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

renderAvatarPreview();
