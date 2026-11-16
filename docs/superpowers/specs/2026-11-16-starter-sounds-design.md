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

## Built (2026-11-16)

- Scenes deck: icon buttons, find / show / hide / new-scene popup; hold a stinger to loop it until released.
- The shared catalogue: `ownerId` null rows (migration 0035), seeded at start-up from `backend/assets/sounds`
  by `lib/soundboard/catalogue.ts` (idempotent, prunes what the pack drops, never touches a DM's own library),
  usable by every DM, read-only in the app, downloadable by any campaign member.
- `scripts/sound-pack/build.py` builds the pack from `picks.json`: it refuses a page that does not list CC0,
  normalises loudness, crossfades beds into seamless loops and writes `SOURCES.md`.
- A first pack of 14 clips (about 7 MB): ambience beds and music loops from OpenGameArt.

## Not built yet

- **Sound effects.** OpenGameArt is mostly music: it has no good CC0 doors, coins, blades, footsteps, spells or
  creatures, and no crowd, ocean, campfire, swamp or night beds. Freesound (CC0 filter, API key) and the Kenney
  packs (downloads are browser-only) are the sources; either needs Andy (a free Freesound API key kept in a file,
  or the Kenney zips downloaded by hand).
- **Listening test, 2026-11-16 (Andy).** Dropped: `rain-heavy` and `street-calm` (music, not background sound),
  `rain-thunder` (just heavy rain, no thunder), `forest-day` (wind chimes, not leaves and birdsong) and all four stings
  (video-game "Sonic" stingers; the target is gritty RPG / dungeon). Kept: tavern, market, battle, cave, dungeon, mountain.
- **Lesson:** an OpenGameArt title or description does not tell you what a clip sounds like, and most of its audio
  is music. Choose ambience by Freesound tags, duration and preview, then have Andy listen before it ships.

## Left to the builder

Which exact CC0 clips to use (Andy listens and swaps), loudness normalisation (target a common LUFS so scenes
do not jump), loop points, and file size budget (aim for the pack under about 60 MB).
