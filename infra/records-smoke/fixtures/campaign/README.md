# Demo campaign: Lanterns of Saltmarrow

The reusable test campaign behind the long-session test ([QUALITY-VALIDATION.md](../../../../docs/architecture/QUALITY-VALIDATION.md), Stage 13). Three connected sessions of about 25 minutes each (about 80 minutes in all), written to be **replayed through the whole system any number of times**: on the dev PC, on the VM, after any change to the records pipeline, and before any release that touches it.

**What it is for.** Three things at once:

1. **Hearing.** An invented world full of names Whisper has never seen (Quillfeather, Brinewhistle, Saltmarrow, sahuagin), so the glossary's two jobs (a prompt for Whisper, corrections after it) can be measured with the glossary on and off.
2. **Weaving.** Voice, typed chat (every kind), soundboard scenes and stingers, loot drops, a pause, a late joiner and a dropped connection arrive together, as at a real table, and have to come out as one record.
3. **Remembering.** The same people, places and objects come back across sessions: a throwaway ferrywoman paid in pickled onions in session 1 who saves the day in session 3; a debt made in session 2 and collected in session 3; two different Tobiases. Campaign memory and the storyteller are scored on whether they make those links.

**The rules and the setting.** D&D 5th edition, using only the System Reference Document 5.1 (classes, subclasses, spells, monsters and items that are in the SRD). The setting, names, plot and characters are original: nothing comes from a published adventure or a published world. Attribution is below.

## What is in this folder

| File                        | What                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `campaign.json`             | The cast, accounts and voices; the glossary (53 terms, with the aliases Whisper is likely to produce); the canaries; the session list              |
| `session-1.txt`, `-2`, `-3` | The scripts, in the line format below                                                                                                              |
| `gm-notes.md`               | The Game Master's private notes, uploaded to the campaign's GM Notes. Holds the **GM canaries** (words that are never said at the table)           |
| `facts.json`                | 54 facts, 18 a session, that a good set of notes must keep, each with a pattern for the output and a `source` proving it is in the script          |
| `callbacks.json`            | 12 links between sessions, each with what campaign memory should hold after which session, and what the later tale or brief should connect back to |

## The cast

| Who                          | Plays                                                                 | Voice (piper)                        |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| **Rowan**                    | The Game Master                                                       | `en_GB-alan-medium`                  |
| **Priya**                    | Kestrel Vanterpool, half-elf rogue (Thief), level 3                   | `en_US-amy-medium`                   |
| **Marcus**                   | Ghorrim Duskhammer, hill dwarf cleric (Life), level 3                 | `en_US-ryan-medium`                  |
| **Elise**                    | Aelwen Thistledown, high elf wizard (Evocation), level 3              | `en_GB-southern_english_female-low`  |
| **Tomasz**                   | Fennimore "Fen" Quickwhistle, lightfoot halfling bard (Lore), level 3 | `en_GB-northern_english_male-medium` |
| **The developer** (player 5) | Varek, half-orc barbarian (Berserker), level 3                        | none: **silent**                     |

Player 5 is the developer's own client, joined to the demo campaign as a real player. They never speak or type; they listen and monitor. The scripts only **mention** Varek (the Game Master asks him for a watch, he swings an axe), so a connected but silent microphone is part of every run: it checks that a quiet track does not make Whisper invent words, and that a person with no lines is not lost from the roster. The four voice players are headless clients that publish a text-to-speech track.

## The line format

One line per utterance or event. Blank lines and lines starting with `#` are ignored.

```text
Rowan: Welcome back. You are standing at the door.          spoken, in the speaker's own microphone track
Priya (typed): /do I check the door for traps               typed in chat, exactly as a person would type it
Marcus (over): No wait, I wanted to say something.          spoken starting before the previous line ends (an interruption)
[start]  [stop]                                             the Game Master starts and stops the recording
[pause]  [resume]                                           pause and resume; everything between is NOT recorded
[scene: Harbour]                                            the Game Master starts a soundboard scene (a name from the shipped catalogue)
[stinger: Combat > Critical hit]                            the Game Master fires a button (Board > Button, from the shipped catalogue)
[loot: Potion of healing x2 | party]                        a loot drop to the party stash, or to one player by name
[late-join: Marcus]  [ack: Marcus]                          a player joins after the recording started; they are not recorded until they acknowledge the cue
[leave: Elise]  [rejoin: Elise]                             a dropped connection and the reconnect
```

