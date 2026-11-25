// The list of screenshots. Each entry returns a PNG; its key is the file name.
const MAIN = [600, 940];

/** The main window with the session in full swing: someone talking, the earlier whispers and loot in view. */
async function table(
  c,
  { who, scheme, theme, size = MAIN, recording = true, speaking = 'aria', options },
) {
  const view = await c.desktop({ who, scheme, theme, size, options });
  await c.catchUp(view.bridge, who);
  if (recording) {
    await view.bridge.emit('sync:event', {
      t: 'recording.state',
      d: {
        recording: {
          recordingId: 'shot',
          capturing: true,
          startedAt: Date.now() - (47 * 60 + 12) * 1000,
        },
      },
    });
  }
  if (speaking) {
    const id = c.seats.get(speaking).userId;
    await view.bridge.emit('livekit:speakers', { speakingIdentities: [id] });
    await view.bridge.emit('sync:event', {
      t: 'speaking.update',
      d: { userId: id, speaking: true },
    });
  }
  await c.sleep(400);
  return view;
}

/** Scrolls the first element whose own text starts with `text` to the top of the window. */
async function scrollToText(page, text) {
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('b, h1, h2, h3, [role="tab"], button')].find((e) =>
      e.textContent.trim().startsWith(t),
    );
    el?.scrollIntoView({ block: 'start' });
  }, text);
}

/** The history window with the one recorded session opened. */
async function history(c, { who, scheme, size, scrollTo }) {
  const view = await c.desktop({ route: 'history', who, scheme, size });
  await view.page.click('.vtt-sessions .vtt-char-head');
  await view.page.waitForSelector('article.vtt-session', { timeout: 15000 });
  await c.sleep(400);
  if (scrollTo) await scrollToText(view.page, scrollTo);
  return view;
}

/** Opens one of a session's tabs (The Tale, The Heroes, The Story, The Notes). */
async function openTab(page, c, name) {
  await clickText(page, '[role="tab"]', name);
  await c.sleep(500);
}

/** Settings, opened from the cog in the main window, on one of its tabs. */
async function settings(c, { who, scheme, theme, tab, size }) {
  const view = await table(c, { who, scheme, theme, size, recording: false, speaking: null });
  await view.page.click('button[aria-label="Settings"]');
  await c.sleep(900);
  const handle = await view.page.evaluateHandle(
    (t) =>
      [...document.querySelectorAll('[role="tab"]')].find((e) =>
        e.textContent.trim().startsWith(t),
      ),
    tab,
  );
  await handle.asElement()?.click();
  await c.sleep(700);
  return view;
}

/** Clicks the first element matching `selector` whose text includes `text`. */
async function clickText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t)),
    selector,
    text,
  );
  const el = handle.asElement();
  if (!el) throw new Error(`nothing to click with the text "${text}"`);
  await el.click();
}

/** The phone web app on one of its tabs. */
async function phoneTab(c, { who, scheme, tab }) {
  const view = await c.phone({ who, scheme });
  await clickText(view.page, 'nav button, nav a, [role="tab"], footer button', tab);
  await c.sleep(1200);
  return view;
}

