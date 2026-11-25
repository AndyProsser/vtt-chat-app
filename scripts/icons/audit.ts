// The icon audit (docs/superpowers/plans/2026-11-24-typography-and-icons.md, Task 8): which screens use a lucide
// icon that stands in for something it only half says, and what a Game Icons picture would look like beside it.
//
//   node scripts/icons/audit.ts <out.html> [<game-icons dir>]
//
// <game-icons dir> is an extracted game-icons.net archive (the `icons/ffffff/000000/1x1` folder). It is only read
// to show candidates next to the lucide icon; nothing from it is copied into the repo (Game Icons is CC BY 3.0).
// Reads the real icon rules, so the sheet shows what the apps show.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';

import { SENSE_ICON, VITAL_ICON } from '../../ui-kit/dist/consts/icons.js';
import { sceneIcon } from '../../tauri-client/panels-ui/src/lib/sceneIcons.ts';
import { boardIcon, soundIcon } from '../../tauri-client/panels-ui/src/lib/soundIcons.ts';

const [outPath, gameIconsDir] = process.argv.slice(2);
if (!outPath) {
  console.error('usage: node scripts/icons/audit.ts <out.html> [<game-icons dir>]');
  process.exit(2);
}

type Glyph = typeof lucide.Sparkles;
const nameOf = (g: Glyph): string => (g as unknown as { displayName?: string }).displayName ?? '?';
const draw = (g: Glyph, size = 30): string => renderToStaticMarkup(createElement(g, { size }));

// ---- Game Icons candidates (optional) --------------------------------------------------------------------------
const gameIcons = new Map<string, string>(); // file stem -> path
if (gameIconsDir) {
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name.endsWith('.svg')) gameIcons.set(e.name.slice(0, -4), join(dir, e.name));
    }
  };
  walk(gameIconsDir);
}
const stem = (w: string): string => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3)
    .map(stem);

function candidates(keywords: string[], limit = 3): { name: string; svg: string }[] {
  if (gameIcons.size === 0) return [];
  const want = new Set(keywords.flatMap(words));
  const scored: { name: string; score: number }[] = [];
  for (const name of gameIcons.keys()) {
    const parts = name.split('-').map(stem);
    const hits = parts.filter((p) => want.has(p)).length;
    if (hits > 0) scored.push({ name, score: hits * 10 - parts.length });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ name }) => {
    const raw = readFileSync(gameIcons.get(name)!, 'utf8')
      // The archive's pictures are white on a black square: drop the square, draw in the text colour.
      .replace(/<path d="M0 0h512v512H0z"\/>/, '')
      .replace(/ fill="#fff"/g, '')
      .replace('<svg ', '<svg width="30" height="30" fill="currentColor" ');
    return { name, svg: raw };
  });
}

// ---- What the apps show -----------------------------------------------------------------------------------------
interface Row {
  area: string;
  label: string;
  note: string;
  glyph: Glyph | null;
  keywords: string[];
}
const rows: Row[] = [];

const catalogue = JSON.parse(readFileSync('backend/assets/sounds/catalogue.json', 'utf8')) as {
  sounds: { key: string; name: string; category: string }[];
  boards: { name: string; buttons: { label: string; sound: string }[] }[];
  scenes: { name: string }[];
};
const boardOf = new Map<string, string>();
for (const b of catalogue.boards) for (const btn of b.buttons) boardOf.set(btn.sound, b.name);

const GENERIC = new Set<Glyph>([lucide.Volume2 as Glyph, lucide.Sparkles as Glyph]);
for (const s of catalogue.sounds.filter((x) => x.category === 'effect')) {
  const g = soundIcon(s.name, boardOf.get(s.key) ?? '') as Glyph;
  rows.push({
    area: 'Sound effects (stingers)',
    label: s.name,
    note: boardOf.get(s.key) ? `board: ${boardOf.get(s.key)}` : 'no board',
    glyph: g,
    keywords: [s.name],
  });
}
for (const b of catalogue.boards) {
  rows.push({
    area: 'Sound boards',
    label: b.name,
    note: `${b.buttons.length} buttons`,
    glyph: boardIcon(b.name) as Glyph,
    keywords: [b.name],
  });
}
for (const sc of catalogue.scenes) {
  rows.push({
    area: 'Scenes',
    label: sc.name,
    note: '',
    glyph: sceneIcon(sc.name) as Glyph,
    keywords: [sc.name],
  });
}
for (const [k, g] of Object.entries(VITAL_ICON)) {
  const label = { ac: 'Armour class', hp: 'Hit points', pp: 'Passive Perception' }[k] ?? k;
  const kw = { ac: ['shield', 'armor'], hp: ['heart', 'health'], pp: ['eye', 'perception'] }[k] ?? [
    k,
  ];
  rows.push({ area: 'Character: quick numbers', label, note: '', glyph: g as Glyph, keywords: kw });
}
for (const [k, g] of Object.entries(SENSE_ICON)) {
  rows.push({
    area: 'Character: senses',
    label: k,
    note: '',
    glyph: g as Glyph,
    keywords: [k, 'vision', 'eye'],
  });
}
const ABILITIES: [string, string[]][] = [
  ['Strength', ['muscle', 'biceps', 'strong']],
  ['Dexterity', ['dodge', 'acrobat', 'juggler']],
  ['Constitution', ['heart', 'endurance', 'health']],
  ['Intelligence', ['brain', 'book', 'wisdom']],
  ['Wisdom', ['owl', 'meditation', 'eye']],
  ['Charisma', ['charm', 'speech', 'crown']],
];
for (const [label, keywords] of ABILITIES) {
  rows.push({
    area: 'Character: ability scores (text only today, no icon)',
    label,
    note: '',
    glyph: null,
    keywords,
  });
}
const itemSource = readFileSync('tauri-client/panels-ui/src/components/ItemIcon.tsx', 'utf8');
const itemBlock =
  /const ICON: Record<ItemType, LucideIcon> = \{([^}]*)\}/.exec(itemSource)?.[1] ?? '';
