import { CHAT_LIMIT } from '../consts/index.js';
import type {
  ChatLine,
  Member,
  PartyView,
  RecordingAction,
  RecordingView,
  SyncEvent,
  TableState,
} from '../types/index.js';

export const emptyParties: PartyView = { parties: [], assignments: {}, split: false };
export const emptyTable: TableState = {
  members: [],
  chat: [],
  recording: null,
  parties: emptyParties,
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {});

function toLine(raw: unknown): ChatLine | undefined {
  const o = asObj(raw);
  const from = asObj(o.from);
  if (typeof o.id !== 'string' || typeof o.text !== 'string' || typeof from.userId !== 'string') {
    return undefined;
  }
  const to = asObj(o.to);
  return {
    id: o.id,
    from: { userId: from.userId, name: String(from.name ?? '') },
    ...(typeof to.userId === 'string'
      ? { to: { userId: to.userId, name: String(to.name ?? '') } }
      : {}),
    text: o.text,
    at: Number(o.at ?? 0),
  };
}

/** Adds lines, keeping one copy per id (a replay and a history fetch can overlap), oldest first. */
export function mergeChat(existing: ChatLine[], incoming: ChatLine[]): ChatLine[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  for (const line of incoming) byId.set(line.id, line);
  const all = [...byId.values()].sort((a, b) => a.at - b.at);
  return all.length > CHAT_LIMIT ? all.slice(all.length - CHAT_LIMIT) : all;
}

function patchMember(state: TableState, userId: string, patch: Partial<Member>): TableState {
  let changed = false;
  const members = state.members.map((m) => {
    if (m.userId !== userId) return m;
    const next = { ...m, ...patch };
    changed = (Object.keys(patch) as (keyof Member)[]).some((k) => m[k] !== next[k]) || changed;
    return next;
  });
  return changed ? { ...state, members } : state;
}

/**
 * Applies one event. Pure, and idempotent where it can be, so replaying the hydration tail over
 * live events never corrupts state. Unknown events leave the state untouched (same reference).
 */
export function applyEvent(state: TableState, event: SyncEvent): TableState {
  const d = asObj(event.d);
  switch (event.t) {
    case 'snapshot': {
      const members = (Array.isArray(d.members) ? d.members : []).map((m) => {
        const o = asObj(m);
        return {
          userId: String(o.userId),
          displayName: String(o.displayName ?? ''),
          role: o.role === 'dm' ? 'dm' : 'player',
          character: o.character ? (o.character as Member['character']) : null,
          online: o.online === true,
          inVoice: o.inVoice === true,
          muted: o.muted !== false,
        } satisfies Member;
      });
      const recent = (Array.isArray(d.recentChat) ? d.recentChat : [])
        .map(toLine)
        .filter((l): l is ChatLine => l !== undefined);
      // A snapshot is the whole truth about the table; whispers (not in it) are kept.
      const whispers = state.chat.filter((l) => l.to !== undefined);
      return { ...state, members, chat: mergeChat(whispers, recent) };
    }
    case 'chat.message':
    case 'chat.whisper': {
      const line = toLine(d);
      return line ? { ...state, chat: mergeChat(state.chat, [line]) } : state;
    }
    case 'chat.whispers': {
      const lines = (Array.isArray(d.whispers) ? d.whispers : [])
        .map(toLine)
        .filter((l): l is ChatLine => l !== undefined);
      return lines.length ? { ...state, chat: mergeChat(state.chat, lines) } : state;
    }
    case 'presence.update':
      return patchMember(state, String(d.userId), { online: d.online === true });
    case 'audio.update':
      return patchMember(state, String(d.userId), {
        inVoice: d.inVoice === true,
        muted: d.muted !== false,
      });
    case 'party.state': {
      const parties = (Array.isArray(d.parties) ? d.parties : [])
        .map(asObj)
        .filter((p) => typeof p.id === 'string')
        .map((p) => ({ id: String(p.id), name: String(p.name ?? '') }));
      const assignments: Record<string, string> = {};
      for (const [user, party] of Object.entries(asObj(d.assignments))) {
        if (typeof party === 'string') assignments[user] = party;
      }
      const next: PartyView = { parties, assignments, split: d.split === true };
      return { ...state, parties: next };
    }
    case 'recording.state': {
      const r = asObj(d.recording);
      const next: RecordingView | null =
        typeof r.recordingId === 'string'
          ? { recordingId: r.recordingId, capturing: r.capturing !== false }
          : null;
      return sameRecording(state.recording, next) ? state : { ...state, recording: next };
    }
    case 'recording.status': {
      const id = String(d.recordingId ?? '');
      const next: RecordingView | null =
        d.status === 'STOPPED' ? null : { recordingId: id, capturing: d.status !== 'PAUSED' };
      return sameRecording(state.recording, next) ? state : { ...state, recording: next };
    }
    default:
      return state;
  }
}

function sameRecording(a: RecordingView | null, b: RecordingView | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.recordingId === b.recordingId && a.capturing === b.capturing)
  );
}

/** Whether `selfId` is the DM at this table. The server enforces it; this only hides controls. */
export function isDm(members: Member[], selfId: string | null): boolean {
  return selfId !== null && members.some((m) => m.userId === selfId && m.role === 'dm');
}

/** The buttons that make sense for the current recording state. */
export function recordingActions(recording: RecordingView | null): RecordingAction[] {
  if (!recording) return ['start'];
  return recording.capturing ? ['pause', 'stop'] : ['resume', 'stop'];
}

/** The people one can whisper: everyone but oneself. */
export function whisperTargets(members: Member[], selfId: string | null): Member[] {
  return members.filter((m) => m.userId !== selfId);
}
