import { describe, expect, it } from 'vitest';

import { recordingBar } from './recordingBar.js';

const running = { recordingId: 'r', capturing: true, startedAt: 1000 };
const paused = { recordingId: 'r', capturing: false, startedAt: 1000 };

describe('recordingBar', () => {
  it('shows players a read-only REC with no controls', () => {
    const bar = recordingBar(running, false, 66_000);
    expect(bar).toMatchObject({ visible: true, paused: false, actions: [] });
    expect(bar.label).toBe('00:01:05');
  });

  it('gives the DM pause and stop while recording, resume and stop while paused', () => {
    expect(recordingBar(running, true, 2000).actions).toEqual(['pause', 'stop']);
    const p = recordingBar(paused, true, 2000);
    expect(p.actions).toEqual(['resume', 'stop']);
    expect(p.paused).toBe(true);
  });

  it('offers the DM only start when nothing records, and hides the indicator', () => {
    expect(recordingBar(null, true, 0)).toMatchObject({ visible: false, actions: ['start'] });
    expect(recordingBar(null, false, 0)).toMatchObject({ visible: false, actions: [] });
  });

  it('never shows a negative time when the start is in the future or unknown', () => {
    expect(recordingBar({ ...running, startedAt: 9000 }, false, 1000).label).toBe('00:00:00');
    expect(recordingBar({ ...running, startedAt: null }, false, 1000).label).toBe('00:00:00');
  });
});
