// Dresses a page screenshot for the docs: a plain window frame for a desktop panel, a plain phone
// outline for the web app, a terminal window for the operator's console. The frames are generic on
// purpose (no operating system's look): the screenshots are simulated and should not pretend otherwise.
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function render(browser, html, selector = '#shot') {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  const png = await (await page.$(selector)).screenshot({ omitBackground: true });
  await page.close();
  return png;
}

const PALETTE = {
  dark: { bar: '#1d1f24', text: '#c9ccd3', edge: '#33363d', glyph: '#8b8f98' },
  light: { bar: '#eceef1', text: '#3a3d44', edge: '#c9ccd3', glyph: '#6b6f78' },
};

/** A desktop window around `page`: title bar, rounded corners, on a clear background. No shadow: the files are stored
 * with a 256-colour palette (compress.py), which cannot hold a soft one. */
export async function frameWindow(browser, page, { title = 'VTT Chat', scheme = 'dark' } = {}) {
  const shot = Buffer.from(await page.screenshot()).toString('base64');
  const { width } = page.viewport();
  const c = PALETTE[scheme];
  return render(
    browser,
    `<body style="margin:0;background:transparent">
     <div id="shot" style="display:inline-block;padding:6px">
      <div style="width:${width}px;border-radius:10px;overflow:hidden;border:1px solid ${c.edge};font:13px system-ui,sans-serif">
       <div style="height:34px;background:${c.bar};color:${c.text};display:flex;align-items:center;
                   padding:0 12px;border-bottom:1px solid ${c.edge}">
        <span style="flex:1;font-weight:500">${esc(title)}</span>
        <span style="color:${c.glyph};letter-spacing:14px;font-size:14px">–□×</span>
       </div>
       <img src="data:image/png;base64,${shot}" style="display:block;width:${width}px">
      </div>
     </div></body>`,
  );
}

/** A phone outline around `page` (the web app at phone size). */
export async function framePhone(browser, page) {
  const shot = Buffer.from(await page.screenshot()).toString('base64');
  const { width } = page.viewport();
  return render(
    browser,
    `<body style="margin:0;background:transparent">
     <div id="shot" style="display:inline-block;padding:6px">
      <div style="padding:12px;border-radius:44px;background:#17181b;border:1px solid #3a3d44;">
       <img src="data:image/png;base64,${shot}"
            style="display:block;width:${width}px;border-radius:32px">
      </div>
     </div></body>`,
  );
}

/** A terminal window showing `text` (the operator's console). `prompt` lines are drawn brighter. */
export async function terminal(browser, { title = 'operator@vtt: ~', text, width = 860 }) {
  const lines = text
    .split('\n')
    .map((line) =>
      line.startsWith('$ ')
        ? `<span style="color:#7fd88a">$</span> <span style="color:#fff">${esc(line.slice(2))}</span>`
        : esc(line),
    )
    .join('\n');
  const c = PALETTE.dark;
  return render(
    browser,
    `<body style="margin:0;background:transparent">
     <div id="shot" style="display:inline-block;padding:6px">
      <div style="width:${width}px;border-radius:10px;overflow:hidden;border:1px solid ${c.edge};">
       <div style="height:34px;background:${c.bar};color:${c.text};display:flex;align-items:center;
                   padding:0 12px;border-bottom:1px solid ${c.edge};font:13px system-ui,sans-serif">
        <span style="flex:1;font-weight:500">${esc(title)}</span>
        <span style="color:${c.glyph};letter-spacing:14px;font-size:14px">–□×</span>
       </div>
       <pre style="margin:0;padding:16px 18px;background:#101114;color:#c9ccd3;white-space:pre-wrap;
                   font:13px/1.5 ui-monospace,'DejaVu Sans Mono',Menlo,monospace">${lines}</pre>
      </div>
     </div></body>`,
  );
}
