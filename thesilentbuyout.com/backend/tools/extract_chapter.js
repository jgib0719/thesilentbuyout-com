#!/usr/bin/env node
/*
  extract_chapter.js
  Minimal manuscript chapter slicer & scaffold event extractor (deterministic, no AI calls yet).
  Usage: node tools/extract_chapter.js --chapter 1 --input ../manuscript.txt --out ../draft_ch1_scaffold.json
*/
const fs = require('fs');
const path = require('path');

function arg(k, def){
  const i = process.argv.indexOf(k); if(i===-1) return def; return process.argv[i+1];
}

const chapterNum = parseInt(arg('--chapter'),10);
if(!chapterNum){
  console.error('Missing --chapter <number>');
  process.exit(1);
}
const inputPath = path.resolve(arg('--input','../manuscript.txt'));
const outPath = path.resolve(arg('--out', `../draft_ch${chapterNum}_scaffold.json`));

const raw = fs.readFileSync(inputPath,'utf8');
// Split on chapter headings (naive regex) and keep delimiters
const parts = raw.split(/\n(?=Chapter\s+\d+\b)/);
let chapterText = null;
for(const p of parts){
  const m = p.match(/^Chapter\s+(\d+)/);
  if(m && parseInt(m[1],10)===chapterNum){ chapterText = p; break; }
}
if(!chapterText){
  console.error('Chapter not found');
  process.exit(2);
}

// Basic paragraph segmentation
const paragraphs = chapterText.split(/\n\s*\n+/).map(s=>s.trim()).filter(Boolean);

// Heuristic chunking (merge small paragraphs)
const chunks = [];
let buf = [];
let charCount = 0;
for(const para of paragraphs){
  if(charCount + para.length > 650 && buf.length){
    chunks.push(buf.join('\n\n'));
    buf = []; charCount = 0;
  }
  buf.push(para); charCount += para.length;
}
if(buf.length) chunks.push(buf.join('\n\n'));

// Produce scaffold events (placeholder classification)
const scaffold = chunks.map((text, i)=>({
  chapter: chapterNum,
  provisional_order: i+1,
  source_preview: text.slice(0,140).replace(/\s+/g,' ').trim(),
  source_hash: require('crypto').createHash('sha256').update(text).digest('hex').slice(0,32),
  suggested_action: null, // to be filled manually or by future model
  notes: 'TODO classify & extract discrete events; may split.'
}));

fs.writeFileSync(outPath, JSON.stringify({
  chapter: chapterNum,
  paragraph_count: paragraphs.length,
  chunk_count: chunks.length,
  generated_at: new Date().toISOString(),
  scaffold
}, null, 2));
console.log('Scaffold written:', outPath);
