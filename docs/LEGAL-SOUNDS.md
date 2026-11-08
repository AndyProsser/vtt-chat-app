# Sound effects: sources and licences

The soundboard library belongs to each DM and is theirs to fill. For a quick start, `npm run sounds:import`
(`scripts/sounds/import.ts`) loads sound packs into a DM's library: from any folder of audio you have the
right to use (`--from <folder>`), or `--kenney` for the packs below.

## Bundled starter source (not committed — fetched on request)

| Pack                                                     | Author                | Licence                                          |
| -------------------------------------------------------- | --------------------- | ------------------------------------------------ |
| RPG Audio (doors, books, cloth, metal, footsteps…)       | Kenney (kenney.nl)    | CC0 1.0 — no attribution required (credit welcome) |
| Impact Sounds (wood, metal, glass, stone, plates, soft)  | Kenney (kenney.nl)    | CC0 1.0 — no attribution required (credit welcome) |

`--kenney` downloads CC0 repackagings of these packs from GitHub
(`Boyquotes/kenney-rpg-audio-for-godot`, `Boyquotes/kenney-impact-sounds-for-godot`, both CC0-1.0);
kenney.nl itself blocks scripted downloads, and we do not work around that. The audio is **not** stored in
this repository: it goes into the operator's own media storage.

## Other CC0 sources worth knowing

- **Thaumaturgy** lists the CC0 recordings behind its library (Freesound IDs and recordists) at
  <https://thaumaturgy.app/docs/sounds>. Its own terms forbid extracting audio from the app, so use the
  original Freesound sources instead (a free Freesound account/API token is needed to download them), and
  check each sound's licence on Freesound before using it.
- **Kenney** has more CC0 packs (UI, digital, sci-fi) at <https://kenney.nl/assets>.

Anything you load is your responsibility to have the right to use; CC0 means no attribution is needed.

## Not part of recordings

Sound effects are sent to the table on a separate `soundboard` track that the backend never records; a
recording's timeline only notes *which* effect or scene was played and when (metadata), not its audio.
