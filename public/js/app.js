const socket = io();

const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");
const avatarPreview = document.getElementById("avatarPreview");
const avatarUpload = document.getElementById("avatarUpload");
const joinError = document.getElementById("joinError");
const usersList = document.getElementById("usersList");
const friendsList = document.getElementById("friendsList");
const customGroupsList = document.getElementById("customGroupsList");
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
const profileActions = document.getElementById("profileActions");
const messages = document.getElementById("messages");
const typingIndicator = document.getElementById("typingIndicator");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const emojiButton = document.getElementById("emojiButton");
const emojiPicker = document.getElementById("emojiPicker");
const voiceButton = document.getElementById("voiceButton");
const recordingStatus = document.getElementById("recordingStatus");
const menuButton = document.getElementById("menuButton");
const sidebar = document.getElementById("sidebar");
const createGroupButton = document.getElementById("createGroupButton");
const groupModal = document.getElementById("groupModal");
const groupForm = document.getElementById("groupForm");
const closeGroupModal = document.getElementById("closeGroupModal");
const groupNameInput = document.getElementById("groupNameInput");
const memberPicker = document.getElementById("memberPicker");
const memberCount = document.getElementById("memberCount");
const groupError = document.getElementById("groupError");
const presetButtons = Array.from(document.querySelectorAll(".preset-avatar"));

const avatarPresets = {
  rider: { text: "RD", gradient: "linear-gradient(135deg, #ff8a5b, #f05a88)" },
  gamer: { text: "GM", gradient: "linear-gradient(135deg, #4d7cff, #8b5cf6)" },
  star: { text: "ST", gradient: "linear-gradient(135deg, #f7c948, #ff9e43)" },
  boss: { text: "BS", gradient: "linear-gradient(135deg, #1fbd8a, #2b5bc4)" },
};

const emojis = ["😀", "😂", "😍", "😎", "🔥", "❤️", "👍", "👏", "🙌", "🎉", "😢", "😡"];

const groupUser = {
  id: "group",
  name: "Pindi Gang",
  avatar: { type: "preset", value: "boss" },
};

