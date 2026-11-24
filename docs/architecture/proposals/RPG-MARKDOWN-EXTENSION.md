# Language Spans in Markdown

**Status:** Proposed (2026-11-24, cut down from the first "RPG Markdown" draft). **Not built.** Comes **after the font work** ([ICONOLOGY.md](../ICONOLOGY.md), Stage 14), because it only draws what that work provides.
**Wire change:** none. The span is ordinary Markdown text stored as today.
**Plan:** Task 11 of [2026-11-24-typography-and-icons.md](../../superpowers/plans/2026-11-24-typography-and-icons.md).

## What this is for

The DM, and the AI storyteller when it writes a tale, can put a snippet **in a language** inside handouts, notes and
tales: an inscription in Dwarvish, a line of Elvish in the middle of a paragraph. It is drawn in that language's font,
exactly as a `/say-elvish` line is in chat, and it follows the same reading switches (force readable turns it to Inter).

That is the whole feature. The story stays the centre: tales and handouts stay plain Markdown that reads fine
anywhere, with this as one small garnish.

## Syntax

It should feel like Markdown, so it **is** Markdown: a link whose target is the language.

```markdown
The door bears a warning: [Khazad ul barak](lang:dwarvish), "the mountain forbids".
```

- **Inline:** `[text](lang:<language>)`, where `<language>` is a language key (`elvish`, `deep-speech`, `thieves-cant`,
  and so on; the same keys chat uses, with the same aliases such as `dwarven`).
- **Block** (a whole inscription or verse): a fenced block whose info string is the language.

````markdown
```dwarvish
Khazad ul durin.
Barak thorin ang.
```
````

**Why this and not custom directives:** it needs no new parser, only a hook the renderers already have; and it
**degrades to plain readable text** everywhere else. In any other Markdown viewer, an export, or a search index, the
inline form is just a link with the words as its text, and the block form is a code block with the words inside. The
text is never altered, so search, summaries, memory and the AI that reads a tale back all see ordinary words. A model
writing a tale only has to remember one familiar shape, and a typo costs a missing font, not a broken page.

An unknown language key is left as plain text. `lang:common` is plain text.

## How it renders

Both clients' `MarkdownView` already turn links into inert text (a handout must never reach out). They gain two
small changes, shared from `ui-kit/`:

1. Let `lang:` links through react-markdown's URL filter (it drops unknown schemes by default).
2. Render a `lang:` link as `<span style={languageTextStyle(key, prefs)}>`, with the language's name as a tooltip, and
   a fenced block with a language info string as a block of the same, in place of a code block. Every other link stays
   inert text, as today, and ordinary code fences are unaffected.

It is the same `languageTextStyle` chat uses, so a language looks the same in a tale, a handout and a chat line.

## For the AI storyteller

One line is added to the storyteller prompt: _the foreign speech of a language may be written as
`[text](lang:<language>)`; use it sparingly, only when the notes or chat name the language_. The tale keeps its
creative licence ([bard creative licence](../RECORDING-AND-SUMMARIES.md)); the span adds no facts. Spoken audio does not
carry a language tag, so the storyteller only knows a language where a chat line (`/say-elvish`) or the DM's notes say so.

## What was in the first draft and is not here

Cut on purpose, because each is either already handled elsewhere or not needed to put the story first:

| Dropped from the draft                                          | Why                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Directives for speech, action, whisper, OOC, thought, narration | Chat carries these as data (`kind`, `lang`); in prose, narration is just paragraphs                 |
| Letter, journal, book, scroll, quest directives                 | Presentation templates. Add one when a real handout needs it                                        |
| Dice `[[1d20]]`                                                 | Dice are a project non-goal ([CLAUDE.md §13](../../../.claude/CLAUDE.md)); the game log is separate |
| Inline references (`@`, `$item:`, `$spell:`)                    | Need a data source that does not exist yet                                                          |
| Reserved directives (`map`, `combat`, `cinematic` …)            | VTT features, out of scope                                                                          |
| YAML frontmatter, "MUST" renderer compliance                    | Ceremony nothing needs                                                                              |
| Typography and polyglot tables                                  | Already in [ICONOLOGY.md](../ICONOLOGY.md); two copies is how drift starts                          |

**Polyglot** is unchanged and still future: it would be a server-side mask over the text a reader may not understand
(masking in the client would leak it), and the span format leaves room for it because the language is kept as data
next to the unaltered text.