for (const m of itemBlock.matchAll(/(\w+):\s*(\w+),/g)) {
  const g = (lucide as unknown as Record<string, Glyph>)[m[2]!];
  if (g)
    rows.push({ area: 'Loot: item types', label: m[1]!, note: '', glyph: g, keywords: [m[1]!] });
}

// ---- Which icons are shared, and which fall back to nothing in particular ------------------------------------------
const uses = new Map<Glyph, number>();
for (const r of rows)
  if (r.glyph && r.area === 'Sound effects (stingers)')
    uses.set(r.glyph, (uses.get(r.glyph) ?? 0) + 1);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const flag = (r: Row): string => {
  if (!r.glyph) return '<b class="none">no icon</b>';
  if (GENERIC.has(r.glyph)) return '<b class="gen">generic fallback</b>';
  const n = uses.get(r.glyph) ?? 0;
  return r.area === 'Sound effects (stingers)' && n >= 4
    ? `<b class="shr">shared by ${n} sounds</b>`
    : '';
};
const needsCandidates = (r: Row): boolean =>
  !r.glyph || GENERIC.has(r.glyph) || !r.area.startsWith('Sound') || (uses.get(r.glyph) ?? 0) >= 4;

let body = '';
let area = '';
for (const r of rows) {
  if (r.area !== area) {
    area = r.area;
    body += `<h2>${esc(area)}</h2>`;
  }
  const cands = needsCandidates(r)
    ? candidates(r.keywords)
        .map((c) => `<span class="c" title="${esc(c.name)}">${c.svg}<i>${esc(c.name)}</i></span>`)
        .join('')
    : '';
  body += `<div class="row"><span class="cur">${r.glyph ? draw(r.glyph) : '<span class="blank"></span>'}<i>${r.glyph ? esc(nameOf(r.glyph)) : '-'}</i></span><span class="lbl">${esc(r.label)}<small>${esc(r.note)}</small></span>${flag(r)}<span class="cands">${cands}</span></div>`;
}

const fallbacks = rows.filter(
  (r) => r.glyph && GENERIC.has(r.glyph) && r.area.startsWith('Sound effects'),
).length;
const total = rows.filter((r) => r.area.startsWith('Sound effects')).length;
const shared = [...uses.entries()].filter(([, n]) => n >= 4).map(([g, n]) => `${nameOf(g)} x${n}`);
const summary = `${total} sound effects: ${fallbacks} on a generic fallback; icons shared by 4 or more: ${shared.join(', ') || 'none'}.`;

writeFileSync(
  outPath,
  `<!doctype html><meta charset=utf-8><title>Icon audit</title><style>
body{font:14px system-ui,sans-serif;margin:20px;max-width:980px;background:#f4f1ea;color:#26222e}
h1{font-size:18px;margin:0 0 4px}p{margin:2px 0 14px;opacity:.75}h2{font-size:13px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:.06em;opacity:.7}
.row{display:flex;align-items:center;gap:14px;padding:4px 8px;border-radius:8px;background:#fff;margin:3px 0}
.cur{width:96px;display:flex;flex-direction:column;align-items:center;font-size:10px;opacity:.9}.cur i,.c i{font-style:normal;font-size:9px;opacity:.6;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blank{display:inline-block;width:30px;height:30px;border:1px dashed #aaa;border-radius:6px}
.lbl{flex:1;min-width:0}.lbl small{display:block;opacity:.55;font-size:11px}
b{font-size:10px;padding:2px 6px;border-radius:99px;font-weight:600}.gen{background:#fde4e4;color:#9b1c1c}.none{background:#fde4e4;color:#9b1c1c}.shr{background:#fff0d6;color:#8a5200}
.cands{display:flex;gap:10px;width:320px}.c{display:flex;flex-direction:column;align-items:center;width:96px;color:#3b2a6b}
</style><h1>Icon audit: lucide stand-ins and Game Icons candidates</h1><p>${esc(summary)} Left: what the app shows today (lucide). Right: closest Game Icons by name (CC BY 3.0, not used in the app). Only rows that are generic, shared, missing, or not a sound are given candidates.</p>${body}`,
);
console.log(summary);
console.log(`wrote ${outPath} (${rows.length} rows, ${gameIcons.size} Game Icons read)`);
