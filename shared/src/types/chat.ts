/**
 * What a line of table chat is. Decided in docs/architecture/CHAT-COMMANDS.md: everything is in character
 * (`chat`) unless marked, and `ooc` (out of character) is the only kind kept out of the recording.
 */
export type ChatKind = 'chat' | 'say' | 'do' | 'ooc';

/** A per-language look for `say-<language>` lines: system font stacks only, chosen by the UI. */
export type ChatLanguageStyle =
  'plain' | 'flowing' | 'blocky' | 'angular' | 'rounded' | 'scratchy' | 'arcane' | 'mono';

export interface ChatLanguage {
  /** The wire key: what `lang` carries and what the server validates against. */
  key: string;
  /** "Elvish", "Deep Speech": shown in the caption ("in Elvish"). */
  name: string;
  style: ChatLanguageStyle;
  /** Other spellings accepted after `/say-` (never sent on the wire). */
  aliases: readonly string[];
}

/** Someone at the table, as the composer knows them. */
export interface ChatMember {
  id: string;
  name: string;
  characterName?: string | null;
  role: 'dm' | 'player';
}

export interface ChatContext {
  selfId: string;
  members: readonly ChatMember[];
}

export type ChatRsvp = 'late' | 'no';

/** What the composer should do with the typed line. */
export type ParsedComposerInput =
  | { type: 'send'; kind: ChatKind; lang?: string; text: string }
  | { type: 'whisper'; recipientId: string; text: string }
  | { type: 'quick'; kind: 'ooc'; text: string; rsvp?: ChatRsvp }
  | { type: 'error'; message: string };

export interface ChatCommand {
  /** Without the slash. */
  name: string;
  aliases: readonly string[];
  usage: string;
  description: string;
  /** `whisper` commands become private lines; the rest set the kind of a public line. */
  kind: ChatKind | 'whisper';
}

export interface ChatSuggestion {
  /** What the list shows. */
  label: string;
  /** The full replacement text for the composer line. */
  insert: string;
  description: string;
}

export interface ChatSuggestions {
  kind: 'commands' | 'members' | 'languages' | 'none';
  items: ChatSuggestion[];
}
