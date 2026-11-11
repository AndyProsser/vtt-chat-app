import { describe, expect, it } from 'vitest';

import type { StatusSnapshot } from '../types/index.js';
import { ago, headline, pipelineLine } from './summary.js';

const snap = (services: [string, boolean][]): StatusSnapshot => ({
  at: 0,
  ok: services.every(([, ok]) => ok),
  services: services.map(([name, ok]) => ({ name, ok })),
  players: { online: 0 },
  recording: { active: 0 },
  pipeline: null,
  storage: null,
});

describe('headline', () => {
  it('is calm when all is well, and says what is wrong when not', () => {
    expect(headline(snap([['backend', true]])).tone).toBe('ok');
    expect(
      headline(
        snap([
          ['backend', true],
          ['livekit', false],
        ]),
      ),
    ).toEqual({
      tone: 'warn',
      text: 'Voice is not working right now',
    });
    expect(
      headline(
        snap([
          ['backend', true],
          ['database', false],
        ]),
      ).tone,
    ).toBe('down');
    expect(
      headline(
        snap([
          ['backend', true],
          ['valkey', false],
        ]),
      ).tone,
    ).toBe('warn');
  });
});

describe('pipelineLine', () => {
  it('summarises the queue', () => {
    expect(pipelineLine(null)).toBe('Not reported');
    expect(pipelineLine({ queued: 0, running: 0, failed: 0, last: null })).toBe('Idle');
    expect(pipelineLine({ queued: 2, running: 1, failed: 1, last: null })).toBe(
      '1 processing, 2 waiting, 1 failed',
    );
  });
});

describe('ago', () => {
  it('uses the largest sensible unit', () => {
    expect(ago(0, 30_000)).toBe('just now');
    expect(ago(0, 90 * 60_000)).toBe('1 hour ago');
    expect(ago(0, 3 * 86_400_000)).toBe('3 days ago');
  });
});
