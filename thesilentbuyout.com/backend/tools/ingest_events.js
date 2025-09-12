#!/usr/bin/env node
/* ingest_events.js
   Ingests events JSON (replaces existing chapter rows optionally).
   Usage: node tools/ingest_events.js --file ../chapter1_events_full.json --chapter 1 --replace
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');

function arg(flag){ const i = process.argv.indexOf(flag); return i===-1? null : process.argv[i+1]; }
const file = arg('--file');
const chapter = parseInt(arg('--chapter'),10);
const replace = process.argv.includes('--replace');
if(!file || !chapter){
  console.error('Usage: node tools/ingest_events.js --file <events.json> --chapter <n> [--replace]');
  process.exit(1);
}

const { DB_HOST, DB_USER, DB_PASS, DB_NAME } = process.env;
if(!DB_HOST){ console.error('DB env vars missing.'); process.exit(2); }
const pool = mariadb.createPool({ host:DB_HOST, user:DB_USER, password:DB_PASS, database:DB_NAME, connectionLimit:3 });

async function main(){
  const raw = fs.readFileSync(path.resolve(file),'utf8');
  const events = JSON.parse(raw);
  if(!Array.isArray(events)) throw new Error('File must be JSON array');
  let conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if(replace){
      console.log('Deleting existing rows for chapter', chapter);
      await conn.query('DELETE FROM events WHERE chapter = ?', [chapter]);
    }
    for(const ev of events){
      await conn.query(
        `INSERT INTO events (chapter, event_order, delay, action, actor, static_text, voice, api_prompt, misc_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [chapter, ev.event_order, ev.delay, ev.action, ev.actor || null, ev.static_text || null,
         ev.voice || null, ev.api_prompt || null, JSON.stringify(ev.misc_data || {})]
      );
    }
    await conn.commit();
    console.log('Ingested', events.length, 'events for chapter', chapter);
  } catch(e){
    await conn.rollback();
    console.error('Ingestion failed:', e.message);
    process.exit(3);
  } finally { conn.release(); await pool.end(); }
}

main().catch(e=>{ console.error(e); process.exit(4); });
