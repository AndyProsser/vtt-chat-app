import { describe, expect, it } from 'vitest';

import { RecordingState } from './recordingState.js';

describe('RecordingState start time', () => {
  it('records startedAt from the injected clock and keeps it across pause and resume', () => {
    let clock = 1000;
    const state = new RecordingState(
      () => 'rec-1',
      () => clock,
    );
    const started = state.start('c1');
    expect(started.startedAt).toBe(1000);
    clock = 9000;
    expect(state.pause('c1').startedAt).toBe(1000);
    expect(state.resume('c1').startedAt).toBe(1000);
    expect(state.current('c1')).toEqual({
      recordingId: 'rec-1',
      status: 'IN-PROGRESS',
      startedAt: 1000,
    });
  });
});
