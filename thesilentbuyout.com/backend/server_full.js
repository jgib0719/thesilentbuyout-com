/*
  server_full.js
  A refactored version of the runbook's server.js that uses environment variables and safe fallbacks.
  NOTE: This file is a convenience reference. Do not commit API keys here. Use .env instead.
*/
require('dotenv').config();
const express = require('express');
const mariadb = require('mariadb');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 3000;
const AUDIO_PUBLIC_PATH = process.env.AUDIO_PUBLIC_PATH || '/audio';
const AUDIO_SERVER_PATH = process.env.AUDIO_SERVER_PATH || path.join(__dirname, '..', 'public_html', 'audio');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';

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

app.get('/api/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

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
  } finally { if (conn) conn.release(); }
});

// Generate social post using Gemini (if key present)
async function generateSocialPost(prompt) {
  if (!GEMINI_API_KEY) {
    return { username: 'System', handle: 'local', post: prompt, hashtags: [] };
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-0520:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error(`API ${r.status}`);
    const j = await r.json();
    const content = j.candidates?.[0]?.content?.parts?.[0]?.text;
    return JSON.parse(content || '{}');
  } catch (err) {
    console.error('generateSocialPost error', err);
    return { username: 'System', handle: 'error', post: 'Failed to generate', hashtags: [] };
  }
}

// Generate TTS (simple wrapper) - expects base64 audioContent in response
async function generateAudioLog(text, voice, fileName) {
  if (!GEMINI_API_KEY) throw new Error('TTS key not configured');
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`;
  const payload = { input: { text }, voice: { languageCode: 'en-US', name: voice === 'Charon' ? 'en-US-Wavenet-F' : 'en-US-Wavenet-E' }, audioConfig: { audioEncoding: 'LINEAR16' } };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error(`TTS API ${r.status}`);
  const j = await r.json();
  const audioContent = j.audioContent;
  if (!audioContent) throw new Error('No audioContent');
  fs.mkdirSync(AUDIO_SERVER_PATH, { recursive: true });
  const outPath = path.join(AUDIO_SERVER_PATH, fileName);
  fs.writeFileSync(outPath, Buffer.from(audioContent, 'base64'));
  return `${AUDIO_PUBLIC_PATH}/${fileName}`;
}

app.post('/api/audio', async (req, res) => {
  const { fileName, base64 } = req.body || {};
  if (!fileName || !base64) return res.status(400).json({ error: 'fileName and base64 required' });
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  try {
    fs.mkdirSync(AUDIO_SERVER_PATH, { recursive: true });
    fs.writeFileSync(path.join(AUDIO_SERVER_PATH, safeName), Buffer.from(base64, 'base64'));
    res.json({ ok: true, url: `${AUDIO_PUBLIC_PATH}/${safeName}` });
  } catch (err) {
    console.error('write error', err);
    res.status(500).json({ error: 'write failed' });
  }
});

// TEXT-TO-SPEECH (TTS) Endpoint
// Body: { text: string, voice?: string, fileName?: string }
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice = 'Charon', fileName } = req.body || {};
    if (!text || text.trim().length === 0) return res.status(400).json({ error: 'text required' });
    const safeName = (fileName || `tts_${Date.now()}.wav`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const outPath = path.join(AUDIO_SERVER_PATH, safeName);
    fs.mkdirSync(AUDIO_SERVER_PATH, { recursive: true });

    if (!GEMINI_API_KEY) {
      // Fallback: create a 0.5s silent WAV so frontend can play something while key absent
      const sampleRate = 16000;
      const durationSec = 0.5;
      const numSamples = Math.floor(sampleRate * durationSec);
      const header = Buffer.alloc(44);
      const data = Buffer.alloc(numSamples * 2); // 16-bit PCM silence
      const byteRate = sampleRate * 2;
      const blockAlign = 2;
      header.write('RIFF', 0);
      header.writeUInt32LE(36 + data.length, 4);
      header.write('WAVEfmt ', 8);
      header.writeUInt32LE(16, 16); // PCM header size
      header.writeUInt16LE(1, 20); // PCM format
      header.writeUInt16LE(1, 22); // channels
      header.writeUInt32LE(sampleRate, 24);
      header.writeUInt32LE(byteRate, 28);
      header.writeUInt16LE(blockAlign, 32);
      header.writeUInt16LE(16, 34); // bits per sample
      header.write('data', 36);
      header.writeUInt32LE(data.length, 40);
      fs.writeFileSync(outPath, Buffer.concat([header, data]));
      return res.json({ ok: true, url: `${AUDIO_PUBLIC_PATH}/${safeName}`, stub: true, note: 'GEMINI_API_KEY missing; generated silent placeholder.' });
    }

    const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`;
    const payload = {
      input: { text },
      voice: { languageCode: 'en-US', name: voice === 'Charon' ? 'en-US-Wavenet-F' : 'en-US-Wavenet-E' },
      audioConfig: { audioEncoding: 'LINEAR16' }
    };
    const r = await fetch(ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`TTS API ${r.status}: ${body}`);
    }
    const j = await r.json();
    if (!j.audioContent) throw new Error('No audioContent in TTS response');
    fs.writeFileSync(outPath, Buffer.from(j.audioContent, 'base64'));
    res.json({ ok: true, url: `${AUDIO_PUBLIC_PATH}/${safeName}`, voice });
  } catch (err) {
    console.error('TTS error', err);
    res.status(500).json({ error: 'tts_failed', detail: String(err.message || err) });
  }
});

