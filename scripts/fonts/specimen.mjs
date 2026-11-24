// A page showing every chat language in its own font, light or dark, so the fonts can be judged by eye.
//   npm run build -w @vtt-chat-app/shared -w @vtt-chat-app/ui-kit
//   node scripts/fonts/specimen.mjs light /tmp/light.html ["sample text"]
//   chromium --headless --no-sandbox --allow-file-access-from-files --window-size=800,1090 \
//            --screenshot=/tmp/light.png file:///tmp/light.html
// It reads the real LANGUAGE_FONTS table and the bundled Fontsource files, so what it shows is what the apps show.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const kit = await import(pathToFileURL(`${root}/ui-kit/dist/index.js`).href);
const shared = await import(pathToFileURL(`${root}/shared/dist/index.js`).href);
const theme = process.argv[2] ?? 'light';
const out = process.argv[3];
const slug = (f) => f.toLowerCase().replace(/\s+/g, '-');
const faces = new Set();
let css = '';
const addCss = (pkg, file) => {
  const key = pkg + file;
  if (faces.has(key)) return;
  faces.add(key);
  const dir = `${root}/node_modules/${pkg}`;
  let t = readFileSync(`${dir}/${file}`, 'utf8');
  t = t.replace(/url\(\.\/files\//g, `url(file://${dir}/files/`);
  css += t + '\n';
};
for (const f of Object.values(kit.LANGUAGE_FONTS)) {
  if (f.family === 'Inter Variable') continue;
  addCss(`@fontsource/${slug(f.family)}`, `latin-${f.weight}${f.italic ? '-italic' : ''}.css`);
}
addCss('@fontsource-variable/inter', 'wght.css');
addCss('@fontsource/cinzel', '600.css');
addCss('@fontsource/cormorant-garamond', 'latin-500.css');
const dark = theme === 'dark';
const sample = process.argv[4] ?? '“The tide is turning, and the bell tolls for Wrackwater.”';
const rows = shared.CHAT_LANGUAGES.map((l) => {
  const st = kit.languageTextStyle(l.key) ?? {};
  const style = Object.entries(st)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';');
  return `<div class="row"><div class="who">${l.name}</div><div class="bubble"><span style='${style}'>${sample}</span><div class="cap">in ${l.name}</div></div></div>`;
}).join('\n');
writeFileSync(
  out,
  `<!doctype html><meta charset=utf-8><style>${css}
body{margin:0;padding:18px;width:760px;font-family:'Inter Variable',system-ui,sans-serif;font-size:14px;background:${dark ? '#17151f' : '#f4f1ea'};color:${dark ? '#ece8f5' : '#26222e'}}
h1{font-family:'Cinzel',serif;font-size:18px;margin:0 0 12px}
.row{display:flex;gap:14px;align-items:center;margin:5px 0}
.who{width:110px;font-size:11px;opacity:.65}
.bubble{flex:1;background:${dark ? '#262233' : '#fff'};border-radius:12px;padding:8px 12px;font-size:14px}
.cap{font-size:10px;font-style:italic;opacity:.6;margin-top:2px}
.hand{font-family:'Cormorant Garamond',serif;font-size:16px;margin-top:14px;background:${dark ? '#262233' : '#fff'};padding:10px 12px;border-radius:10px}
</style><h1>Language fonts (${theme})</h1>${rows}<div class="hand">Handout (narrative, Cormorant Garamond): To Ghorrim Duskhammer, the bell of Skelling rings once more beneath the waves.</div>`,
);
