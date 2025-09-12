#!/usr/bin/env node
/* validate_events.js
   Simple structural validator for events JSON.
   Usage: node tools/validate_events.js ../chapter1_events_full.json
*/
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if(!file){
  console.error('Usage: node validate_events.js <file.json>');
  process.exit(1);
}
const raw = fs.readFileSync(path.resolve(file),'utf8');
let data;
try { data = JSON.parse(raw); } catch(e){ console.error('Invalid JSON', e.message); process.exit(2);} 
if(!Array.isArray(data)) { console.error('Top-level must be array'); process.exit(3);} 

const required = ['event_order','delay','action','actor','static_text','voice','api_prompt','misc_data'];
let ok = true;
const seenOrders = new Set();
data.forEach((ev, idx)=>{
  for(const k of required){ if(!(k in ev)){ console.error('Missing key', k, 'in index', idx); ok=false; } }
  if(seenOrders.has(ev.event_order)) { console.error('Duplicate event_order', ev.event_order); ok=false; }
  seenOrders.add(ev.event_order);
  if(typeof ev.event_order !== 'number') { console.error('event_order not number', ev.event_order); ok=false; }
  if(typeof ev.delay !== 'number') { console.error('delay not number', ev.event_order); ok=false; }
  if(typeof ev.misc_data !== 'object' || ev.misc_data===null) { console.error('misc_data must be object', ev.event_order); ok=false; }
});

if(ok){
  console.log('Validation PASS. Events:', data.length);
  const actions = data.reduce((m,e)=> (m[e.action]=(m[e.action]||0)+1, m), {});
  console.log('Action distribution:', actions);
}
process.exit(ok?0:4);
