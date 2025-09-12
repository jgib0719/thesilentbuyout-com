#!/usr/bin/env node
/* run_migrations.js
   Executes .sql files in migrations/ in filename order idempotently.
   Requires DB env vars: DB_HOST, DB_USER, DB_PASS, DB_NAME
*/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mariadb = require('mariadb');

const { DB_HOST, DB_USER, DB_PASS, DB_NAME } = process.env;
if(!DB_HOST || !DB_USER || !DB_PASS || !DB_NAME){
  console.error('Missing DB env vars (DB_HOST, DB_USER, DB_PASS, DB_NAME).');
  process.exit(1);
}

const pool = mariadb.createPool({ host:DB_HOST, user:DB_USER, password:DB_PASS, database:DB_NAME, connectionLimit:2 });

async function main(){
  const dir = path.join(__dirname,'..','migrations');
  if(!fs.existsSync(dir)){ console.log('No migrations directory.'); return; }
  const files = fs.readdirSync(dir).filter(f=>f.match(/\.sql$/)).sort();
  let conn = await pool.getConnection();
  try {
    for(const f of files){
      const sql = fs.readFileSync(path.join(dir,f),'utf8');
      console.log('Applying', f);
      try { await conn.query(sql); console.log('OK', f); }
      catch(e){ console.error('Failed', f, e.message); }
    }
  } finally { conn.release(); await pool.end(); }
}

main().catch(e=>{ console.error(e); process.exit(1); });
