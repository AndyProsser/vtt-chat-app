// Where the stack under test runs: this machine (`local`, the Compose stack on the dev PC) or a remote host
// (`vm`, over SSH). Everything the runner and the monitor need from a machine goes through `run`, so the same
// tool measures both. The remote host's address comes from the environment and is never written to a file in the repo.
//
//   local: VTT_API (default https://localhost), VTT_COMPOSE_DIR (default infra/compose)
//   vm:    VTT_VM_SSH (user@host, required), VTT_API (the server's public URL, required),
//          VTT_VM_COMPOSE_DIR (default /opt/vtt-chat)

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Target {
  /** `local` or `vm`: a word for the report and the results folder, never an address. */
  label: string;
  kind: 'local' | 'ssh';
  /** The server's URL as a player reaches it, for latency probes and the API. */
  apiBase: string;
  composeDir: string;
  /** Runs a bash script on the target and returns its stdout (stderr is returned in the error). */
  run(script: string, timeoutMs?: number): Promise<string>;
  /** The Admin CLI on the target, `--plain`. Its output can hold a sign-in code: return it, never log it. */
  admin(...args: string[]): Promise<string>;
  /** Runs a query in the stack's Postgres and returns the plain rows. */
  sql(query: string): Promise<string>;
  close(): Promise<void>;
}

const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function spawnScript(
  cmd: string,
  args: string[],
  script: string,
  timeoutMs: number,
  cwd?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error(`timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += String(d)));
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`exit ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
    p.stdin.end(script);
  });
}

export function localTarget(): Target {
  const composeDir = process.env.VTT_COMPOSE_DIR ?? path.resolve(here, '../../compose');
  const run = (script: string, timeoutMs = 30_000) =>
    spawnScript('bash', ['-s'], script, timeoutMs, composeDir);
  const t: Target = {
    label: 'local',
    kind: 'local',
    apiBase: (process.env.VTT_API ?? 'https://localhost').replace(/\/+$/, ''),
    composeDir,
    run,
    admin: (...args) =>
      run(`${shq(path.join(composeDir, 'vtt-admin'))} ${args.map(shq).join(' ')} --plain`, 120_000),
    sql: async (q) =>
      (
        await run(`docker compose exec -T postgres psql -U vtt -d vtt -At -c ${shq(q)}`, 60_000)
      ).trim(),
    close: async () => {},
  };
  return t;
}

export function sshTarget(): Target {
  const host = process.env.VTT_VM_SSH;
  if (!host) throw new Error('set VTT_VM_SSH (user@host) to measure the VM');
  const api = process.env.VTT_API;
  if (!api) throw new Error("set VTT_API to the VM server's URL as players reach it");
  const composeDir = process.env.VTT_VM_COMPOSE_DIR ?? '/opt/vtt-chat';
  const control = path.join(tmpdir(), `vtt-validation-ssh-${process.pid}`);
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-o',
    'ControlMaster=auto',
    '-o',
    `ControlPath=${control}`,
    '-o',
    'ControlPersist=120',
    host,
    'bash -s',
  ];
  const run = (script: string, timeoutMs = 30_000) => spawnScript('ssh', args, script, timeoutMs);
  return {
    label: 'vm',
    kind: 'ssh',
    apiBase: api.replace(/\/+$/, ''),
    composeDir,
    run,
    admin: (...args) => run(`vtt-admin ${args.map(shq).join(' ')} --plain`, 120_000),
    sql: async (q) =>
      (
        await run(
          `cd ${shq(composeDir)} && docker compose exec -T postgres psql -U vtt -d vtt -At -c ${shq(q)}`,
          60_000,
        )
      ).trim(),
    close: async () => {
      try {
        await spawnScript('ssh', ['-O', 'exit', '-o', `ControlPath=${control}`, host], '', 5_000);
      } catch {
        /* no master to close */
      }
    },
  };
}

export const targetByName = (name: string): Target => {
  if (name === 'local') return localTarget();
  if (name === 'vm') return sshTarget();
  throw new Error(`unknown target "${name}" (local or vm)`);
};

export { shq };
