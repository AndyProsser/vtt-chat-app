import { CHAT_LIMIT } from '../consts/index.js';
import type {
  ChatLine,
  Member,
  PartyView,
  RecordingAction,
  RecordingView,
  SyncEvent,
  ClaimedFor,
  ItemType,
  LootSplit,
  Rarity,
  TableCard,
  TableState,
} from '../types/index.js';

export const emptyParties: PartyView = { parties: [], assignments: {}, split: false };
export const emptyTable: TableState = {
  members: [],
  chat: [],
  cards: [],
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

function toMembers(raw: unknown): Member[] {
  return (Array.isArray(raw) ? raw : []).map((m) => {
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
    case 'roster.update':
      return { ...state, members: toMembers(d.members) };
    case 'snapshot': {
      const members = toMembers(d.members);
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
    case 'loot.dropped':
    case 'loot.claimed':
    case 'loot.removed':
    case 'handout.shown':
    case 'handout.removed':
      return applyCard(state, event.t, d);
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
          ? {
              recordingId: r.recordingId,
              capturing: r.capturing !== false,
              startedAt: asStart(r.startedAt),
            }
          : null;
      return sameRecording(state.recording, next) ? state : { ...state, recording: next };
    }
    case 'recording.status': {
      const id = String(d.recordingId ?? '');
      const sameRun = state.recording?.recordingId === id;
      const next: RecordingView | null =
        d.status === 'STOPPED'
          ? null
          : {
              recordingId: id,
              capturing: d.status !== 'PAUSED',
              startedAt: asStart(d.startedAt) ?? (sameRun ? state.recording!.startedAt : null),
            };
      return sameRecording(state.recording, next) ? state : { ...state, recording: next };
    }
    default:
      return state;
  }
}

const asStart = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

function sameRecording(a: RecordingView | null, b: RecordingView | null): boolean {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.recordingId === b.recordingId &&
      a.capturing === b.capturing &&
      a.startedAt === b.startedAt)
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

const lastChatId = (state: TableState): string | null => state.chat.at(-1)?.id ?? null;

function patchCard(cards: TableCard[], id: string, patch: Partial<TableCard>): TableCard[] {
  return cards.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/** Loot and handout notices. Idempotent: replaying the same events never duplicates or un-claims. */
function applyCard(state: TableState, type: string, d: Obj): TableState {
  const kind = type.startsWith('loot') ? 'loot' : 'handout';
  const rawId = String(kind === 'loot' ? d.itemId : d.handoutId);
  const id = `${kind}:${rawId}`;
  const existing = state.cards.find((c) => c.id === id);
  const removed = type.endsWith('.removed');
  if (removed) {
    return existing && !existing.removed
      ? { ...state, cards: patchCard(state.cards, id, { removed: true }) }
      : state;
  }
  if (type === 'loot.claimed') {
    const claim = {
      claimedBy: typeof d.claimedBy === 'string' ? d.claimedBy : null,
      claimedFor: asClaimedFor(d.claimedFor),
      split: asSplit(d.split),
    };
    if (existing) {
      return existing.claimedBy === claim.claimedBy
        ? state
        : { ...state, cards: patchCard(state.cards, id, claim) };
    }
    // The drop was before this window's tail began: show the claim anyway.
    return { ...state, cards: [...state.cards, { ...newCard(state, id, kind, d), ...claim }] };
  }
  if (existing) return state;
  return { ...state, cards: [...state.cards, newCard(state, id, kind, d)] };
}

function newCard(state: TableState, id: string, kind: TableCard['kind'], d: Obj): TableCard {
  const title = String(kind === 'loot' ? (d.name ?? 'an item') : (d.title ?? 'a handout'));
  return kind === 'loot'
    ? {
        id,
        kind,
        title,
        quantity: Number(d.quantity ?? 1),
        ...(d.kind === 'coin' ? { coin: true } : {}),
        ...(typeof d.itemType === 'string' ? { itemType: d.itemType as ItemType } : {}),
        rarity: typeof d.rarity === 'string' ? (d.rarity as Rarity) : null,
        claimedBy: null,
        after: lastChatId(state),
      }
    : { id, kind, title, after: lastChatId(state) };
}

const asClaimedFor = (v: unknown): ClaimedFor | null =>
  v === 'self' || v === 'party' || v === 'split' || v === 'assigned' ? v : null;

function asSplit(v: unknown): LootSplit | null {
  const o = asObj(v);
  if (!Array.isArray(o.shares)) return null;
  return {
    shares: o.shares
      .map(asObj)
      .map((s) => ({ userId: String(s.userId), amount: Number(s.amount) })),
    remainder: Number(o.remainder ?? 0),
  };
}
