# Proposal: a campaign knowledge graph as the core memory (not yet decided)

**Status:** parked for detailed review (Andy, 2026-11-24) — see [ROADMAP.md, Future ideas](../../../ROADMAP.md#future-ideas).
Nothing here is built, scheduled, or agreed. This folder holds candidate architecture that needs a full
design conversation (`superpowers:brainstorming`) before any of it becomes a stage; a doc landing here is
not an approved design the way `docs/architecture/*.md` (outside `proposals/`) is.

**Source:** Andy supplied three draft specs for an external "RPG Campaign Intelligence Platform" concept
(V5 Technical Spec, V5.1 Implementation Spec, V5.2 Data Model & Decision Algorithms Spec). This document is
a synthesis of those three, reorganized and trimmed of repetition across the versions, kept here so the
source material survives past the chat upload that brought it in. Treat the original wording as the
author's, not vetted against this codebase.

## The core idea, in Andy's own framing

> Turns the AI pipeline on its head. AI is still critical, but the campaign memory graph becomes the core
> ... it changes how heavy the AI processing is and turns it into more of a skill/MCP store that simplifies
> the work of the AI to maintain story consistency across tens of sessions and hundreds of hours of content.

The pitch: instead of asking a model to re-read and re-condense a growing pile of notes every time it
writes something (what `ai/src/lib/summarise.ts`'s condense loop and the chunking plan
[2026-11-23](../../superpowers/plans/2026-11-23-chunking-long-sessions.md) do today), extract **events**
from each session once, resolve them into a **persistent, structured state** (entities, relationships,
story threads), and have every later AI call read a small, _already-resolved_ slice of that state instead
of the raw history. The source specs' own stated success test: "Session 200 costs roughly the same to
process as Session 20" — AI cost stays flat as the campaign grows, because the model is never asked to
re-derive what the graph already knows.

## How this compares to what's already built

This isn't a foreign idea dropped into empty ground — the app already has a much smaller ancestor of it:
**campaign memory** (`ai/src/lib/memory.ts`, Stage 12 F, decided with Andy 2026-11-20). Today, after each
session, one model call reads the session's notes plus the memory entries they mention and says what's new
or changed — named entries (`npc`/`creature`/`location`/`faction`/`quest`/`item`) with a one-line gist, an
alias list, and a `timesSeen` counter. It was deliberately kept small: "a CPU-only server only ever puts a
few hundred words of it in a prompt." The proposal below is a large superset of that same idea: typed
relationships with seven scored dimensions, promotion rules into "story threads," an event-sourced
PostgreSQL state machine with authority levels and conflict resolution, and a ranking/retrieval engine to
build a bounded "story package" for each AI call instead of a flat memory dump.

## Two tensions worth naming now, before any detailed design work

1. **Scale and complexity.** CLAUDE.md's own guiding principle: "Scope everything for homelab/personal
   project scale, not enterprise scale. Avoid unnecessary complexity, abstraction layers, or infrastructure
   that only pays for itself at a scale Andy isn't operating at." The source specs read like a designed
   multi-tenant SaaS product: entity resolution with fuzzy/semantic matching thresholds, a four-stage
   conflict-resolution workflow, five authority levels, a confidence-aggregation formula across six source
   types, campaign-health dashboards. A single self-hosted table's campaign (one DM, a handful of players,
   maybe one campaign at a time) may not need most of this machinery to get the "flat AI cost over time"
   benefit — worth asking, in the real design pass, how much of the _mechanism_ (an event-sourced graph) can
   be kept while trimming the _product surface_ (conflict queues, health metrics, multi-source weighting)
   down to what one table actually needs.
2. **A state machine, reintroduced.** CLAUDE.md §15 lists "no formal session state machine" as a deliberate
   simplification versus a prior design that "enforced `IDLE → ACTIVE → PAUSED → COOLDOWN → ENDED`, with
   every change touching four layers in order" — replaced by "a server-owned flag with a timestamp record."
   This proposal's story-thread lifecycle (`Seeded → Emerging → Active → Major → Dormant → Resolved →
