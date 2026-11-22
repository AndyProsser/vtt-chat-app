import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SETTINGS, type AiSettings } from '@vtt-chat-app/shared';

import { createQuietGate } from './quietGate.js';

const settings = (pause: boolean): AiSettings => ({
  ...DEFAULT_AI_SETTINGS,
  processing: { pauseWhileRecording: pause },
});

function setup(pause: boolean, liveFor: number) {
  let t = 0;
  let live = liveFor; // how many more checks answer "recording"
  let checks = 0;
  const log: string[] = [];
  const gate = createQuietGate({
    records: {
      getAiSettings: async () => settings(pause),
      anyRecordingLive: async () => {
        checks++;
        return live-- > 0;
      },
    },
    now: () => t,
    sleep: async (ms) => void (t += ms),
    log: (l) => log.push(l),
    pollMs: 1000,
    goodForMs: 5000,
  });
  return { gate, log, checks: () => checks, time: () => t };
}

describe('createQuietGate', () => {
  it('does not wait when the setting is off, even with a recording live', async () => {
    const s = setup(false, 99);
    await s.gate();
    expect(s.time()).toBe(0);
    expect(s.log).toEqual([]);
  });

  it('waits while a table records, then carries on, saying so once each way', async () => {
    const s = setup(true, 3);
    await s.gate();
    expect(s.time()).toBe(3000);
    expect(s.log).toEqual([
      'a table is recording: processing waits until it stops',
      'no table is recording: processing carries on',
    ]);
  });

  it('reuses a go-ahead for a few seconds instead of asking every call', async () => {
    const s = setup(true, 0);
    await s.gate();
    await s.gate();
    await s.gate();
    expect(s.checks()).toBe(1);
  });

  it('carries on when the database cannot be asked', async () => {
    const gate = createQuietGate({
      records: {
        getAiSettings: async () => {
          throw new Error('down');
        },
        anyRecordingLive: async () => true,
      },
    });
    await expect(gate()).resolves.toBeUndefined();
  });
});
