// The timeline of a session as the runner will play it: every line, scene, stinger and recording action with
// a time. A dry run walks it compressed; a live run walks it for real and compares its own timing with this.

import {
  GAP_SECONDS,
  WORDS_PER_MINUTE,
  type Event,
  type Loaded,
  type Report,
} from '../campaign-fixture.ts';

export interface PlanStep {
  /** Seconds from the start of the session. */
  atSec: number;
  durSec: number;
  kind: string;
  who?: string;
  text?: string;
  arg?: string;
  expect?: 'captured' | 'absent';
  line: number;
}

export interface SessionPlan {
  n: number;
  title: string;
  steps: PlanStep[];
  estimatedSec: number;
  counts: Record<string, number>;
}

/** Seconds each recording action takes in a live run (the cue, Egress starting, the last words arriving). */
const ACTION_SEC: Record<string, number> = {
  start: 8,
  stop: 3,
  pause: 1,
  resume: 1,
  scene: 1.5,
  stinger: 0.7,
  loot: 1,
  'late-join': 6,
  ack: 0,
  leave: 2,
  rejoin: 2,
};
const TYPED_SEC = 1.2;

export function stepDuration(e: Event): number {
  if (e.kind === 'directive') return ACTION_SEC[e.name] ?? 1;
  if (e.kind === 'type') return TYPED_SEC;
  const words = e.text.split(/\s+/).filter(Boolean).length;
  return (words / WORDS_PER_MINUTE) * 60 + GAP_SECONDS;
}

export function planSession(n: number, title: string, events: Event[]): SessionPlan {
  let at = 0;
  const counts: Record<string, number> = {};
  const steps: PlanStep[] = events.map((e) => {
    const durSec = stepDuration(e);
    const kind = e.kind === 'directive' ? e.name : e.kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
    const step: PlanStep =
      e.kind === 'directive'
        ? { atSec: at, durSec, kind, arg: e.arg, line: e.line }
        : { atSec: at, durSec, kind, who: e.who, text: e.text, expect: e.expect, line: e.line };
    at += durSec;
    return step;
  });
  return { n, title, steps, estimatedSec: at, counts };
}

export function planCampaign(l: Loaded, report: Report, sessions?: number[]): SessionPlan[] {
  return l.campaign.sessions
    .filter((s) => !sessions || sessions.includes(s.n))
    .map((s) => planSession(s.n, s.title, report.parsed.get(s.n)?.events ?? []));
}
