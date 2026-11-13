import { describe, expect, it } from 'vitest';

import {
  canCancel,
  durationChoices,
  durationLabel,
  nextSessionTitle,
  sameDraft,
  sessionPatch,
  validateSession,
  type SessionDraft,
} from './sessionForm.js';
import { toLocalInput } from './datetime.js';

const NOW = new Date(2027, 5, 1, 12, 0).getTime();
const draft = (over: Partial<SessionDraft> = {}): SessionDraft => ({
  title: 'Session 4',
  start: toLocalInput(NOW + 86_400_000),
  duration: 180,
  notes: '',
  ...over,
});

describe('validateSession', () => {
  it('accepts a good draft and trims the title', () => {
    const r = validateSession(draft({ title: '  Session 4  ', notes: '**Bring** dice' }), NOW);
    expect(r.errors).toEqual({});
    expect(r.payload).toEqual({
      title: 'Session 4',
      startsAt: NOW + 86_400_000,
      durationMinutes: 180,
      notes: '**Bring** dice',
    });
  });

  it('wants a name, of 200 characters at most', () => {
    expect(validateSession(draft({ title: '   ' }), NOW).errors.title).toBeDefined();
    expect(validateSession(draft({ title: 'x'.repeat(200) }), NOW).errors.title).toBeUndefined();
    expect(validateSession(draft({ title: 'x'.repeat(201) }), NOW).errors.title).toBeDefined();
  });

  it('wants a real time, not in the past (five minutes of grace) and within two years', () => {
    expect(validateSession(draft({ start: '' }), NOW).errors.start).toMatch(/date and a time/);
    expect(
      validateSession(draft({ start: toLocalInput(NOW - 6 * 60_000) }), NOW).errors.start,
    ).toMatch(/passed/);
    expect(
      validateSession(draft({ start: toLocalInput(NOW - 4 * 60_000) }), NOW).errors.start,
    ).toBeUndefined();
    expect(
      validateSession(draft({ start: toLocalInput(NOW + 800 * 86_400_000) }), NOW).errors.start,
    ).toMatch(/far/);
  });

  it('does not check the start of an edit that leaves it alone (a session under way stays editable)', () => {
    const started = draft({ start: toLocalInput(NOW - 60 * 60_000) });
    expect(validateSession(started, NOW, false).errors).toEqual({});
    expect(validateSession(started, NOW, true).errors.start).toBeDefined();
  });

  it('keeps the length within 15 minutes to 12 hours and the notes within 2,000 characters', () => {
    expect(validateSession(draft({ duration: 14 }), NOW).errors.duration).toBeDefined();
    expect(validateSession(draft({ duration: 721 }), NOW).errors.duration).toBeDefined();
    expect(validateSession(draft({ duration: 720 }), NOW).errors.duration).toBeUndefined();
    expect(validateSession(draft({ duration: 90.5 }), NOW).errors.duration).toBeDefined();
    expect(validateSession(draft({ notes: 'n'.repeat(2001) }), NOW).errors.notes).toBeDefined();
    expect(validateSession(draft({ notes: 'n'.repeat(2000) }), NOW).errors.notes).toBeUndefined();
  });

  it('reports every problem at once', () => {
    const r = validateSession(draft({ title: '', start: 'x', duration: 1 }), NOW);
    expect(Object.keys(r.errors).sort()).toEqual(['duration', 'start', 'title']);
    expect(r.payload).toBeUndefined();
  });
});

describe('sessionPatch and sameDraft', () => {
  const original = {
    id: 's',
    startsAt: NOW + 86_400_000,
    durationMinutes: 180,
    title: 'A',
    notes: '',
    cancelledAt: null,
  };
  it('sends only what changed', () => {
    const payload = { title: 'A', startsAt: original.startsAt, durationMinutes: 240, notes: '' };
    expect(sessionPatch(original, payload)).toEqual({ durationMinutes: 240 });
    expect(sessionPatch(original, { ...payload, durationMinutes: 180 })).toEqual({});
  });
  it('compares drafts field by field', () => {
    expect(sameDraft(draft(), draft())).toBe(true);
    expect(sameDraft(draft(), draft({ notes: 'x' }))).toBe(false);
  });
});

describe('small helpers', () => {
  it('names the next session', () => {
    expect(nextSessionTitle([])).toBe('Session 1');
    expect(nextSessionTitle(['Session 2', 'Session 7', 'One shot'])).toBe('Session 8');
    expect(nextSessionTitle(['One shot', 'Prologue'])).toBe('Session 3');
  });
  it('labels lengths and keeps an unusual current one in the choices', () => {
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(180)).toBe('3 h');
    expect(durationLabel(90)).toBe('1 h 30');
    expect(durationChoices(180)).toHaveLength(16);
    expect(durationChoices(200)).toContain(200);
    expect(durationChoices(200)).toEqual([...durationChoices(200)].sort((a, b) => a - b));
  });
  it('lets only a session that has not started be cancelled', () => {
    expect(canCancel(NOW + 1, NOW)).toBe(true);
    expect(canCancel(NOW, NOW)).toBe(false);
  });
});