const state = {
  me: null,
  users: [],
  friends: new Set(),
  customGroups: [],
  chat: { type: "group", withId: null },
  groupMessages: [],
  privateMessages: new Map(),
  customGroupMessages: new Map(),
  unread: new Map(),
  customUnread: new Map(),
  groupUnread: 0,
  search: "",
  selectedAvatar: { type: "initial", value: "PB" },
  modalMode: "create",
  modalGroupId: null,
  selectedMemberIds: new Set(),
  mediaRecorder: null,
  recordedChunks: [],
  isRecording: false,
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

function activeCustomGroup() {
  return state.customGroups.find((group) => group.id === state.chat.withId);
}

function userById(id) {
  if (state.me && state.me.id === id) return state.me;
  return state.users.find((user) => user.id === id);
}

function selectedChatUser() {
  if (state.chat.type === "private") return activePrivateUser() || groupUser;
  if (state.chat.type === "customGroup") {
    const group = activeCustomGroup();
    return {
      id: group?.id || "custom",
      name: group?.name || "My Group",
      avatar: { type: "initial", value: initials(group?.name || "MG") },
    };
  }
  return groupUser;
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

function messageAvatarUser(message) {
  return userById(message.senderId) || {
    name: message.senderName,
    avatar: message.senderAvatar || { type: "initial", value: initials(message.senderName) },
  };
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

function makeTab({
  user,
  title,
  subtitle,
  active,
  unread = 0,
  onClick,
  actionLabel,
  actionTitle,
  onAction,
}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chat-tab";
  button.classList.toggle("active", Boolean(active));

  const main = document.createElement("span");
  main.className = "tab-main";
  main.appendChild(makeAvatar(user));

  const labels = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = title;
  const status = document.createElement("small");
  status.textContent = subtitle;
  labels.append(name, status);
  main.appendChild(labels);
  button.appendChild(main);

  const tools = document.createElement("span");
  tools.className = "tab-tools";

  if (unread > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = String(unread);
    tools.appendChild(badge);
  }

  if (actionLabel) {
    const action = document.createElement("span");
    action.className = "mini-action";
    action.title = actionTitle || actionLabel;
    action.textContent = actionLabel;
    action.addEventListener("click", (event) => {
      event.stopPropagation();
      onAction();
    });
    tools.appendChild(action);
  }

  if (tools.childNodes.length) button.appendChild(tools);
  button.addEventListener("click", onClick);
  return button;
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
    empty.textContent = query ? "No users" : "No online users";
    usersList.appendChild(empty);
    return;
  }

  otherUsers.forEach((user) => {
    const isFriend = state.friends.has(user.id);
    usersList.appendChild(
      makeTab({
        user,
        title: user.name,
        subtitle: isFriend ? "Friend" : "Online User",
        active: state.chat.type === "private" && state.chat.withId === user.id,
        unread: state.unread.get(user.id) || 0,
        onClick: () => openPrivateChat(user.id),
        actionLabel: isFriend ? "Added" : "+",
        actionTitle: isFriend ? "Already friend" : "Add friend",
        onAction: () => {
          if (!isFriend) socket.emit("add_friend", { userId: user.id });
        },
      })
    );
  });
}

function renderFriends() {
  friendsList.innerHTML = "";
  const friendUsers = state.users.filter((user) => state.friends.has(user.id));

  if (!friendUsers.length) {
    const empty = document.createElement("div");
    empty.className = "chat-tab empty-tab";
    empty.textContent = "No friends";
    friendsList.appendChild(empty);
    return;
  }

  friendUsers.forEach((user) => {
    friendsList.appendChild(
      makeTab({
        user,
        title: user.name,
        subtitle: "Friend",
        active: state.chat.type === "private" && state.chat.withId === user.id,
        unread: state.unread.get(user.id) || 0,
        onClick: () => openPrivateChat(user.id),
      })
    );
  });
}

function renderCustomGroups() {
  customGroupsList.innerHTML = "";

  if (!state.customGroups.length) {
    const empty = document.createElement("div");
    empty.className = "chat-tab empty-tab";
    empty.textContent = "No groups";
    customGroupsList.appendChild(empty);
    return;
  }

  state.customGroups.forEach((group) => {
    customGroupsList.appendChild(
      makeTab({
        user: { name: group.name, avatar: { type: "initial", value: initials(group.name) } },
        title: group.name,
        subtitle: `${group.members.length} members`,
        active: state.chat.type === "customGroup" && state.chat.withId === group.id,
        unread: state.customUnread.get(group.id) || 0,
        onClick: () => openCustomGroup(group.id),
        actionLabel: "+",
        actionTitle: "Add members",
        onAction: () => openGroupModal("add", group.id),
      })
    );
  });
}

function renderProfileActions() {
  profileActions.innerHTML = "";

  if (state.chat.type === "private") {
    const user = activePrivateUser();
    if (!user) return;

    const isFriend = state.friends.has(user.id);
    const friendButton = document.createElement("button");
    friendButton.type = "button";
    friendButton.className = "profile-action";
    friendButton.textContent = isFriend ? "Remove Friend" : "Add Friend";
    friendButton.addEventListener("click", () => {
      socket.emit(isFriend ? "remove_friend" : "add_friend", { userId: user.id });
    });
    profileActions.appendChild(friendButton);
    return;
  }

  if (state.chat.type === "customGroup") {
    const addMembersButton = document.createElement("button");
    addMembersButton.type = "button";
    addMembersButton.className = "profile-action";
    addMembersButton.textContent = "Add Members";
    addMembersButton.addEventListener("click", () => openGroupModal("add", state.chat.withId));
    profileActions.appendChild(addMembersButton);
    return;
  }

  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "profile-action";
  createButton.textContent = "Create Group";
  createButton.addEventListener("click", () => openGroupModal("create"));
  profileActions.appendChild(createButton);
}

function renderHeader() {
  const user = selectedChatUser();
  groupTab.classList.toggle("active", state.chat.type === "group");
  applyAvatar(chatHeaderAvatar, user);
  applyAvatar(profileAvatar, user);

  if (state.chat.type === "group") {
    chatTitle.textContent = "Pindi Gang";
    chatStatus.textContent = "Group";
    profileName.textContent = "Pindi Gang";
    profileStatus.textContent = `${state.users.length} online`;
  } else if (state.chat.type === "customGroup") {
    const group = activeCustomGroup();
    chatTitle.textContent = group?.name || "My Group";
    chatStatus.textContent = `${group?.members.length || 0} members`;
    profileName.textContent = group?.name || "My Group";
    profileStatus.textContent = "Custom Group";
  } else {
    chatTitle.textContent = user.name;
    chatStatus.textContent = "Private Chat - only you two";
    profileName.textContent = user.name;
    profileStatus.textContent = state.friends.has(user.id) ? "Friend" : "Online User";
  }

  renderProfileActions();
}

function currentMessages() {
  if (state.chat.type === "group") return state.groupMessages;
  if (state.chat.type === "customGroup") return state.customGroupMessages.get(state.chat.withId) || [];
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
      row.appendChild(makeAvatar(messageAvatarUser(message), "message-avatar"));
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

    if (message.kind === "voice" && message.mediaUrl) {
      const audio = document.createElement("audio");
      audio.className = "voice-player";
      audio.controls = true;
      audio.src = message.mediaUrl;
      bubble.appendChild(audio);
    } else {
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = message.text;
      bubble.appendChild(text);
    }

    row.appendChild(bubble);
    messages.appendChild(row);
  });

  messages.scrollTop = messages.scrollHeight;
}

