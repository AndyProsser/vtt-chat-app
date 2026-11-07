import { CHAT_LIMIT } from '../consts/index.js';
import type { ChatLine, Member, SyncEvent, TableState } from '../types/index.js';

export const emptyTable: TableState = { members: [], chat: [] };

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
      return { members, chat: mergeChat(whispers, recent) };
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
    default:
      return state;
  }
}

/** The people one can whisper: everyone but oneself. */
export function whisperTargets(members: Member[], selfId: string | null): Member[] {
  return members.filter((m) => m.userId !== selfId);
}