export const SHOTS = {
  'desktop-table-gm': async (c) => {
    const { page } = await table(c, { who: 'gm', scheme: 'dark' });
    return c.frameWindow(page, { scheme: 'dark' });
  },
  'desktop-table-player': async (c) => {
    const { page } = await table(c, { who: 'cass', scheme: 'light', speaking: 'bram' });
    return c.frameWindow(page, { scheme: 'light' });
  },
  'desktop-soundboard': async (c) => {
    const { page } = await table(c, {
      who: 'gm',
      scheme: 'dark',
      theme: 'dungeon',
      speaking: null,
    });
    await page.click('button[aria-label="Sound effects and voices"]');
    await c.sleep(700);
    for (const panel of ['Stingers', 'Scenes']) {
      const button = await page.$(`button[aria-label^="Show"][aria-label*="${panel}" i]`);
      await button?.click();
      await c.sleep(500);
    }
    return c.frameWindow(page, { scheme: 'dark' });
  },
  'desktop-groups': async (c) => {
    const { page } = await table(c, {
      who: 'gm',
      scheme: 'light',
      theme: 'dragonfire',
      speaking: 'dorn',
    });
    await page.click('button[aria-label^="Voice groups"]');
    await c.sleep(700);
    return c.frameWindow(page, { scheme: 'light' });
  },
  'desktop-quality': async (c) => {
    const view = await settings(c, { who: 'gm', scheme: 'dark', tab: 'Quality', size: MAIN });
    c.reportStats();
    await c.sleep(1200);
    return c.frameWindow(view.page, { scheme: 'dark' });
  },
  'desktop-update': async (c) => {
    // The notice that a newer app is ready, with its release notes opened from "More info".
    const update = {
      version: '0.5.2',
      current: '0.5.1',
      notes:
        'Session summaries become a story, and records run much faster on a CPU-only server. A **PATCH** release: no protocol change.\n\n### Changed\n\n- **Summaries are now a story.** A scribe notes what happened; a bard tells the tale.\n- **The app\u2019s own audio engine is now the default.**\n\n### Fixed\n\n- **Windows: opening a popup no longer freezes the app.**',
    };
    const { page } = await table(c, {
      who: 'aria',
      scheme: 'dark',
      recording: false,
      options: { update },
    });
    // The app first looks for an update 15 seconds after its window opens.
    await page.waitForSelector('.vtt-update', { timeout: 30000 });
    await page.click('.vtt-update .vtt-more');
    await c.sleep(600);
    return c.frameWindow(page, { scheme: 'dark' });
  },
  'desktop-history': async (c) => {
    const { page } = await history(c, { who: 'cass', scheme: 'light', size: [640, 780] });
    return c.frameWindow(page, { title: 'Session history — VTT Chat', scheme: 'light' });
  },
  'desktop-history-gm': async (c) => {
    const { page } = await history(c, { who: 'gm', scheme: 'dark', size: [640, 780] });
    await openTab(page, c, 'The Heroes');
    return c.frameWindow(page, { title: 'Session history — VTT Chat', scheme: 'dark' });
  },
  'desktop-history-notes': async (c) => {
    const { page } = await history(c, { who: 'gm', scheme: 'dark', size: [640, 780] });
    await openTab(page, c, 'The Notes');
    return c.frameWindow(page, { title: 'Session history — VTT Chat', scheme: 'dark' });
  },
  'desktop-loot': async (c) => {
    const { page } = await c.desktop({
      route: 'inventory',
      who: 'gm',
      scheme: 'dark',
      theme: 'arcane',
      size: [520, 820],
    });
    return c.frameWindow(page, { title: 'Party inventory — VTT Chat', scheme: 'dark' });
  },
  'desktop-loot-player': async (c) => {
    const { page } = await c.desktop({
      route: 'inventory',
      who: 'aria',
      scheme: 'light',
      size: [520, 620],
    });
    return c.frameWindow(page, { title: 'Party inventory — VTT Chat', scheme: 'light' });
  },
  'desktop-handouts': async (c) => {
    const { page } = await c.desktop({
      route: 'handouts',
      who: 'gm',
      scheme: 'light',
      size: [520, 700],
    });
    return c.frameWindow(page, { title: 'Handouts — VTT Chat', scheme: 'light' });
  },
  'desktop-settings-audio': async (c) => {
    const { page } = await settings(c, { who: 'aria', scheme: 'light', tab: 'Audio', size: MAIN });
    return c.frameWindow(page, { scheme: 'light' });
  },
  'desktop-settings-sessions': async (c) => {
    const { page } = await settings(c, {
      who: 'aria',
      scheme: 'dark',
      theme: 'verdant',
      tab: 'Sessions',
      size: MAIN,
    });
    return c.frameWindow(page, { scheme: 'dark' });
  },
  'desktop-settings-campaign': async (c) => {
    const { page } = await settings(c, { who: 'gm', scheme: 'light', tab: 'Campaign', size: MAIN });
    return c.frameWindow(page, { scheme: 'light' });
  },
  'phone-chat': async (c) => {
    const { page } = await c.phone({ who: 'aria', scheme: 'dark' });
    return c.framePhone(page);
  },
  'phone-sessions': async (c) => {
    const { page } = await phoneTab(c, { who: 'bram', scheme: 'light', tab: 'Sessions' });
    return c.framePhone(page);
  },
  'phone-handouts': async (c) => {
    const { page } = await phoneTab(c, { who: 'elle', scheme: 'light', tab: 'Handouts' });
    return c.framePhone(page);
  },
  'phone-loot': async (c) => {
    const { page } = await phoneTab(c, { who: 'aria', scheme: 'dark', tab: 'Loot' });
    return c.framePhone(page);
  },
  'phone-history': async (c) => {
    const { page } = await phoneTab(c, { who: 'dorn', scheme: 'light', tab: 'History' });
    await clickText(page, 'main button, main [role="button"], main summary, main li', 'min');
    await c.sleep(1200);
    return c.framePhone(page);
  },
  'web-status': async (c) => {
    const { page } = await c.phone({
      path: '/status',
      who: null,
      scheme: 'light',
      mobile: false,
      size: [1000, 900],
    });
    return c.frameWindow(page, { title: 'Status — VTT Chat', scheme: 'light' });
  },
  'web-home': async (c) => {
    const { page } = await c.phone({
      path: '/',
      who: null,
      scheme: 'dark',
      mobile: false,
      size: [1000, 800],
    });
    return c.frameWindow(page, { title: 'VTT Chat', scheme: 'dark' });
  },
  'web-download': async (c) => {
    const { page } = await c.phone({
      path: '/download',
      who: 'aria',
      scheme: 'light',
      mobile: false,
      size: [1000, 760],
    });
    return c.frameWindow(page, { title: 'Download — VTT Chat', scheme: 'light' });
  },
  'operator-console': async (c) => {
    // Real output from the smoke stack. Listings are cut to their last lines.
    const run = async (args, last) => {
      const out = (await c.admin(...args)).trimEnd().split('\n');
      return [`$ vtt-admin ${args.join(' ')}`, ...(last ? out.slice(-last) : out), ''];
    };
    const text = [
      ...(await run(['status'])),
      ...(await run(['recording', 'list'], 3)),
      ...(await run(['jobs', 'list', 'done'], 3)),
      ...(await run(['updates', 'status'])),
    ].join('\n');
    return c.terminal({ text: text.trimEnd() });
  },
};
