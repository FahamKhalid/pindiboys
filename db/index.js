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
}

function normalizeMessage(row) {
  return {
    id: row.id,
    type: row.type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    receiverId: row.receiver_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

async function saveMessage({ type, senderId, senderName, receiverId = null, text }) {
  if (!pool) {
    const message = {
      id: memoryMessages.length + 1,
      type,
      sender_id: senderId,
      sender_name: senderName,
      receiver_id: receiverId,
      text,
      created_at: new Date().toISOString(),
    };

    memoryMessages.push(message);
    return normalizeMessage(message);
  }

  const result = await pool.query(
    `
      INSERT INTO messages (type, sender_id, sender_name, receiver_id, text)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `,
    [type, senderId, senderName, receiverId, text]
  );

  return normalizeMessage(result.rows[0]);
}

async function getGroupHistory(limit = 50) {
  if (!pool) {
    return memoryMessages
      .filter((message) => message.type === "group")
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
        ORDER BY created_at DESC
        LIMIT $1
      ) recent
      ORDER BY created_at ASC
    `,
    [limit]
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
