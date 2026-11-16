# Starter sounds and a quicker scenes deck — design

**Decided 2026-11-16 with Andy.** The soundboard is a key DM tool, but DMs will not use it if they spend a session
getting it set up. So a new DM should open the deck and already have ambience and stingers.

## Decisions

| Decision                                                                                                                                                 | Why                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The starter sounds are a **curated CC0 pack committed to the repo** (small OGG files), with a manifest naming each file's source URL, author and licence | Self-host first: a blank server works offline with no account anywhere. CC0 means no attribution or redistribution trouble. The manifest keeps the licence trail auditable. |
| It is a **shared server-wide catalogue**, not a copy in every DM's library                                                                               | No setup per DM, no duplicated clips, and a server update can add sounds. Each DM shows or hides scenes and stingers for themselves.                                        |
| Show/hide is **per campaign, on the DM's machine**, the same as stinger favourites                                                                       | Existing convention (`usePins`); a convenience, not shared state.                                                                                                           |
| Scenes on the deck are **icon buttons, name on hover**, like stingers                                                                                    | Andy's request; icons come from the scene's name (`sceneIcons.ts`).                                                                                                         |
| The deck's **plus** opens a popup to find, show or hide, start or create a scene                                                                         | One step to add; a scene you create is shown immediately.                                                                                                                   |

## Scene list to cover

Rainfall, storm, forest, tavern, city / town, market, battle / fight, cave, dungeon, mountain; then sea, camp fire,
swamp, night, castle, temple. Each is a loop (a bed) plus, where it helps, random layers (drips, birds, distant bells).
Stingers: door, coins, bell, blade, magic, footsteps, creature, impact, and a few short musical stings.

## Built

- Scenes deck: icon buttons, find / show / hide / new-scene popup (2026-11-16).

## Not built yet

- The shared catalogue: sounds, boards and scenes are owner-only today (`owner_id` references a user; ten checks in
  `soundLibraryService.ts` and `runtime.ts`). It needs system-owned rows (nullable owner), read access for every DM,
  and clip download authorisation for system clips.
- The audio pack itself, and `docs/guides/SOUND-PACK.md` listing every file with its licence.

## Left to the builder

Which exact CC0 clips to use (Andy listens and swaps), loudness normalisation (target a common LUFS so scenes
do not jump), loop points, and file size budget (aim for the pack under about 60 MB).
