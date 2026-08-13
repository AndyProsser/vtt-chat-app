// Builds and launches the full local dev stack in one command: LiveKit dev server, the backend,
// the overlay bundle, then the Tauri client — see DEVELOPING.md#running-stage-1-locally for the
// manual four-step version this automates. Cross-platform (Windows/macOS/Linux) via Node's
// built-in child_process rather than shell scripts, since Node 26+ is already a hard requirement
// on every platform (CLAUDE.md §3) and this repo has no other cross-platform shell tooling.
//
// Run via `npm run dev` from the repo root.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const IS_WINDOWS = process.platform === 'win32';

interface Tracked {
  label: string;
  child: ChildProcess;
  /** POSIX only: was this child spawned `detached` (its own process-group leader)? Determines
   * whether cleanup signals its group (`-pid`) or just the process itself (`pid`). */
  isGroupLeader: boolean;
}

// Every spawned child is tracked here, foreground and background alike — an interactive Ctrl+C
// already reaches everything in the terminal's foreground process group for free, but that isn't
// guaranteed for every way this script can be stopped (a CI runner, an IDE "stop" button, a
// `timeout`-wrapped invocation), so cleanup below doesn't rely on it and explicitly signals
// every tracked child itself.
const tracked: Tracked[] = [];
let shuttingDown = false;

function log(label: string, ...args: unknown[]): void {
  console.log(`[${label}]`, ...args);
}

function commandExists(command: string): boolean {
  const checker = IS_WINDOWS ? 'where' : 'which';
  return spawnSync(checker, [command], { stdio: 'ignore' }).status === 0;
}

function track(label: string, child: ChildProcess, isGroupLeader: boolean): ChildProcess {
  tracked.push({ label, child, isGroupLeader });
  return child;
}

// Foreground step: resolves once the process exits 0, rejects otherwise. Used for the two builds
// (which must finish before anything depending on their output starts) and for the Tauri client
// itself, so its exit — including one delivered by cleanup() below — resolves `main()`.
function run(label: string, command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log(label, `$ ${command} ${args.join(' ')}`);
    const child = track(
      label,
      spawn(command, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS }),
      false,
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || shuttingDown) resolve();
      else reject(new Error(`${label}: \`${command} ${args.join(' ')}\` exited with code ${code}`));
    });
  });
}

// Background step: LiveKit and the backend stay up for the whole session, started and forgotten —
// unlike `run()`, nothing awaits their exit, so a crash needs its own log line to be noticed at
// all. `detached: true` on POSIX makes the child its own process-group leader, so cleanup() can
// take down everything it spawned (e.g. `npm start` -> node) with one signal to the negative pid,
// not just the immediate child — `npm start` itself would otherwise survive a signal to its own pid.
function spawnBackground(label: string, command: string, args: string[], cwd: string): void {
  log(label, `$ ${command} ${args.join(' ')} (background)`);
  const child = track(
    label,
    spawn(command, args, { cwd, stdio: 'inherit', shell: IS_WINDOWS, detached: !IS_WINDOWS }),
    !IS_WINDOWS,
  );
  child.on('exit', (code) => {
    if (!shuttingDown) log(label, `exited unexpectedly with code ${code}`);
  });
}

function cleanup(): void {
  shuttingDown = true;
  for (const { label, child, isGroupLeader } of tracked.reverse()) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    log(label, 'stopping...');
    try {
      if (IS_WINDOWS) {
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        process.kill(isGroupLeader ? -child.pid : child.pid, 'SIGTERM');
      }
    } catch {
      // Already exited between the exitCode check and here — nothing to do.
    }
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

async function main(): Promise<void> {
  if (!commandExists('cargo')) {
    throw new Error(
      'cargo not found on PATH — install Rust via https://rustup.rs (see DEVELOPING.md#requirements).',
    );
  }

  // LiveKit is a soft dependency: the client still launches without it, just without working
  // voice, matching this codebase's degrade-gracefully pattern elsewhere (e.g. src-tauri starting
  // without the overlay bundle rather than refusing to launch).
  if (commandExists('livekit-server')) {
    spawnBackground('livekit', 'livekit-server', ['--dev'], ROOT);
  } else {
    log(
      'livekit',
      'livekit-server not found on PATH — skipping. Voice will not connect; see livekit/README.md.',
    );
  }

  const backendDir = path.join(ROOT, 'backend');
  await run('backend-build', 'npm', ['run', 'build'], backendDir);
  spawnBackground('backend', 'npm', ['start'], backendDir);

  // Must finish before the Tauri client starts — src-tauri reads dist/overlay.js from disk once,
  // at startup (DEVELOPING.md step 3).
  await run('overlay-ui', 'npm', ['run', 'build'], path.join(ROOT, 'tauri-client/overlay-ui'));

  // Foreground: this is the process the developer is here for. Its own exit — interactive Ctrl+C,
  // a crash, or cleanup() above reaching it via a non-interactive stop — resolves this and falls
  // through to the `finally` below, which tears down LiveKit + backend.
  await run('tauri', 'cargo', ['run', '--bin', 'vtt-chat-app'], path.join(ROOT, 'tauri-client'));
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(cleanup);