function render() {
  setBadge(groupBadge, state.groupUnread);
  renderHeader();
  renderUsers();
  renderFriends();
  renderCustomGroups();
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

function openCustomGroup(groupId) {
  state.chat = { type: "customGroup", withId: groupId };
  state.customUnread.set(groupId, 0);
  typingIndicator.textContent = "";
  socket.emit("get_custom_group_history", { groupId });
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

function addCustomGroupMessage(groupId, message) {
  const existing = state.customGroupMessages.get(groupId) || [];
  state.customGroupMessages.set(groupId, [...existing, message].slice(-100));

  const isActive = state.chat.type === "customGroup" && state.chat.withId === groupId;
  if (!isActive) {
    state.customUnread.set(groupId, (state.customUnread.get(groupId) || 0) + 1);
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

function eligibleMembersForModal() {
  const currentGroup = state.modalGroupId
    ? state.customGroups.find((group) => group.id === state.modalGroupId)
    : null;
  const currentMemberIds = new Set((currentGroup?.members || []).map((member) => member.id));

  return state.users.filter((user) => {
    if (state.me && user.id === state.me.id) return false;
    if (state.modalMode === "add" && currentMemberIds.has(user.id)) return false;
    return true;
  });
}

function renderMemberPicker() {
  memberPicker.innerHTML = "";
  memberCount.textContent = `${state.selectedMemberIds.size} selected`;

  const members = eligibleMembersForModal();
  if (!members.length) {
    const empty = document.createElement("div");
    empty.className = "member-empty";
    empty.textContent = "No users";
    memberPicker.appendChild(empty);
    return;
  }

  members.forEach((user) => {
    const label = document.createElement("label");
    label.className = "member-option";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedMemberIds.has(user.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedMemberIds.add(user.id);
      else state.selectedMemberIds.delete(user.id);
      memberCount.textContent = `${state.selectedMemberIds.size} selected`;
    });

    label.append(checkbox, makeAvatar(user, "member-avatar"));

    const text = document.createElement("span");
    text.textContent = user.name;
    label.appendChild(text);
    memberPicker.appendChild(label);
  });
}

function openGroupModal(mode = "create", groupId = null) {
  state.modalMode = mode;
  state.modalGroupId = groupId;
  state.selectedMemberIds = new Set();
  groupError.textContent = "";
  groupNameInput.value = "";
  groupNameInput.disabled = mode === "add";
  groupNameInput.placeholder = mode === "add" ? "Add members" : "Group name";

  const title = groupModal.querySelector(".modal-header h2");
  const copy = groupModal.querySelector(".modal-header p");
  title.textContent = mode === "add" ? "Add Members" : "Create Group";
  copy.textContent = "Select online members.";

  renderMemberPicker();
  groupModal.classList.remove("is-hidden");
  if (mode === "create") groupNameInput.focus();
}

function closeModal() {
  groupModal.classList.add("is-hidden");
}

function sendCurrentChatMessage(payload) {
  if (state.chat.type === "group") {
    socket.emit("group_message", payload);
  } else if (state.chat.type === "customGroup") {
    socket.emit("custom_group_message", { groupId: state.chat.withId, ...payload });
  } else {
    socket.emit("private_message", { toId: state.chat.withId, ...payload });
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function stopVoiceRecording() {
  if (!state.mediaRecorder || !state.isRecording) return;
  state.mediaRecorder.stop();
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    recordingStatus.textContent = "Voice not supported in this browser.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.recordedChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) state.recordedChunks.push(event.data);
    });

    state.mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      state.isRecording = false;
      voiceButton.textContent = "Mic";
      voiceButton.classList.remove("recording");
      recordingStatus.textContent = "";

      const blob = new Blob(state.recordedChunks, { type: state.mediaRecorder.mimeType || "audio/webm" });
      if (!blob.size) return;

      const mediaUrl = await blobToDataUrl(blob);
      sendCurrentChatMessage({
        kind: "voice",
        text: "Voice message",
        mediaUrl,
      });
    });

    state.mediaRecorder.start();
    state.isRecording = true;
    voiceButton.textContent = "Stop";
    voiceButton.classList.add("recording");
    recordingStatus.textContent = "Recording...";
  } catch (_error) {
    recordingStatus.textContent = "Mic permission required.";
  }
}

