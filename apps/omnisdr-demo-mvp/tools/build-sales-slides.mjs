// Copy-to-slides build step. Usage: node tools/build-sales-slides.mjs [path/to/SALES-DECK-COPY.md]
// Reads Builder's "## Slide N: title" sections (On-slide and Notes blocks) and writes src/sales-slides.json.
// The copy is data: edit it upstream and rerun this, never hand-edit the JSON. Fails on em dashes. Slides not yet written get a placeholder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || process.env.SALES_COPY || 'C:/Users/cdsec/Halo/BrainAI/omnisdr-pivot/SALES-DECK-COPY.md';
const out = path.join(here, '..', 'src', 'sales-slides.json');
const TOTAL = 22, TITLES = { 12: 'The free proof', 13: 'Pricing ladder', 14: 'Higher-ticket options', 15: 'The sales path', 16: 'Discovery questions', 17: 'Objections and answers', 18: 'Never say', 19: 'After the yes', 20: 'Your first week', 21: 'Glossary', 22: 'Live demo walk-through' };
const text = fs.readFileSync(src, 'utf8').replace(/\r/g, '');
const clean = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();
const row = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => clean(c));
function onSlide(lines) {
  const blocks = []; let list = null, tab = null;
  const flush = () => { if (list) blocks.push({ list }); if (tab) blocks.push({ table: tab }); list = null; tab = null; };
  for (const raw of lines) {
    const l = raw.trim(); if (!l) { flush(); continue; }
    if (l.startsWith('|')) { if (list) flush(); const c = row(l); if (c.every((x) => /^:?-+:?$/.test(x))) continue; if (!tab) tab = { head: c, rows: [] }; else tab.rows.push(c); continue; }
    if (tab) flush();
    if (l.startsWith('- ')) { (list ||= []).push(clean(l.slice(2))); continue; }
    flush(); blocks.push(clean(l));
  }
  flush(); return blocks;
}
const slides = {};
for (const sec of text.split(/^## Slide /m).slice(1)) {
  const m = sec.match(/^(\d+):\s*(.+)\n/); if (!m) continue;
  const n = +m[1], body = sec.slice(m[0].length).split(/^---\s*$/m)[0];
  const [pre, notesPart = ''] = body.split(/^\*\*Notes\*\*.*$/m);
  const on = pre.replace(/^\*\*On-slide\*\*.*$/m, '');
  slides[n] = { title: clean(m[2]), body: onSlide(on.split('\n')), notes: notesPart.split('\n').map((x) => clean(x)).join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}
const list = [];
for (let n = 1; n <= TOTAL; n++) list.push(slides[n] || { title: TITLES[n] || 'Slide ' + n, body: ['Slide copy pending.'], notes: 'Speaker notes pending.' });
const json = JSON.stringify(list, null, 1);
if (json.includes('\u2014')) { console.error('build-sales-slides: em dash found in copy; send it back to Builder'); process.exit(1); }
fs.writeFileSync(out, json + '\n');
console.log('wrote ' + out + ': ' + Object.keys(slides).length + ' of ' + TOTAL + ' slides from copy, rest placeholders');
