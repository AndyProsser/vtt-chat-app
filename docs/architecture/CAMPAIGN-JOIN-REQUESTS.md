# Asking to join a campaign

Decided with Andy 2026-11-12. **Status: designed, not built.** Items marked _(my call)_ are my choices where the
decisions left a gap; correct them first.

## What was decided

- A signed-in person **with no campaign** is shown a **list of active campaigns** and can **request to join** one.
- **People who already have a campaign can ask to join others too**, the same way.
- The **DM approves or declines**, not the operator.
- A DM can switch **Allow join** off in the campaign's settings, and the campaign then stops appearing in the list
  and stops taking requests.

Invites (link, code, QR) stay exactly as they are: this is a second way in, for people who were not sent an invite.

## Why this needs care: campaigns are private

[CLAUDE.md §1](../../.claude/CLAUDE.md) says campaigns are private, and until now a campaign's name was visible only
to members and people holding an invite. A directory shows names to every signed-in account. That is a deliberate
trade, and these rules keep it small:

- **What the list shows** _(my call)_: the campaign name, the DM's display name, and how many players it has. Never member
  names, characters, messages, schedule, or anything inside the campaign.
- **Only signed-in accounts** see it, never the public pages.
- **Allow join is the DM's switch**, and the campaign is invisible and unrequestable while it is off.
- **An instance master switch** _(my call)_: an operator setting `campaign-directory on|off` (default **on**) lets a
  private instance hide all listings regardless of the DMs. With it off, only invites work, exactly as today.
- **Default for a new campaign: Allow join ON** _(my call)_. Otherwise the first account's starter campaign would be
  invisible to everyone who signs up after it, and the "no campaign" screen would always be empty on a fresh instance.
  A DM who wants a closed table turns it off in one switch.

## The flow

```mermaid
sequenceDiagram
  participant P as Player (no campaign, or another campaign's member)
  participant S as Server
  participant D as The campaign's DM
  P->>S: GET /api/campaigns/open (signed in)
  S-->>P: campaigns with Allow join on: name, DM name, player count
  P->>S: POST /api/campaigns/:id/join-requests {message?}
  S-->>P: 202 (same answer however it goes)
  S-->>D: notification + pending request in the Campaign tab
  D->>S: approve or decline
  S-->>P: notification: you are in / not this time
  Note over S: approve adds the player membership; decline records it
```

## Rules

- **One open request** per person per campaign. A duplicate returns the same neutral answer (no state leak). A person
  already in the campaign cannot request it. A declined request can be repeated **after 7 days** _(my call)_, so a "no"
  is not nagged.
- **An optional message** to the DM, up to 280 characters, control and bidirectional characters stripped.
- **Limits** _(my call)_: at most 5 open requests per person at a time, and a per-address rate limit like sign-up
  requests. This keeps the list from being used to spam DMs.
- **Who decides:** the campaign's DM (the current DM; a DM swap moves the pending requests to the new DM with the
  role). An Admin who is not the DM does **not** approve; they have the DM's tools only if they are the DM.
- **Consent:** joining a campaign means being recorded when the DM records. The recording notice is already accepted
  at the account level, so approval needs nothing extra; the new member sees the notice's version as always.
- **Leaving and allow-off:** turning Allow join off does not remove pending requests silently. They stay visible to the
  DM, marked "closed", and cannot be approved until Allow join is on again _(my call)_.

## Where it appears

| Where                         | What                                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop app, no campaign      | The "not in a campaign yet" screen becomes the list, with a Request button and the optional message                                      |
| Web app (`/app`), no campaign | The same list in the campaign picker screen                                                                                              |
| Both, with a campaign         | Campaign settings (desktop Campaign tab; web Menu) → "Find another table", and the DM's **Allow join** switch                            |
| DM                            | A pending-requests list in the Campaign tab (desktop) and a badge on the avatar of the cog or the Menu; approve/decline with the message |
| Requester                     | A notification when decided ("You're in {campaign}" or "Not this time"), and the request shown as pending in the list in the meantime    |

## Wire and storage

- New table `join_requests` (id, campaign_id, user_id, message, status `pending|approved|declined|withdrawn`, created_at,
  decided_at, decided_by). Per-campaign `allow_join` flag on campaigns (default true) and an instance setting
  `campaign-directory`.
- REST: `GET /api/campaigns/open`, `POST /api/campaigns/:id/join-requests`, `DELETE` to withdraw,
  `GET /api/campaigns/:id/join-requests` (DM only), `POST …/:requestId/decision {approve}` (DM only), and the
  `allow_join` field on the existing campaign settings update. Every route has an access test like the other campaign routes.
- Real-time: a `join.request` event to the DM's sockets and a notification record for the requester (the existing
  notifications table and channel).
- Additive endpoints and fields. The 0.4 line is unreleased, so no protocol bump _(my call)_.

## Build order (when approved)

1. Backend: migration, store (both implementations), service rules, routes, notifications, tests including the
   access matrix and the DM-swap handover.
2. Web app: the list and request screen; the DM's pending list and Allow-join switch; notifications.
3. Desktop app: the same.
4. Docs: OPERATOR-GUIDE (the master switch), USER-GUIDE, SYNC-PROTOCOL, TABLE-FEATURES.