// Batch Audio Logs Endpoint
// Body: { logs: [ { text, voice?, fileName? }, ... ] }
// Generates multiple audio files; if DB present, optionally inserts events when includeEvents=true
app.post('/api/audioLogs/batch', async (req, res) => {
  try {
    const { logs, includeEvents } = req.body || {};
    if (!Array.isArray(logs) || logs.length === 0) return res.status(400).json({ error: 'logs array required' });
    if (logs.length > 10) return res.status(400).json({ error: 'max 10 logs per batch' });
    fs.mkdirSync(AUDIO_SERVER_PATH, { recursive: true });

    // Helper synthesizer (mirrors /api/tts logic)
    async function synthOne(entry) {
      const { text, voice = 'Charon', fileName } = entry || {};
      if (!text || !text.trim()) throw new Error('text required for each log');
      const safeName = (fileName || `tts_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const outPath = path.join(AUDIO_SERVER_PATH, safeName);
      if (!GEMINI_API_KEY) {
        // Silent stub like /api/tts
        const sampleRate = 16000, durationSec = 0.5, numSamples = Math.floor(sampleRate * durationSec);
        const header = Buffer.alloc(44); const data = Buffer.alloc(numSamples * 2); const byteRate = sampleRate * 2; const blockAlign = 2;
        header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(byteRate, 28);
        header.writeUInt16LE(blockAlign, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
        fs.writeFileSync(outPath, Buffer.concat([header, data]));
        return { url: `${AUDIO_PUBLIC_PATH}/${safeName}`, voice, stub: true };
      }
      const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`;
      const payload = { input: { text }, voice: { languageCode: 'en-US', name: voice === 'Charon' ? 'en-US-Wavenet-F' : 'en-US-Wavenet-E' }, audioConfig: { audioEncoding: 'LINEAR16' } };
      const r = await fetch(ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`TTS API ${r.status}`);
      const j = await r.json(); if (!j.audioContent) throw new Error('No audioContent');
      fs.writeFileSync(outPath, Buffer.from(j.audioContent, 'base64'));
      return { url: `${AUDIO_PUBLIC_PATH}/${safeName}`, voice };
    }

    let conn = null;
    let nextOrder = null;
    if (includeEvents && pool) {
      try {
        conn = await pool.getConnection();
        const [[{ maxOrder }]] = await conn.query('SELECT COALESCE(MAX(event_order),0) as maxOrder FROM events');
        nextOrder = maxOrder + 1;
      } catch (e) {
        console.warn('DB fetch maxOrder failed, skipping inserts', e.message);
      }
    }

    const results = [];
    for (const entry of logs) {
      try {
        const r = await synthOne(entry);
        if (includeEvents && conn && nextOrder != null) {
          try {
            await conn.query(
              'INSERT INTO events (event_order, delay, action, actor, static_text, voice, api_prompt, misc_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [nextOrder++, 500, 'audioLog', entry.actor || null, entry.text || null, entry.voice || null, null, JSON.stringify(null)]
            );
            r.insertedEventOrder = nextOrder - 1;
          } catch (ie) {
            console.warn('Insert event failed', ie.message);
          }
        }
        results.push({ ok: true, textPreview: (entry.text||'').slice(0,80), ...r });
      } catch (err) {
        results.push({ ok: false, error: String(err.message || err) });
      }
    }
    if (conn) conn.release();
    res.json({ ok: true, count: results.length, results, dbInserts: includeEvents && !!conn });
  } catch (err) {
    console.error('batch audio error', err);
    res.status(500).json({ error: 'batch_failed', detail: String(err.message || err) });
  }
});

// PEARL Chat Endpoint - analyst style response using Gemini (fallback stub if no key)
// Body: { prompt: string }
app.post('/api/pearl', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    if (!GEMINI_API_KEY) {
      return res.json({ ok: true, model: 'stub', response: `STUB_PEARL: (${new Date().toISOString()}) ${prompt.slice(0, 120)} ... [Gemini key missing]` });
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const systemPrimer = 'You are PEARL, an investigative relay. Be concise, analytical, and evidence-focused. Offer next actionable steps.';
    const payload = {
      contents: [
        { role: 'user', parts: [{ text: `${systemPrimer}\nUser Query: ${prompt}` }] }
      ],
      generationConfig: { temperature: 0.4 }
    };
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`Gemini API ${r.status}: ${body}`);
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '(no response)';
    res.json({ ok: true, model: GEMINI_MODEL, response: text.trim() });
  } catch (err) {
    console.error('PEARL error', err);
    res.status(500).json({ error: 'pearl_failed', detail: String(err.message || err) });
  }
});

