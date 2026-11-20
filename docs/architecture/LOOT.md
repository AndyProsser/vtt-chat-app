# Loot: the party inventory, the SRD catalog and random treasure

The party inventory is a **shared pool** (see [TABLE-FEATURES.md](TABLE-FEATURES.md)): the DM drops
things, players grab them, and each grab records who took it and whether it was for themselves or the
party. This note covers where items come from; who sees and moves what (the filters, the party stash, Give)
is in [TABLE-FEATURES.md](TABLE-FEATURES.md#who-sees-what-and-the-filters-decided-and-built-2026-11-17).

```mermaid
flowchart LR
  SRD[SRD 5.1 items<br/>shared/src/srd] -->|search| Bench
  Roll[Random roll by CR<br/>backend loot/generator] --> Bench
  Custom[Custom item] --> Bench
  Bench[DM's loot bench<br/>preview: re-roll, remove, add] -->|Drop all: loot/batch| Pool[Party inventory]
  Pool -->|loot.dropped / loot.claimed| Table[Chat cards, icons, glow]
```

## Re-drop and "added to my sheet" (protocol 4, built 2026-11-19)

- **Re-drop** (`POST /loot/:id/redrop`, DM only, only while nobody holds the item): the item's drop time becomes now, which is where both apps draw its chat card, so the card moves; `loot.redropped` tells live clients to drop the old card and show the new one. It does not go to the recording timeline, because nothing happened to the item.
- **Confirmed flag** (`POST /loot/:id/confirm {confirmed}`, players only): one flag on an item a player holds or on the party stash (any player may tick it), and one per share inside a split. Every move (take, store, return, give, split, re-drop) resets it in the same SQL `UPDATE` that moves the item. The DM never gets the flags, and a player only sees their own share's. `loot.confirmed` is sent only to the people who may see the flag (the player, or every player for the stash). The count on the icon is worked out in the app from the list (`needsConfirming` in `shared/`).
- **Notice:** when the DM gives an item (`assign`, or a drop with a recipient) the server stores a `loot_given` notification for that player. Takes, stores and splits by a player make no notice: the count rising is the only sign.

## Items

Every item has an **item type** (weapon, armor, potion, ring, wondrous item, gem, coin…) that picks its
icon, and magic items have an **SRD rarity** — _common, uncommon, rare, very rare, legendary, artifact_ —
that sets the strength of a soft glow in the rarity's colour (stronger for rarer items; mundane items do
not glow). Custom items may be given any type and rarity.

- **SRD catalog:** 240 magic items and ~210 mundane items, searchable by name, type and rarity
  (`POST /api/campaigns/:id/loot/catalog`; a POST only because the tray app's relay refuses query strings).
- **Custom items:** any name, type, rarity, quantity; coin piles are a kind of their own.
- **Batch drop:** `POST …/loot/batch` validates every entry first, so a bad one drops nothing.

## Random treasure — our own generator, not the DMG's

The SRD has **no treasure tables** (they are DMG-only and not open content), so
`backend/src/lib/loot/generator.ts` is original: four challenge-rating bands (0–4, 5–10, 11–16, 17+),
**individual** treasure (coin only) and **hoards** (coin, gems, art objects and magic items), with our
own dice and weights; magic items are drawn from the SRD list by rarity, which rises with the band, and
an artifact never rolls. The numbers are a rough guide and meant to be edited; unit tests pin the shape
(rarity ceilings per band, value growing with CR, determinism for a given dice stream).

The DM sees the result as a **preview** (nothing is stored): re-roll the lot, re-roll one entry (a
different item of the same rarity, a gem or art object of the same value, the same coin again), remove
entries, add SRD or custom ones, then **Drop all**.

## Attribution

See [../LEGAL-SRD.md](../LEGAL-SRD.md).