Archived`, each transition with its own promotion rule) and its event-processing pipeline (`Validation →
Entity Resolution → Conflict Detection → Delta Generation → State Update → Audit Log`) is the same shape
   of thing the project already walked away from once, for a reason. That doesn't make it wrong here — a
   _narrative_ state machine is a different problem from a _session-lifecycle_ state machine — but it's the
   kind of decision that deserves to be made on purpose, not inherited from an external spec.

What's genuinely compelling and worth carrying into the real design conversation: the "events are truth,
relationships are memory, story threads are meaning, stories are presentation" framing is a clean
separation of concerns, and the retrieval-ranking idea (build a small, scored "story package" per AI call
instead of growing the prompt forever) is a real, scalable answer to the exact problem the chunking plan
just patched around rather than solved structurally.

---

## V5 — Architecture

### Design goals (as given)

- **Low administrative overhead:** no extra work for players; minimal for DMs. Campaign intelligence comes
  from audio transcripts, chat messages and campaign metadata, without added data entry.
- **Long-term scalability:** 200+ sessions, multiple years, thousands of events/relationships, without
  reprocessing historical transcripts.
- **Graph as memory, not a feature:** the campaign graph exists to reduce AI workload; it is not something
  players directly browse.
- **Integration optionality:** the platform works fully with no external integrations; integrations (D&D
  Beyond, Foundry, Roll20) enrich but are never required.

### Pipeline shape

```text
Audio / Chat / Metadata / D&D Beyond / Foundry / Roll20 / DM Notes
  → Normalized Events
  → State Resolver
  → Campaign Knowledge Graph
  → Context Builder
  → Story Outputs
```

### Proposed services

```yaml
services:
  postgres: # system of record — events, entities, relationships, state, story threads, outputs
  api: # auth, orchestration
  narrative-engine: # entity resolution, event classification, graph updates, state resolution,
    # conflict detection, relationship evolution, story-thread management, context packaging — no LLM calls here
  whisper-worker: # transcription
  ollama: # the only place models run
  web:
```

Suggested model roles (their choices, not vetted against this project's own model decisions):

| Role        | Model        |
| ----------- | ------------ |
| Scribe      | Qwen 4B      |
| Auditor     | Qwen 4B      |
| Storyteller | Ministral 8B |
| Chronicle   | Qwen 9B      |

### Event system

Every campaign change is an event:

```json
{
  "event_id": "uuid",
  "campaign_id": "uuid",
  "session_id": "uuid",
  "event_type": "Relationship",
  "timestamp": "ISO8601",
  "confidence": 0.92,
  "authority": 2,
  "sources": ["transcript"]
}
```

Categories: `Combat, Dialogue, Relationship, Discovery, Quest, Travel, Inventory, Faction, Political,
Economic, World, Character, StoryThread, Lore`.

### State domains

- **World state** — locations, factions, religions, nations, lore.
- **Campaign state** — quest status, ownership, reputation, alliances.
- **Character state** — goals, motivations, fears, beliefs, relationships. Deliberately _not_ VTT mechanics
  (HP, spell slots, attack bonuses) — this project's own non-goals already agree (CLAUDE.md §13: no VTT
  features).
- **Narrative state** — character arcs, mysteries, villains, romances, political plots.

### Authority model (highest wins)

```text
5 = DM Override
4 = Foundry / D&D Beyond
3 = Multi-source confirmation
2 = AI extraction
1 = AI inference
```

### Conflict resolution

```text
Conflict → Pending Review → DM Decision → State Update
```

Conflict types: ownership, quest state, character status, timeline, relationship.

### Evidence

Every stored value traces back to the events that produced it:

```json
{ "trust": 35, "evidence": ["evt_103", "evt_118", "evt_121"] }
```

### Context builder → story package

Goal: reduce token usage, avoid transcript reprocessing, build an optimized package per AI call —
`{ session, events, characters, relationships, story_threads, quests, locations, items, factions, stakes,
recent_changes }`.

### Storyteller contract

Allowed: dialogue, atmosphere, emotion, narrative flow. Prohibited: changing outcomes, relationships,
ownership, or world state — the model narrates what the graph already decided, it doesn't decide.

### Their stated success criteria

- Session 200 costs about the same to process as Session 20.
- Historical transcript reprocessing is rarely required.
- DMs spend less time maintaining notes; players get richer stories; continuity improves automatically.

---

## V5.1 — Implementation (schema, APIs, pipeline)

### PostgreSQL schema (as given — types/constraints not vetted)

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY, name TEXT NOT NULL, system TEXT DEFAULT 'D&D 5e', created_at TIMESTAMP NOT NULL
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY, campaign_id UUID REFERENCES campaigns(id), session_number INTEGER NOT NULL,
  title TEXT, session_date TIMESTAMP, processing_state TEXT, created_at TIMESTAMP
);

CREATE TABLE entities (
  id UUID PRIMARY KEY, campaign_id UUID REFERENCES campaigns(id), entity_type TEXT NOT NULL,
  name TEXT NOT NULL, status TEXT, importance INTEGER DEFAULT 0, metadata JSONB DEFAULT '{}',
  created_session INTEGER, updated_session INTEGER
);
CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_name ON entities(name);

CREATE TABLE relationships (
  id UUID PRIMARY KEY, source_entity UUID REFERENCES entities(id), target_entity UUID REFERENCES entities(id),
  relationship_type TEXT NOT NULL,
  trust INTEGER DEFAULT 0, respect INTEGER DEFAULT 0, loyalty INTEGER DEFAULT 0, fear INTEGER DEFAULT 0,
  suspicion INTEGER DEFAULT 0, debt INTEGER DEFAULT 0, affinity INTEGER DEFAULT 0,
  confidence NUMERIC(5,4), evidence JSONB DEFAULT '[]',
  created_session INTEGER, updated_session INTEGER
);

CREATE TABLE events (
  id UUID PRIMARY KEY, campaign_id UUID REFERENCES campaigns(id), session_id UUID REFERENCES sessions(id),
  event_type TEXT NOT NULL, authority_level INTEGER, confidence NUMERIC(5,4),
  payload JSONB NOT NULL, sources JSONB DEFAULT '[]', created_at TIMESTAMP NOT NULL
);

CREATE TABLE story_threads (
  id UUID PRIMARY KEY, campaign_id UUID REFERENCES campaigns(id), title TEXT, status TEXT,
  importance INTEGER, metadata JSONB DEFAULT '{}'
);

CREATE TABLE pending_reviews (
  id UUID PRIMARY KEY, campaign_id UUID, issue_type TEXT, severity TEXT, status TEXT,
  payload JSONB, created_at TIMESTAMP
);
```