**Which lines must reach the records** is worked out from the format, not written by hand: everything is captured except lines between `[pause]` and `[resume]`, a late joiner's speech before their `[ack]`, and typed `/ooc`, `/late`, `/cant`, `/work`, `/brb`, `/afk`, `/back` and the whispers `/dm`, `/tell`, `/w`. Typed `/say`, `/do` and plain in-character text are captured.

## What a run exercises

| Thing                | Where                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Soundboard scenes    | Harbour, Tavern, Storm, Dungeon halls, Forest night, Campfire, Cave, Rainfall, Market: 16 in all, each starting a chapter |
| Stingers (light use) | Thunder, Water drip, Critical hit, Magic missile, Draw blade, Iron gate, Ship's bell, Fireball and others: 20 in all      |
| Loot                 | Potions, a whistle, gold, a coat badge, a potion of water breathing                                                       |
| Chat                 | In-character typed lines, `/ooc`, `/dm`, `/tell` (the last three are canaries)                                            |
| Consent and churn    | A late joiner (session 1), two pauses (2 and 3), a dropped connection and rejoin (session 2)                              |
| Long monologues      | Several 100 to 200 word descriptions by the Game Master, for Whisper's long-clip handling                                 |
| Rules talk           | Initiative, grapples, sneak attack, saving throws, spell slots and an elf's immunity: the language of a real table        |

## Canaries

A **canary** is a word that appears nowhere else, placed in a line that must never reach a shared artifact. If it shows up in a transcript, note, brief, memory entry, tale, search result or export, something leaked.

- **Table canaries** (`campaign.json`): `quince` (a late joiner before the cue), `cantaloupe`, `artichoke` (`/ooc`), `tangerine`, `turnip` (`/dm`), `walnut` (`/tell`), `gingham`, `rhubarb` (said while paused).
- **GM canaries** (`gm-notes.md` only): `moonlily` and `gallowglass`. Never said at the table, so they must not reach any tale except the Tipsy Minstrel's, which may slip what the Game Master wrote.

## Using it

```bash
node infra/records-smoke/campaign-fixture.ts check     # validate everything; exit 1 on a problem
node infra/records-smoke/campaign-fixture.ts stats     # minutes, words, lines, scenes, glossary use
node --test infra/records-smoke/campaign-fixture.test.ts
```

`check` is cheap and has no services: run it after any edit. It fails if a speaker is not on the cast, a scene or stinger is not in the shipped soundboard catalogue, a canary is on a recorded line or in the wrong session, a fact or callback is not really in the script it names, or a glossary term is unused. It **warns** about glossary terms used only once (a weak test of that term).

The runner that plays the sessions into a real server, and the monitor that records CPU, memory, disk, network, latency and errors while it does, are the next part of Stage 13 ([QUALITY-VALIDATION.md](../../../../docs/architecture/QUALITY-VALIDATION.md#the-monitor)).

## Editing it

- **Run `check` after every edit.** The validator exists because the first draft of these scripts had a canary hidden inside a simile ("a face like a walnut").
- **Keep every canary unique.** A new one must appear only on lines that are never recorded.
- **The aliases in the glossary are guesses** at what Whisper will write. After a run, the report lists the forms it actually produced; add the real ones.
- **Stay inside the SRD.** Use only classes, spells, monsters and items that are in the SRD 5.1, and keep the setting original.
- **Do not name a real person, brand or published setting** in a script or note.
- To add a session, add `session-4.txt` and its entry in `campaign.json`, 18 or so facts under `"4"` in `facts.json`, and the callbacks it pays off.

## Attribution

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at <https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License (<https://creativecommons.org/licenses/by/4.0/legalcode>). The scripts use its rules vocabulary (spells, monsters, classes, conditions and items) and nothing else from it. See [docs/LEGAL-SRD.md](../../../../docs/LEGAL-SRD.md). Nothing here is endorsed by or affiliated with Wizards of the Coast.
