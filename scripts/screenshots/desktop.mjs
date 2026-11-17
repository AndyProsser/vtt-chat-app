// The Node half of the desktop stand-in: answers the commands the panels send to Rust (see
// tauri-stub.js), from the smoke stack, as one seat at the table. It mirrors what `src-tauri` does:
// account status, the hydrate (snapshot plus the events since), the REST relay, files as data: URLs.
// Anything about real audio or the operating system is a fixed, plausible answer.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { BASE, ROOT, api } from './lib.mjs';

const DIST = join(ROOT, 'tauri-client/panels-ui/dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.mjs': 'text/javascript',
};

/** Serves the built panels on a local port (the app serves the same files from its own bundle). */
export async function servePanels() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(DIST, path === '/' ? 'index.html' : path);
    try {
      if (!file.startsWith(DIST)) throw new Error('outside');
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

/** What a seat's socket has received, kept the way `bridge.rs` keeps it: last snapshot, then a tail. */
export function feed() {
  const state = { snapshot: null, tail: [], onLive: new Set() };
  const SKIP = new Set(['auth.ok', 'resumed', 'pong', 'error']);
  const LIVE_ONLY = new Set(['speaking.update', 'stats.update']);
  state.push = (frame) => {
    if (SKIP.has(frame.t)) return;
    const event = {
      t: frame.t,
      d: frame.d,
      ...(frame.seq !== undefined ? { seq: frame.seq } : {}),
    };
    if (frame.t === 'snapshot') {
      state.snapshot = event;
      state.tail = [];
    } else if (!LIVE_ONLY.has(frame.t)) state.tail.push(event);
    for (const live of state.onLive) live(event);
  };
  return state;
}

async function dataUrl(token, route) {
  const res = await fetch(`${BASE}${route}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw { code: 'not_found', message: 'that file is not there' };
  const mime = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

/**
 * Attaches the stand-in to a page. `seat` is who the app is signed in as; `table` is everyone's user id
 * (they are all "in voice"); `options` are the answers a shot may want to change.
 */
export async function attach(page, { seat, campaignId, feed: seatFeed, table, options = {} }) {
  const relay = async (method, route, body) => {
    const r = await api(method, route, seat.token, body ?? undefined);
    if (r.status >= 300) {
      throw {
        code: r.body?.error?.code ?? 'failed',
        message: r.body?.error?.message ?? `HTTP ${r.status}`,
      };
    }
    return r.body;
  };
  const campaignRoute = (path) =>
    path === ''
      ? `/api/campaigns/${campaignId}`
      : path.startsWith('soundboard')
        ? `/api/${path}`
        : `/api/campaigns/${campaignId}/${path}`;

  const fixed = {
    livekit_snapshot: () => [
      { connected: true, roomName: campaignId, participantIdentities: table },
      { muted: options.muted ?? false },
    ],
    status_get: () => 'online',
    away_minutes_get: () => 10,
    notify_prefs_get: () => ({
      chat: true,
      whispers: true,
      table: true,
      sessions: true,
      joinRequests: true,
      joinDecisions: true,
      quiet: null,
    }),
    audio_devices: () => ({
      inputs: [
        { id: 'mic-1', name: 'USB Condenser Microphone' },
        { id: 'mic-2', name: 'Headset Microphone' },
      ],
      outputs: [
        { id: 'out-1', name: 'Headphones' },
        { id: 'out-2', name: 'Speakers' },
      ],
      chosenInput: 'mic-1',
      chosenOutput: 'out-1',
    }),
    audio_engine: () => ({
      engine: 'mixer',
      active: 'mixer',
      micGain: 1.2,
      autoGain: true,
      noiseFilter: 'standard',
      volumes: {},
    }),
    mic_level: () => options.micLevel ?? 0.38,
    voice_effect_get: () => options.voice ?? 'normal',
    update_check: () => options.update ?? null,
    update_dev_builds_get: () => options.devBuilds ?? false,
    update_can_install: () => true,
    autostart_enabled: () => true,
    dev_signin_enabled: () => false,
    take_pending_connect: () => null,
    clipboard_picture: () => null,
    server_version_check: () => ({
      appVersion: '0.5.2',
      serverVersion: '0.5.2',
      relation: 'match',
    }),
  };

  const handlers = {
    async account_status() {
      const mine = await relay('GET', '/api/campaigns');
      return {
        signedIn: true,
        server: 'https://vtt.example.com',
        campaignId,
        userId: seat.userId,
        displayName: seat.displayName,
        avatarUrl: null,
        campaigns: mine.campaigns.map((c) => ({
          id: c.campaign.id,
          name: c.campaign.name,
          role: c.role,
          description: c.campaign.description ?? '',
          allowJoin: c.campaign.allowJoin ?? true,
        })),
      };
    },
    panel_hydrate: () => ({ snapshot: seatFeed.snapshot, events: seatFeed.tail }),
    campaign_api: ({ method, path, body }) => relay(method, campaignRoute(path), body),
    records_search: ({ query }) =>
      relay(
        'GET',
        `/api/campaigns/${campaignId}/recordings/search?q=${encodeURIComponent(query.trim())}&limit=20`,
      ),
    campaign_file: ({ path }) => dataUrl(seat.token, campaignRoute(path)),
    avatar_image: ({ id }) => dataUrl(seat.token, `/api/avatars/${id}`),
    ddb_api: ({ action }) => (action === 'status' ? { enabled: false } : { character: null }),
    join_api: ({ action }) =>
      action === 'open'
        ? relay('GET', '/api/campaigns/open')
        : action === 'list'
          ? relay('GET', `/api/campaigns/${campaignId}/join-requests`)
          : null,
  };

  const unknown = new Set();
  await page.exposeFunction('__vttInvoke', async (cmd, json) => {
    const args = JSON.parse(json);
    try {
      if (cmd in handlers) return JSON.stringify({ value: (await handlers[cmd](args)) ?? null });
      if (cmd in fixed) return JSON.stringify({ value: fixed[cmd]() });
      // Everything else changes something in the real app (a setting, the microphone); here it is a no-op.
      if (!unknown.has(cmd)) unknown.add(cmd);
      return JSON.stringify({ value: null });
    } catch (error) {
      const shaped =
        error && typeof error === 'object' && 'code' in error
          ? error
          : { code: 'failed', message: String(error?.message ?? error) };
      console.error(`[desktop] ${cmd} failed:`, shaped.message);
      return JSON.stringify({ error: shaped });
    }
  });
  await page.evaluateOnNewDocument(
    readFileSync(new URL('./tauri-stub.js', import.meta.url), 'utf8'),
  );

  const emit = (event, payload) =>
    page.evaluate((e, p) => window.__vttEmit?.(e, p), event, payload).catch(() => undefined);
  const live = (event) => void emit('sync:event', event);
  seatFeed.onLive.add(live);
  return { emit, noops: unknown, detach: () => seatFeed.onLive.delete(live) };
}
