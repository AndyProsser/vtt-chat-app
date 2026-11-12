import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '@vtt-chat-app/shared';
import { z } from 'zod';

import { clientData, PROTOCOL_VERSION as ENVELOPE_VERSION } from '../realtime/protocol.js';

/**
 * The machine-readable part of the wire contract between this server and its clients (the desktop app's
 * Rust crates, the web pages): the client → server frame schemas, the server → client event names, and the
 * REST route table. It is hashed and compared with `shared/protocol.contract.json` by `contract.test.ts`,
 * so a change to any of it is a deliberate, visible act (docs/architecture/VERSIONING-AND-DEPLOYMENT.md §1).
 *
 * What this cannot see: the *shape* of REST bodies and of server → client event payloads (they are built
 * inline, not declared as schemas). Changing one of those still needs a PROTOCOL_VERSION decision by a human;
 * the route and event lists catch the common ways of getting there (a new or renamed route or event).
 */
export interface Contract {
  protocolVersion: number;
  protocolHeader: string;
  envelopeVersion: number;
  clientFrames: Record<string, unknown>;
  serverEvents: string[];
  restRoutes: string[];
}

const LIB = fileURLToPath(new URL('..', import.meta.url));

/** Every non-test `.ts` file under `backend/src/lib`, in a stable order. */
function sources(dir = LIB): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

const sorted = <T>(values: Iterable<T>): T[] => [...new Set(values)].sort();

/** Orders object keys recursively so the JSON text does not depend on declaration order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** Event names passed to `send` / `broadcast` / `broadcastToCampaign` / `sendToUser` / `emit` / replay `append` as a literal. */
const EVENT_CALL =
  /\b(?:send|broadcast|broadcastToCampaign|sendToUser|emit|append)\(\s*(?:[\w.]+\s*,\s*)?(['`])([a-z][\w.${}-]*)\1/g;
/** Route registrations: `router.get('/path'`, `app.post('/api/x'`. */
const ROUTE_CALL = /\b(?:router|app)\.(get|post|put|patch|delete)\(\s*'([^']+)'/g;
/** Router mounts in app.ts, which give the route files their prefix. */
const MOUNT_CALL = /\bapp\.use\(\s*'(\/[^']*)'/g;

export function buildContract(): Contract {
  const events = new Set<string>();
  const routes = new Set<string>();
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(EVENT_CALL)) {
      // Some `emit(` calls are not WebSocket events (e.g. the audio router's); only dotted names or the
      // few bare event names the hub uses are server → client frames.
      if (m[2]!.includes('.') || ['error', 'snapshot', 'resumed'].includes(m[2]!))
        events.add(m[2]!);
    }
    const rel = file.slice(LIB.length);
    for (const m of text.matchAll(ROUTE_CALL)) routes.add(`${rel} ${m[1]!.toUpperCase()} ${m[2]}`);
    if (rel === 'app.ts')
      for (const m of text.matchAll(MOUNT_CALL)) routes.add(`app.ts USE ${m[1]}`);
  }
  const clientFrames = Object.fromEntries(
    Object.entries(clientData).map(([name, schema]) => [name, z.toJSONSchema(schema)]),
  );
  return {
    protocolVersion: PROTOCOL_VERSION,
    protocolHeader: PROTOCOL_HEADER,
    envelopeVersion: ENVELOPE_VERSION,
    clientFrames: canonical(clientFrames) as Record<string, unknown>,
    serverEvents: sorted(events),
    restRoutes: sorted(routes),
  };
}

export interface ContractFile {
  protocolVersion: number;
  hash: string;
  summary: { clientFrames: string[]; serverEvents: string[]; restRoutes: string[] };
}

/** The committed record: version, the hash of the canonical contract, and a readable summary for reviews. */
export function contractFile(contract: Contract = buildContract()): ContractFile {
  const hash = createHash('sha256').update(JSON.stringify(contract)).digest('hex');
  return {
    protocolVersion: contract.protocolVersion,
    hash,
    summary: {
      clientFrames: Object.keys(contract.clientFrames).sort(),
      serverEvents: contract.serverEvents,
      restRoutes: contract.restRoutes,
    },
  };
}

export const CONTRACT_PATH = fileURLToPath(
  new URL('../../../../shared/protocol.contract.json', import.meta.url),
);
