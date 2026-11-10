import { z } from 'zod';

/** Bumped only for a breaking change; the server refuses other majors (SYNC-PROTOCOL.md). */
export const PROTOCOL_VERSION = 1;

/** The outer shape of every client → server frame. `d` is validated per type below. */
const envelope = z.object({
  v: z.number(),
  t: z.string().max(64),
  id: z.string().max(64).optional(),
  d: z.unknown().optional(),
});

const campaignId = z.string().min(1).max(64);

/** Data schemas for each client → server frame type. */
export const clientData = {
  auth: z.object({ token: z.string().min(1).max(512) }),
  // Subscribe to a campaign's live stream. `lastSeq` is the last event this client saw, and `epoch`
  // names the event stream that number belongs to (from the last snapshot/resumed). A sequence
  // number is only meaningful within its epoch, so the server replays only when both match.
  resume: z.object({
    campaignId,
    lastSeq: z.number().int().nonnegative().optional(),
    epoch: z.string().max(64).optional(),
  }),
  // Audio-connected clients only; an idle client sends nothing but WebSocket pings.
  // `status` is the player's own choice; clients that predate it send none and get online/offline
  // from `inVoice`.
  'audio.state': z.object({
    campaignId,
    inVoice: z.boolean(),
    muted: z.boolean(),
    status: z.enum(['online', 'away', 'offline']).optional(),
  }),
  'speaking.set': z.object({ campaignId, speaking: z.boolean() }),
  'stats.report': z.object({
    campaignId,
    rttMs: z.number().min(0).max(60_000),
    jitterMs: z.number().min(0).max(60_000),
    packetLossPct: z.number().min(0).max(100),
  }),
  // `to` set = a whisper, private to the sender and that member; omitted = said to the whole table.
  'chat.message': z.object({
    campaignId,
    text: z.string().min(1).max(4000),
    to: z.string().min(1).max(64).optional(),
  }),
  // The DM's soundboard (docs/architecture/TABLE-FEATURES.md). DM-only; the server checks.
  'sound.play': z.object({
    campaignId,
    soundId: z.string().min(1).max(64),
    takeId: z.string().min(1).max(64).optional(),
    mode: z.enum(['oneshot', 'loop']).optional(),
    volume: z.number().min(0).max(1).optional(),
    to: z.array(z.string().min(1).max(64)).max(50).optional(),
  }),
  'sound.stop': z.object({ campaignId, playId: z.string().min(1).max(64).optional() }),
  'scene.start': z.object({ campaignId, sceneId: z.string().min(1).max(64) }),
  'scene.stop': z.object({ campaignId }),
  'sound.volume': z.object({
    campaignId,
    master: z.number().min(0).max(1).optional(),
    player: z
      .object({ userId: z.string().min(1).max(64), gain: z.number().min(0).max(2) })
      .optional(),
  }),
  // Voice groups. DM-only; the server checks. The DM is in every group; players hear only their own.
  'party.create': z.object({
    campaignId,
    name: z.string().min(1).max(60),
    // Players to put in it straight away (dropping someone on "new group").
    members: z.array(z.string().min(1).max(64)).max(50).optional(),
  }),
  'party.rename': z.object({
    campaignId,
    partyId: z.string().min(1).max(64),
    name: z.string().min(1).max(60),
  }),
  'party.delete': z.object({ campaignId, partyId: z.string().min(1).max(64) }),
  'party.move': z.object({
    campaignId,
    userId: z.string().min(1).max(64),
    partyId: z.string().min(1).max(64).nullable(),
  }),
  'party.reset': z.object({ campaignId }),
  // "I have heard the recording-start cue for this recording" — sent after the cue finished playing.
  'recording.ack': z.object({ campaignId, recordingId: z.string().min(1).max(64) }),
} as const;

export type ClientType = keyof typeof clientData;
export type ClientData<T extends ClientType> = z.infer<(typeof clientData)[T]>;

export interface ClientFrame {
  type: ClientType;
  id: string | undefined;
  data: unknown;
}

export type ParseResult =
  | { ok: true; frame: ClientFrame }
  | {
      ok: false;
      code: 'bad_frame' | 'unsupported_version' | 'unknown_type' | 'bad_data';
      message: string;
    };

/** Parses one text frame. Never throws: a hostile or buggy client gets an error code back. */
export function parseClientFrame(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_frame', message: 'frame is not valid JSON' };
  }
  const outer = envelope.safeParse(json);
  if (!outer.success) return { ok: false, code: 'bad_frame', message: 'malformed envelope' };
  if (outer.data.v !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `protocol version ${outer.data.v} is not supported; update the app`,
    };
  }
  // `hasOwn`, not a plain lookup: "constructor" or "__proto__" must not resolve to an inherited property.
  if (!Object.hasOwn(clientData, outer.data.t))
    return { ok: false, code: 'unknown_type', message: `unknown frame type "${outer.data.t}"` };
  const type = outer.data.t as ClientType;
  const schema = clientData[type];

  const data = schema.safeParse(outer.data.d ?? {});
  if (!data.success) return { ok: false, code: 'bad_data', message: `invalid data for "${type}"` };
  return { ok: true, frame: { type, id: outer.data.id, data: data.data } };
}

/** Builds a server → client frame. `seq` is present only on replayable, per-campaign events. */
export function serverFrame(
  t: string,
  d: unknown,
  options: { seq?: number; ts: number; id?: string },
): string {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    t,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.seq === undefined ? {} : { seq: options.seq }),
    ts: options.ts,
    d,
  });
}
