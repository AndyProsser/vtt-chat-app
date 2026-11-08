/* eslint-disable @typescript-eslint/no-explicit-any -- the library API returns loosely typed JSON */
// Loads CC0 sound effects into a DM's soundboard library: sounds (numbered variants become takes of
// one sound) and boards of buttons grouped by name. Run it as the DM account that will use them.
//
//   node scripts/sounds/import.ts --from ./my-sounds
//   node scripts/sounds/import.ts --kenney            # Kenney's CC0 "RPG Audio" and "Impact Sounds" packs
//   (add --dev to sign in as the seeded dev DM; otherwise set VTT_SERVER, VTT_EMAIL and VTT_PASSWORD)
//
// --kenney fetches CC0 repackagings of Kenney's packs from GitHub (kenney.nl itself blocks scripts).
// Every pack here is CC0: see docs/LEGAL-SOUNDS.md. Passwords are read from the environment, never printed.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { planBoards, planSounds } from '../../shared/src/sounds/importPlan.ts';
import { loadState } from '../dev/lib.ts';

const MAX_BYTES = 5 * 1024 * 1024;
const KENNEY_REPOS = [
  'Boyquotes/kenney-rpg-audio-for-godot',
  'Boyquotes/kenney-impact-sounds-for-godot',
];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

async function fetchKenney(): Promise<string[]> {
  const root = mkdtempSync(path.join(tmpdir(), 'kenney-'));
  const folders: string[] = [];
  for (const repo of KENNEY_REPOS) {
    const response = await fetch(`https://api.github.com/repos/${repo}/tarball`);
    if (!response.ok) throw new Error(`${repo}: ${response.status}`);
    const folder = path.join(root, path.basename(repo));
    execFileSync('mkdir', ['-p', folder]);
    execFileSync('tar', ['xz', '-C', folder, '--strip-components=1'], {
      input: Buffer.from(await response.arrayBuffer()),
    });
    folders.push(folder);
  }
  return folders;
}

interface Session {
  server: string;
  token: string;
}

async function signIn(): Promise<Session> {
  let server = process.env.VTT_SERVER ?? 'http://127.0.0.1:3000';
  let email = process.env.VTT_EMAIL;
  let password = process.env.VTT_PASSWORD;
  if (flag('--dev')) {
    const dm = loadState().people.find((p) => p.role === 'dm');
    if (!dm) throw new Error('no dev DM: run `npm run dev:seed` first');
    server = process.env.VTT_SERVER ?? 'http://127.0.0.1:3000';
    email = dm.email;
    password = dm.password;
  }
  if (!email || !password) throw new Error('set VTT_EMAIL and VTT_PASSWORD (or use --dev)');
  const r = await fetch(`${server}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`could not sign in (${r.status})`);
  return { server, token: ((await r.json()) as any).sessionToken };
}

async function api(
  s: Session,
  method: string,
  route: string,
  body?: unknown,
  raw?: Buffer,
): Promise<any> {
  const r = await fetch(`${s.server}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${s.token}`,
      ...(raw
        ? { 'Content-Type': 'application/octet-stream' }
        : body
          ? { 'Content-Type': 'application/json' }
          : {}),
    },
    ...(raw ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${route}: ${r.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : undefined;
}

async function main(): Promise<void> {
  const folders = flag('--kenney')
    ? await fetchKenney()
    : value('--from')
      ? [value('--from')!]
      : [];
  if (folders.length === 0) throw new Error('give a folder with --from <dir>, or use --kenney');
  const files = folders.flatMap(walk);
  const plan = planSounds(files);
  console.log(`${files.length} files → ${plan.length} sounds`);

  const session = await signIn();
  const library = await api(session, 'GET', '/api/soundboard/library');
  const known = new Map<string, string>(
    (library.sounds ?? []).map(
      (s: any) => [String(s.name).toLowerCase(), String(s.id)] as [string, string],
    ),
  );
  const ids = new Map<string, string>();
  let added = 0;
  let skipped = 0;
  for (const sound of plan) {
    const existing = known.get(sound.name.toLowerCase());
    if (existing) {
      ids.set(sound.name, existing);
      skipped += 1;
      continue;
    }
    let id: string | undefined;
    for (const file of sound.files) {
      const bytes = readFileSync(file);
      if (bytes.length > MAX_BYTES) continue;
      const filename = encodeURIComponent(path.basename(file));
      if (!id) {
        const created = await api(
          session,
          'POST',
          `/api/soundboard/sounds/upload?name=${encodeURIComponent(sound.name)}&category=effect&filename=${filename}`,
          undefined,
          bytes,
        );
        id = created.sound.id as string;
      } else {
        await api(
          session,
          'POST',
          `/api/soundboard/sounds/${id}/takes?filename=${filename}`,
          undefined,
          bytes,
        );
      }
    }
    if (id) {
      ids.set(sound.name, id);
      added += 1;
      if (added % 25 === 0) console.log(`  ${added} sounds uploaded…`);
    }
  }

  const haveBoards = new Set((library.boards ?? []).map((b: any) => String(b.name).toLowerCase()));
  let boards = 0;
  for (const board of planBoards(plan)) {
    if (haveBoards.has(board.name.toLowerCase())) continue;
    const buttons = board.buttons
      .filter((b) => ids.has(b.soundName))
      .map((b) => ({
        label: b.label,
        soundId: ids.get(b.soundName)!,
        mode: 'oneshot',
        volume: 0.8,
      }));
    if (buttons.length === 0) continue;
    await api(session, 'POST', '/api/soundboard/boards', { name: board.name, buttons });
    boards += 1;
  }
  console.log(`done: ${added} sounds added, ${skipped} already there, ${boards} boards made.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