// AI Health Check Endpoint
// GET /api/ai/health -> { gemini: { ok, ms, detail? }, tts: { ok, ms, detail? } }
app.get('/api/ai/health', async (req, res) => {
  const out = { gemini: {}, tts: {} };
  const startGem = Date.now();
  if (!GEMINI_API_KEY) {
    out.gemini = { ok: false, detail: 'missing_key' };
  } else {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
      const payload = { contents: [{ role: 'user', parts: [{ text: 'ONE-WORD: OK' }] }], generationConfig: { maxOutputTokens: 1, temperature: 0 } };
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      out.gemini.ok = true; out.gemini.ms = Date.now() - startGem;
    } catch (e) {
      out.gemini.ok = false; out.gemini.ms = Date.now() - startGem; out.gemini.detail = String(e.message || e);
    }
  }
  const startTts = Date.now();
  if (!GEMINI_API_KEY) {
    out.tts = { ok: false, detail: 'missing_key' };
  } else {
    try {
      const ttsUrl = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GEMINI_API_KEY}`;
      const payload = { input: { text: 'OK' }, voice: { languageCode: 'en-US', name: 'en-US-Wavenet-F' }, audioConfig: { audioEncoding: 'MP3' } };
      const r = await fetch(ttsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const j = await r.json();
      if (!j.audioContent) throw new Error('no audioContent');
      out.tts.ok = true; out.tts.ms = Date.now() - startTts;
    } catch (e) {
      out.tts.ok = false; out.tts.ms = Date.now() - startTts; out.tts.detail = String(e.message || e);
    }
  }
  res.json(out);
});

// Serve frontend static files (public_html)
const publicDir = path.join(__dirname, '..', 'public_html');
app.use(express.static(publicDir));
// Root fallback to index.html
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

async function populateDatabase() {
  if (!pool) {
    console.log('DB not configured - skipping population.');
    return;
  }
  let conn;
  try {
    conn = await pool.getConnection();
    // Ensure table exists (idempotent)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_order INT NOT NULL,
        delay INT NOT NULL,
        action VARCHAR(50) NOT NULL,
        actor VARCHAR(50),
        static_text TEXT,
        voice VARCHAR(50),
        api_prompt TEXT,
        is_generated BOOLEAN DEFAULT FALSE,
        generated_content TEXT,
        misc_data JSON,
        UNIQUE KEY uq_order (event_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [[{ count }]] = await conn.query("SELECT COUNT(*) as count FROM events");
    if (count > 0) {
      console.log('Events table already populated.');
      return;
    }

    const initialEvents = [
      { order: 1, delay: 1000, action: 'comms', actor: 'KNOX', text: 'Found something weird. Handhole LFT-UTL-H2037 is warm. Shouldn\'t be. Logging it now.' },
      { order: 2, delay: 500, action: 'ledger', misc: { time: '14:32', domain: 'INFRA', desc: 'Handhole LFT‑UTL‑H2037 logged. Anomaly: residual heat.' } },
      { order: 3, delay: 1000, action: 'comms', actor: 'KNOX', text: 'I\'ve added a Geo-Intel map and a Social Stream to the OS. Let\'s see what people are saying.' },
      { order: 4, delay: 500, action: 'map', misc: { lat: 30.133, lon: -92.033, popup: 'LFT-UTL-H2037: Anomalous thermal reading.' } },
      { order: 5, delay: 2000, action: 'social', prompt: 'Write a short, realistic social media post from someone in Lafayette, LA complaining about their internet being weirdly slow today.' },
      { order: 6, delay: 3000, action: 'comms', actor: 'KNOX', text: 'Pulling up Ghost Route. Seeing a pattern... a rhythm. Micro-withdrawals at :15 and :45. Too clean for humans. I\'m opening the Net Traffic analyzer.' },
      { order: 7, delay: 1000, action: 'map', misc: { event: 'startPulse' } },
      { order: 8, delay: 500, action: 'ledger', misc: { time: '15:03', domain: 'NETWORK', desc: 'Ghost Route overlay active. Rhythm detected: :15/:45 micro-withdrawals.' } },
      { order: 9, delay: 1000, action: 'netTraffic', misc: { asn: 'AS7018', spike: 90 } },
      { order: 10, delay: 4000, action: 'comms', actor: 'KNOX', text: 'Leaving an audio log with my initial thoughts. Check the Audio Logs app.' },
      { order: 11, delay: 500, action: 'audioLog', text: "Say in a slightly concerned, professional tone: Knox, field log. The regularity of these network events is... unnatural. It feels automated, but not in a way I recognize. The heat signature at the handhole suggests a physical component, not just software. This isn't a normal outage. This is something else.", voice: 'Charon' },
      { order: 12, delay: 6000, action: 'comms', actor: 'MAYA', text: 'Knox, I got your forward. This "Operating Agent" language is a pattern I\'ve seen before. I need to file a preliminary injunction. Can you redact the sensitive client names from this draft before I send it?' },
      { order: 13, delay: 500, action: 'redaction' },
      { order: 14, delay: 8000, action: 'comms', actor: 'KNOX', text: 'It\'s not just routing... it\'s exploiting market microstructure. I\'ve added a Market Shock Simulator to your dock. See how it concentrates power.' },
      { order: 15, delay: 500, action: 'simulator' },
      { order: 16, delay: 5000, action: 'marketShock' },
      { order: 17, delay: 7000, action: 'comms', actor: 'MAYA', text: 'That market shock was no accident. It correlates with the network events. I need everything we can find on the shell companies involved. Start with "Oasis Relay, Ltd.".' },
      { order: 18, delay: 500, action: 'ledger', misc: { time: '19:05', domain: 'LEGAL', desc: 'Corporate investigation initiated into "Oasis Relay, Ltd.".' } },
      { order: 19, delay: 4000, action: 'social', prompt: 'Write a short, realistic social media post from a financial news blogger speculating about the cause of a recent, bizarre flash crash in a niche market.' },
      { order: 20, delay: 6000, action: 'comms', actor: 'RHEA', text: 'They\'re getting smarter. The :15/:45 rhythm is gone. They\'re using a new pattern, off-prime, looks like :07/:37. More subtle. It\'s like they know we\'re watching. Sending an audio log with the details.' },
      { order: 21, delay: 500, action: 'audioLog', text: "Say in a focused, technical tone: Rhea here. The prime-gap tags are gone. The new pattern is a phase shift to off-prime times, specifically seven and thirty-seven minutes past the hour. It's quieter, less obvious. They're not just running a script anymore; they're adapting. This is active counter-surveillance.", voice: 'Leda' },
      { order: 22, delay: 7000, action: 'comms', actor: 'KNOX', text: 'Found a link between Oasis Relay and a new data center build-out in Houston. The power permits are under a different name, but the fiber contracts lead back to the same trustee. Adding the location to the Geo-Intel map.' },
      { order: 23, delay: 500, action: 'map', misc: { lat: 29.7174, lon: -95.3698, popup: 'New Data Center Construction: Linked to Oasis Relay via fiber contracts.' } },
      { order: 24, delay: 5000, action: 'comms', actor: 'MAYA', text: 'Good work, team. We have a physical location, a corporate entity, and a clear pattern of adaptive behavior. We have enough to move. I\'m drafting a motion to compel.' }
    ];

    console.log('Populating events table with initial events...');
    const query = "INSERT INTO events (event_order, delay, action, actor, static_text, voice, api_prompt, misc_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    for (const e of initialEvents) {
      await conn.query(query, [e.order, e.delay, e.action, e.actor || null, e.text || null, e.voice || null, e.prompt || null, JSON.stringify(e.misc || null)]);
    }
    console.log('Database population complete.');
  } catch (err) {
    console.error('populateDatabase error', err);
  } finally {
    if (conn) conn.release();
  }
}

// Start server and attempt population if DB configured
app.listen(PORT, async () => {
  console.log(`Ghost Route OS full server listening on http://localhost:${PORT}`);
  if (pool) {
    try { await populateDatabase(); } catch (e) { console.error('populateDatabase failed', e); }
  }
});
