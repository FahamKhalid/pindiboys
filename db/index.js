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
}

function parseAvatar(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
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
  saveMessage,
  getGroupHistory,
  getPrivateHistory,
};