function renderEmojiPicker() {
  emojiPicker.innerHTML = "";
  emojis.forEach((emoji) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.addEventListener("click", () => {
      const start = messageInput.selectionStart ?? messageInput.value.length;
      const end = messageInput.selectionEnd ?? messageInput.value.length;
      messageInput.value = `${messageInput.value.slice(0, start)}${emoji}${messageInput.value.slice(end)}`;
      messageInput.focus();
      messageInput.selectionStart = start + emoji.length;
      messageInput.selectionEnd = start + emoji.length;
      emojiPicker.classList.add("is-hidden");
    });
    emojiPicker.appendChild(button);
  });
}

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const value = button.dataset.avatar;
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
createGroupButton.addEventListener("click", () => openGroupModal("create"));
closeGroupModal.addEventListener("click", closeModal);

groupModal.addEventListener("click", (event) => {
  if (event.target === groupModal) closeModal();
});

groupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  groupError.textContent = "";
  const memberIds = Array.from(state.selectedMemberIds);

  if (state.modalMode === "add") {
    if (!memberIds.length) {
      groupError.textContent = "Kam az kam aik member select karo.";
      return;
    }
    socket.emit("add_group_members", { groupId: state.modalGroupId, memberIds });
    closeModal();
    return;
  }

  const name = groupNameInput.value.trim();
  if (!name) {
    groupError.textContent = "Group name zaroori hai.";
    return;
  }

  socket.emit("create_custom_group", { name, memberIds });
  closeModal();
});

menuButton.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

emojiButton.addEventListener("click", () => {
  emojiPicker.classList.toggle("is-hidden");
});

voiceButton.addEventListener("click", () => {
  if (state.isRecording) {
    stopVoiceRecording();
    return;
  }

  startVoiceRecording();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  sendCurrentChatMessage({ kind: "text", text });

  messageInput.value = "";
  socket.emit("typing", {
    toId: state.chat.type === "private" ? state.chat.withId : null,
    isTyping: false,
  });
});

messageInput.addEventListener("input", () => {
  if (state.chat.type === "customGroup") return;

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

socket.on("social_state", ({ friends = [], customGroups = [] }) => {
  state.friends = new Set(friends);
  state.customGroups = customGroups;

  if (
    state.chat.type === "customGroup" &&
    !state.customGroups.some((group) => group.id === state.chat.withId)
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

socket.on("custom_group_history", ({ groupId, messages: history }) => {
  state.customGroupMessages.set(groupId, history);
  render();
});

socket.on("custom_group_message", ({ groupId, message }) => {
  addCustomGroupMessage(groupId, message);
  render();
});

socket.on("custom_group_created", ({ groupId }) => {
  openCustomGroup(groupId);
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
renderEmojiPicker();
