const { Pool } = require("pg");

const hasDatabase = Boolean(process.env.DATABASE_URL);

const pool = hasDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    })
  : null;

const memoryMessages = [];
const memoryAccounts = new Map();
const memoryFriends = new Set();
const memoryGroups = new Map();
const memoryGroupMembers = new Map();

async function initDb() {
  if (!pool) {
    console.log("DATABASE_URL not found. Using in-memory messages for local dev.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      type VARCHAR(10) NOT NULL,
      sender_id VARCHAR(100),
      sender_name VARCHAR(50) NOT NULL,
      receiver_id VARCHAR(100),
      text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS kind VARCHAR(20) DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS media_url TEXT,
    ADD COLUMN IF NOT EXISTS sender_avatar TEXT;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      pin_hash VARCHAR(100) NOT NULL,
      avatar TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_seen TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      user_id VARCHAR(50) NOT NULL,
      friend_id VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, friend_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_groups (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(50) NOT NULL,
      owner_id VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id VARCHAR(100) NOT NULL,
      user_id VARCHAR(50) NOT NULL,
      joined_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
  `);
}

function parseAvatar(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeAccount(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    pinHash: row.pin_hash,
    avatar: parseAvatar(row.avatar),
    createdAt: row.created_at,
    lastSeen: row.last_seen,
  };
}

function friendshipKey(userA, userB) {
  return [userA, userB].sort().join("::");
}

async function getAccount(id) {
  if (!pool) {
    return normalizeAccount(memoryAccounts.get(id));
  }

  const result = await pool.query("SELECT * FROM accounts WHERE id = $1", [id]);
  return normalizeAccount(result.rows[0]);
}

async function saveAccount({ id, name, pinHash, avatar }) {
  const avatarValue = avatar ? JSON.stringify(avatar) : null;

  if (!pool) {
    const existing = memoryAccounts.get(id);
    const account = {
      id,
      name,
      pin_hash: pinHash,
      avatar: avatarValue,
      created_at: existing?.created_at || new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };
    memoryAccounts.set(id, account);
    return normalizeAccount(account);
  }

  const result = await pool.query(
    `
      INSERT INTO accounts (id, name, pin_hash, avatar)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id)
      DO UPDATE SET name = EXCLUDED.name, avatar = COALESCE(EXCLUDED.avatar, accounts.avatar), last_seen = NOW()
      RETURNING *
    `,
    [id, name, pinHash, avatarValue]
  );

  return normalizeAccount(result.rows[0]);
}

async function touchAccount(id) {
  if (!pool) {
    const account = memoryAccounts.get(id);
    if (account) account.last_seen = new Date().toISOString();
    return;
  }

  await pool.query("UPDATE accounts SET last_seen = NOW() WHERE id = $1", [id]);
}

async function saveFriendship(userA, userB) {
  if (!pool) {
    memoryFriends.add(friendshipKey(userA, userB));
    return;
  }

  await pool.query(
    `
      INSERT INTO friendships (user_id, friend_id)
      VALUES ($1, $2), ($2, $1)
      ON CONFLICT DO NOTHING
    `,
    [userA, userB]
  );
}

async function removeFriendship(userA, userB) {
  if (!pool) {
    memoryFriends.delete(friendshipKey(userA, userB));
    return;
  }

  await pool.query(
    "DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)",
    [userA, userB]
  );
}

async function getFriendIds(userId) {
  if (!pool) {
    return Array.from(memoryFriends)
      .map((key) => key.split("::"))
      .filter(([a, b]) => a === userId || b === userId)
      .map(([a, b]) => (a === userId ? b : a));
  }

  const result = await pool.query("SELECT friend_id FROM friendships WHERE user_id = $1", [userId]);
  return result.rows.map((row) => row.friend_id);
}

async function saveCustomGroup({ id, name, ownerId, memberIds }) {
  if (!pool) {
    memoryGroups.set(id, {
      id,
      name,
      owner_id: ownerId,
      created_at: new Date().toISOString(),
    });
    memoryGroupMembers.set(id, new Set(memberIds));
    return;
  }

  await pool.query("INSERT INTO chat_groups (id, name, owner_id) VALUES ($1, $2, $3)", [
    id,
    name,
    ownerId,
  ]);

  await addGroupMembers(id, memberIds);
}

async function addGroupMembers(groupId, memberIds) {
  if (!pool) {
    if (!memoryGroupMembers.has(groupId)) memoryGroupMembers.set(groupId, new Set());
    const members = memoryGroupMembers.get(groupId);
    memberIds.forEach((memberId) => members.add(memberId));
    return;
  }

  await Promise.all(
    memberIds.map((memberId) =>
      pool.query(
        "INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [groupId, memberId]
      )
    )
  );
}

async function getCustomGroup(groupId) {
  const groups = await getCustomGroupsForUser(null, groupId);
  return groups[0] || null;
}

async function getCustomGroupsForUser(userId, onlyGroupId = null) {
  if (!pool) {
    const groups = [];
    memoryGroups.forEach((group, groupId) => {
      const memberIds = Array.from(memoryGroupMembers.get(groupId) || []);
      if (onlyGroupId && groupId !== onlyGroupId) return;
      if (userId && !memberIds.includes(userId)) return;
      groups.push({
        id: group.id,
        name: group.name,
        ownerId: group.owner_id,
        members: memberIds
          .map((memberId) => normalizeAccount(memoryAccounts.get(memberId)))
          .filter(Boolean),
      });
    });
    return groups;
  }

  const params = [];
  const conditions = [];

  if (onlyGroupId) {
    params.push(onlyGroupId);
    conditions.push(`g.id = $${params.length}`);
  }

  if (userId) {
    params.push(userId);
    conditions.push(`EXISTS (
      SELECT 1 FROM group_members gm_filter
      WHERE gm_filter.group_id = g.id AND gm_filter.user_id = $${params.length}
    )`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const groupsResult = await pool.query(
    `
      SELECT g.id, g.name, g.owner_id
      FROM chat_groups g
      ${where}
      ORDER BY g.created_at DESC
    `,
    params
  );

  if (!groupsResult.rows.length) return [];

  const groupIds = groupsResult.rows.map((row) => row.id);
  const membersResult = await pool.query(
    `
      SELECT gm.group_id, a.id, a.name, a.avatar
      FROM group_members gm
      JOIN accounts a ON a.id = gm.user_id
      WHERE gm.group_id = ANY($1)
      ORDER BY a.name
    `,
    [groupIds]
  );

  const membersByGroup = new Map();
  membersResult.rows.forEach((row) => {
    if (!membersByGroup.has(row.group_id)) membersByGroup.set(row.group_id, []);
    membersByGroup.get(row.group_id).push({
      id: row.id,
      name: row.name,
      avatar: parseAvatar(row.avatar),
    });
  });

  return groupsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    members: membersByGroup.get(row.id) || [],
  }));
}

function normalizeMessage(row) {
  return {
    id: row.id,
    type: row.type,
    kind: row.kind || "text",
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderAvatar: parseAvatar(row.sender_avatar),
    receiverId: row.receiver_id,
    text: row.text,
    mediaUrl: row.media_url,
    createdAt: row.created_at,
  };
}

async function saveMessage({
  type,
  kind = "text",
  senderId,
  senderName,
  senderAvatar = null,
  receiverId = null,
  text,
  mediaUrl = null,
}) {
  if (!pool) {
    const message = {
      id: memoryMessages.length + 1,
      type,
      kind,
      sender_id: senderId,
      sender_name: senderName,
      sender_avatar: senderAvatar ? JSON.stringify(senderAvatar) : null,
      receiver_id: receiverId,
      text,
      media_url: mediaUrl,
      created_at: new Date().toISOString(),
    };

    memoryMessages.push(message);
    return normalizeMessage(message);
  }

  const result = await pool.query(
    `
      INSERT INTO messages (type, kind, sender_id, sender_name, sender_avatar, receiver_id, text, media_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `,
    [
      type,
      kind,
      senderId,
      senderName,
      senderAvatar ? JSON.stringify(senderAvatar) : null,
      receiverId,
      text,
      mediaUrl,
    ]
  );

  return normalizeMessage(result.rows[0]);
}

async function getGroupHistory(roomId = "group", limit = 50) {
  if (!pool) {
    return memoryMessages
      .filter(
        (message) =>
          message.type === "group" && (message.receiver_id || "group") === roomId
      )
      .slice(-limit)
      .map(normalizeMessage);
  }

  const result = await pool.query(
    `
      SELECT *
      FROM (
        SELECT *
        FROM messages
        WHERE type = 'group'
        AND COALESCE(receiver_id, 'group') = $2
        ORDER BY created_at DESC
        LIMIT $1
      ) recent
      ORDER BY created_at ASC
    `,
    [limit, roomId]
  );

  return result.rows.map(normalizeMessage);
}

async function getPrivateHistory(userId, withId, limit = 100) {
  if (!pool) {
    return memoryMessages
      .filter(
        (message) =>
          message.type === "private" &&
          ((message.sender_id === userId && message.receiver_id === withId) ||
            (message.sender_id === withId && message.receiver_id === userId))
      )
      .slice(-limit)
      .map(normalizeMessage);
  }

  const result = await pool.query(
    `
      SELECT *
      FROM (
        SELECT *
        FROM messages
        WHERE type = 'private'
        AND (
          (sender_id = $1 AND receiver_id = $2)
          OR
          (sender_id = $2 AND receiver_id = $1)
        )
        ORDER BY created_at DESC
        LIMIT $3
      ) recent
      ORDER BY created_at ASC
    `,
    [userId, withId, limit]
  );

  return result.rows.map(normalizeMessage);
}

module.exports = {
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
  getGroupHistory,
  getPrivateHistory,
};
