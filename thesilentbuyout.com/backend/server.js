require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AUDIO_PUBLIC_PATH = process.env.AUDIO_PUBLIC_PATH || '/audio';
const AUDIO_SERVER_PATH = process.env.AUDIO_SERVER_PATH || path.join(__dirname, '..', 'public_html', 'audio');

// Optional DB pool - only created if DB envs provided
let pool = null;
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS && process.env.DB_NAME) {
  pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectionLimit: 5,
  });
}

app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

app.get('/api/events', async (req, res) => {
  if (!pool) return res.json([]);
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT * FROM events ORDER BY event_order ASC');
    res.json(rows);
  } catch (err) {
    console.error('DB error', err);
    res.status(500).json({ error: 'DB error' });
  } finally {
    if (conn) conn && conn.release();
  }
});

// POST /api/redactions - store a redacted document
app.post('/api/redactions', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DB not configured' });
  const { user = 'anonymous', doc_text, redacted_terms = [], source_event = null, notes = null } = req.body || {};
  if (!doc_text) return res.status(400).json({ error: 'doc_text required' });
  let conn;
  try {
    conn = await pool.getConnection();
    const r = await conn.query('INSERT INTO redactions (user, doc_text, redacted_terms, source_event, notes) VALUES (?, ?, ?, ?, ?)', [user, doc_text, JSON.stringify(redacted_terms), source_event, notes]);
    res.json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error('Redaction insert failed', e);
    res.status(500).json({ error: 'insert_failed' });
  } finally { if (conn) conn && conn.release(); }
});

// GET /api/redactions - list recent redactions
app.get('/api/redactions', async (req, res) => {
  if (!pool) return res.status(500).json({ error: 'DB not configured' });
  let conn;
  try {
    conn = await pool.getConnection();
    const rows = await conn.query('SELECT id, created_at, user, redacted_terms, source_event, notes FROM redactions ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (e) {
    console.error('Redactions list failed', e);
    res.status(500).json({ error: 'query_failed' });
  } finally { if (conn) conn && conn.release(); }
});

// Endpoint to accept a base64 WAV payload and write to audio dir (simple, safe)
app.post('/api/audio', (req, res) => {
  const { fileName, base64 } = req.body || {};
  if (!fileName || !base64) return res.status(400).json({ error: 'fileName and base64 required' });
  // sanitize fileName
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const outPath = path.join(AUDIO_SERVER_PATH, safeName);
  try {
    fs.mkdirSync(AUDIO_SERVER_PATH, { recursive: true });
    const buf = Buffer.from(base64, 'base64');
    fs.writeFileSync(outPath, buf);
    res.json({ ok: true, url: `${AUDIO_PUBLIC_PATH}/${safeName}` });
  } catch (err) {
    console.error('Write audio error', err);
    res.status(500).json({ error: 'failed to write file' });
  }
});

app.listen(PORT, () => {
  console.log(`Ghost Route OS backend (scaffold) listening on http://localhost:${PORT}`);
});
