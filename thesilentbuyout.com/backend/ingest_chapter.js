require('dotenv').config();
const mariadb = require('mariadb');
const fs = require('fs');
const path = require('path');

const eventsFile = path.join(__dirname, 'chapter1_events.json');
const sqlOut = path.join(__dirname, 'chapter1_inserts.sql');
const data = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'buyout_user',
  password: process.env.DB_PASS || 'Awake2020!',
  database: process.env.DB_NAME || 'silent_buyout_db',
  connectionLimit: 5,
};

async function insertEvents() {
  let pool;
  try {
    pool = mariadb.createPool(poolConfig);
    const conn = await pool.getConnection();
    // get current max event_order to avoid duplicates
    const rows = await conn.query("SELECT COALESCE(MAX(event_order), 0) AS max_order FROM events");
    const maxOrder = (rows && rows.length && rows[0].max_order) ? rows[0].max_order : 0;
    let i = 0;
    for (const ev of data) {
      const newOrder = maxOrder + (++i);
      const q = `INSERT INTO events (event_order, delay, action, actor, static_text, voice, api_prompt, is_generated, generated_content, misc_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const params = [newOrder, ev.delay || 0, ev.action, ev.actor || null, ev.content || ev.static_text || null, null, null, ev.is_generated ? 1 : 0, ev.generated_content || null, JSON.stringify(ev.misc_data || null)];
      await conn.query(q, params);
      console.log('Inserted event', newOrder, ev.action);
    }
    conn.release();
    await pool.end();
    return true;
  } catch (err) {
    console.error('DB insert failed:', err.message || err);
    // Fallback: write SQL file
    const lines = data.map(ev => {
      const misc = JSON.stringify(ev.misc_data || null).replace(/'/g, "''");
      const content = (ev.content || ev.static_text || '').replace(/'/g, "''");
      const actor = (ev.actor || '').replace(/'/g, "''");
      return `INSERT INTO events (event_order, delay, action, actor, static_text, voice, api_prompt, is_generated, generated_content, misc_data) VALUES (${ev.event_order || 'NULL'}, ${ev.delay || 0}, '${ev.action}', '${actor}', '${content}', NULL, NULL, ${ev.is_generated ? 1 : 0}, NULL, '${misc}');`;
    }).join('\n');
    fs.writeFileSync(sqlOut, lines);
    console.log('Wrote fallback SQL to', sqlOut);
    return false;
  }
}

if (require.main === module) {
  insertEvents().then(ok => process.exit(ok ? 0 : 1));
}
