# Table Features (Stage 6)

Server first, then UI (decided by Andy, 2026-11-07). This document records what each table feature
does, the rules that matter for privacy, and what is deliberately not built yet. Decisions marked
**decided** came from Andy; the rest are defaults taken so work could continue, easy to change.

| Feature                                                                                      | State        |
| -------------------------------------------------------------------------------------------- | ------------ |
| Chat and whispers                                                                            | built, below |
| Handouts, maps, images, text snippets                                                        | planned      |
| Loot drops with pickers                                                                      | planned      |
| DM soundboard (a mini [thaumaturgy.app](https://thaumaturgy.app/) with the DM's own library) | planned      |
| Party split                                                                                  | planned      |
| Session schedule, RSVP, stored notifications                                                 | planned      |

## Chat and whispers (built)

- **Table chat** goes over the WebSocket (`chat.message`), is stored in Postgres (`chat_messages`), and
  rides the shared replay stream as before. Every line carries a stable `id`, so a client that sees
  the same line from a replay and from history keeps one copy.
- **Whispers** (**decided**): DM↔player and player↔player, **private to the two**. The DM cannot read a
  player-to-player whisper. A whisper is `chat.message` with `to: <userId>`.
  - It is delivered as `chat.whisper` to the sender's and recipient's own sockets only (every device of
    the two people), never broadcast.
  - It is **not in the shared replay stream** — that stream is replayed to every resuming client, so a
    whisper in it would leak. Instead, each viewer gets their own recent whispers (`recentWhispers`) in
    a snapshot, or a `chat.whispers` frame alongside a replay. Clients merge by `id`.
  - Whispering yourself, a non-member or an unknown id gets the same `invalid_recipient` answer, so
    it cannot be used to probe who is in a campaign.
  - Whisper **voice** (private audio) is not built; when it is, its audio must be excluded from
    recording at the routing layer (RECORDING-AND-SUMMARIES.md).
- **History** (`GET /api/campaigns/:id/chat?before=&limit=`) returns the newest page the viewer may
  see. The visibility rule is in the store query (`listChat(campaign, viewer)`), not in callers.
- **Bounded retention:** the newest 5 000 lines per campaign are kept (whispers included); older ones
  are pruned every 50 writes. One constant (`CHAT_RETENTION_MESSAGES`); not yet an operator setting.

## Handouts, maps, images and text snippets (built)

- **What:** a DM prepares handouts as **drafts** (DM-only) and **shows** them to everyone or to chosen
  players; **hide** takes one back to a draft; the DM can delete. A text snippet is a handout with a
  body (≤ 20 000 characters) and needs no file storage.
- **Files** (**decided:** a server volume, metadata in Postgres): `MEDIA_DIR` holds the bytes under the
  file's id; `media_files` and `handouts` (migration 0007) hold everything that decides access.
  - Type is decided from the **bytes**, never the filename or `Content-Type`. Accepted: PNG, JPEG, GIF,
    WebP, PDF. HTML, SVG, scripts and executables are rejected (415), so an upload can never become
    something a browser would run. A PDF sent as an image (or the reverse) is rejected.
  - Limits: 10 MB per file; 1 GB per campaign (413 beyond).
  - Downloads are served only to people allowed to see that handout, with `X-Content-Type-Options:
nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.
  - The disk store validates ids, so a name can never escape the media directory.
- **Visibility** is applied in the store (SQL for Postgres), not by callers: the DM sees everything;
  others see handouts shown to everyone or to them. A handout you cannot see is `404`, exactly as if it
  did not exist; one reached through another campaign's URL is also `404`.
- **Live:** `handout.shown` goes to exactly the people who may now see it (plus the DM's sockets);
  `handout.removed` goes to everyone when one is hidden or deleted. A reconnecting client re-reads
  `GET /api/campaigns/:id/handouts`.
- **Not built:** sweeping media files when a whole campaign is deleted; thumbnails; image dimension limits.