### Event contract examples

```json
{ "event_type": "Combat", "participants": ["thorn", "blackwood"], "outcome": "Victory", "location": "Frostmere" }
{ "event_type": "Relationship", "source": "thorn", "target": "blackwood", "changes": { "trust": 15, "respect": 10 } }
{ "event_type": "Discovery", "entity": "sword_of_ilmar" }
{ "event_type": "StoryThread", "thread": "missing_brother", "importance_delta": 10 }
```

### State resolver pipeline

```text
Raw Event → Validation → Entity Resolution → Conflict Detection → Delta Generation → State Update → Audit Log
```

### Story thread promotion (as given — see V5.2 for the fuller version)

Create a thread automatically when importance > 75, it appears in 3+ sessions, and multiple players
reference it. Named examples from the spec: "Missing Brother," "Geoff the Grumpy Gnome," "Crimson Hand
Conspiracy."

### Integration provider contract

A generic feed shape (`{ provider, event_type, payload }`) with named adapters for D&D Beyond (membership,
identity, level, race, class), Foundry (combat, conditions, actors, journals, scenes) and Roll20 (handouts,
characters, combat, campaign metadata) — each one only ever _emits events_, never writes state directly
(matches this project's own principle that the server is the source of truth, CLAUDE.md §2.3).

### Auditor service

Validates: ownership conflicts, dead/alive conflicts, duplicate entities, quest-status conflicts,
relationship contradictions, timeline conflicts — routes anything it finds through the same
Conflict → Pending Review → DM Decision → State Update flow as V5.

### Narrative engine HTTP surface (as given)

```text
POST /api/events                    — ingest an event
POST /api/context/story             — build a story package
POST /api/conflicts/{id}/resolve    — resolve a pending conflict
GET  /api/relationships/{entityId}  — query a relationship
GET  /api/storythreads              — query story threads
```

### AI pipeline shape

```text
Whisper → Scribe (Qwen 4B) → Auditor (Qwen 4B) → Narrative Engine → Context Builder
  → Storyteller (Ministral 8B) → Chronicle (Qwen 9B)
```

Stated rule: **LLMs never maintain memory — all memory lives in PostgreSQL state.** This is the structural
answer to the chunking problem: a model is never handed the whole campaign, only a small resolved slice of
it.

---

## V5.2 — Data model and decision algorithms

This is the part that actually defines "how the Narrative Engine thinks" — the formulas behind importance,
relationship strength, promotion, confidence, and retrieval ranking.

### Core principle (their words)

```text
Events are truth. Relationships are memory. Story Threads are meaning. Stories are presentation.
```

### Entity importance scale

```text
0-20 Minor · 21-40 Supporting · 41-60 Significant · 61-80 Major · 81-100 Critical
```

### Relationship dimensions and scoring

| Attribute | Range        |
| --------- | ------------ |
| Trust     | −100 to +100 |
| Respect   | −100 to +100 |
| Fear      | 0 to 100     |
| Suspicion | 0 to 100     |
| Loyalty   | −100 to +100 |
| Debt      | 0 to 100     |
| Affinity  | −100 to +100 |

```text
strength = (|trust| + |respect| + fear + suspicion + |loyalty| + debt + |affinity|) / 7

importance = strength + session_frequency_bonus + story_thread_bonus + recency_bonus
  where, suggested:
    mentioned this session    +10
    mentioned 3 sessions      +20
    mentioned 10 sessions     +40
    story thread connection   +25
    current quest connection  +20

update: new_value = max(-100, min(100, current + delta))

importance promotion by reference count:
  5 references  → importance +10
  10 references → importance +25
  20 references → story-thread candidate
```

### Story thread lifecycle and promotion rules

States: `Seeded → Emerging → Active → Major → Dormant → Resolved → Archived`.

```text
Seeded → Emerging:  referenced twice AND appears across 2 sessions
Emerging → Active:  importance > 50 OR DM manual promotion
Active → Major:     importance > 80 AND 4+ session references
```

### The "Geoff Rule" (narrative importance from player attention, not DM or AI fiat)

```text
importance = (reference_count * 2) + relationship_weight + story_thread_weight + entity_mentions + dm_modifier
  (capped 0-100)
```

Promotion criteria for a named NPC: mentioned across 3 sessions, OR referenced by 3 players, OR a
relationship score above 60. Their own framing: "Players decide what matters. Not the DM. Not the AI." — a
genuinely nice design idea, separate from whether the surrounding machinery is proportionate here.

### Entity resolution

```text
order: Exact Match → Alias Match → Fuzzy Match → Semantic Match → Manual Review
thresholds: 100% exact · 95% alias · 90% fuzzy · <90% → review
```

```json
{ "canonical": "thorn_ironshield", "aliases": ["Thorn", "The Dwarf", "Ironshield"] }
```

### Event confidence

| Source            | Weight |
| ----------------- | ------ |
| DM override       | 1.00   |
| Foundry           | 0.95   |
| D&D Beyond        | 0.95   |
| Multiple sources  | 0.90   |
| Transcript + chat | 0.85   |
| Transcript only   | 0.80   |
| AI inference      | 0.50   |

`final_confidence = weighted_average(all_sources)`.

### Conflict severity and resolution

```text
severity: Low · Moderate · High · Critical
automatic resolution allowed for: low severity, or a strictly higher-authority source
manual resolution required for: ownership conflicts, resurrections, quest contradictions,
  major relationship contradictions — DM always wins
```

### Context builder ranking (the part that actually bounds AI cost)

```text
score = importance + recency + relationship_strength + story_thread_weight + current_session_relevance

priority order:
  1. current session events        5. referenced NPCs
  2. active story threads          6. referenced locations
  3. strong relationships          7. relevant lore
  4. active quests
```

Story package for the storyteller: `{ session, events, key_relationships, active_threads, quests,
important_entities, stakes, recent_changes }`. Target: under 10% of total campaign knowledge per call;
never send the full campaign history.

### Campaign health metrics (their suggestion)

Active threads, dormant threads, major NPCs, relationship-network size, quest-completion rate,
conflict-queue size — DM-facing insight without manual admin work.

### Their stated success criteria

- Session processing stays roughly constant as the campaign grows.
- Story quality improves as state grows, not degrades.
- Relationship continuity survives hundreds of sessions.
- Narrative relevance emerges from the data, not manual curation.
- Players feel remembered; DMs take fewer notes.

---

## What a real design pass still needs to answer

Not an exhaustive list — just what jumped out on a first read, for whoever picks this up next
(`superpowers:brainstorming` first, per this project's own working style):

- How much of this maps onto what already exists (`ai/src/lib/memory.ts`'s entries, `ai/src/lib/notes.ts`'s
  structured notes, the existing `campaign` / `recording` schema in `backend/`) versus what would be a
  genuinely new subsystem (`narrative-engine` as its own service is a new Non-Goal-adjacent decision —
  CLAUDE.md §13 already says no Rust backend services, but says nothing about a second TypeScript/Node
  service; worth asking whether this needs to be its own service at all, or a module inside the existing
  `backend`/`ai` packages).
- Whether the full authority/confidence/conflict-resolution machinery pays for itself at one table's scale,
  or whether a trimmed version (fewer authority levels, no multi-source weighting, DM-only conflict
  resolution with no queue) gets the same "flat AI cost over time" benefit for much less code.
- Whether "story threads" as a formal lifecycle duplicates or should replace the existing **markers**
  concept (CLAUDE.md §10: "DM-placed timestamps on the timeline... still to be confirmed during the records
  design").
- What this does to the consent/privacy rules already decided (CLAUDE.md §8.4: whispers and private-channel
  content must never be recorded, transcribed, or summarised into a shared artifact) — an event-sourced
  graph that resolves "relationships" and "secrets" needs the same hard boundary applied to graph writes,
  not just to summary text.
- Migration story: how an existing campaign's notes/memory (already-processed sessions under the current
  pipeline) would backfill into this model, if at all — the specs' own G2 goal explicitly says historical
  transcripts should rarely need reprocessing, which argues for a one-time backfill at most, not routine
  reprocessing.

## Hints noticed while fixing the pipeline's reliability (0.6.5, 2026-11-26)

Not design work — just what fell out of chasing why a CPU-only job burned hours then failed
anyway ([2026-11-26-ai-pipeline-reliability-design.md](../../superpowers/specs/2026-11-26-ai-pipeline-reliability-design.md)),
worth having in front of whoever does the real design pass:

- `ai/src/lib/notes.ts`'s `NOTE_SECTIONS` (events, decisions, combat, npcs, locations, loot, quests, secrets,
  moments, quotes) is already a small, fixed schema of fact categories — a reasonable seed for the graph's
  entity/fact types, answering the first open question above in part: this much of "what already exists"
  maps onto the graph fairly directly.
- `ai/src/lib/memory.ts` (`buildMemoryPrompt`/`applyMemoryUpdate`/`relevantMemory`) already extracts durable
  facts from a session's notes and carries them forward as a flat list, re-surfaced by relevance next time.
  That's graph-lite: the Campaign Graph is naturally this mechanism's evolution (a connected structure
  instead of a flat list), not a system built alongside it.
- The 0.6.5 fix halves the default note-taking chunk size (12k → 6k characters) for reliability reasons
  unrelated to this proposal. A side effect: chunks are now smaller, more addressable units of "what
  happened in this slice." If the graph ends up extracting structured facts chunk-by-chunk rather than from
  a whole session's notes, this is a head start, not just a reliability measure.
- The 0.6.5 fix's one real trade-off — asking the scribe to prioritise consequential events over exhaustive
  completeness, specifically to keep a chunk's generation time bounded on CPU — is exactly the kind of cost
  this proposal is meant to make unnecessary: cheap, schema'd fact extraction doesn't need to narrate
  everything to be thorough about facts. Once the graph exists, that prompt change may be safe to relax or
  drop; it's a stop-gap, not a direction this project is otherwise committed to.
- Also worth checking once the graph's call shape is being designed: 0.6.5 made "the model aborted on this
  content" (a repeat-limit abort) a distinct, loggable signal for the first time, separate from the server
  being unreachable. Whether short, constrained, schema'd extraction calls turn out more resistant to that
  failure mode than today's open-ended narrative ones is a real, checkable question once there's data.
