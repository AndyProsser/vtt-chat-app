import { describe, expect, it } from 'vitest';

import { checkVoice, type VoiceDeps } from './voice.js';

const base = (over: Partial<VoiceDeps> = {}): VoiceDeps => ({
  healthUrl: 'http://livekit:7880',
  publicUrl: 'wss://play.example.com/livekit',
  fetchImpl: (async () => new Response('OK', { status: 200 })) as typeof fetch,
  listRooms: async () => [],
  listEgress: async () => [],
  recordingConfigured: true,
  ...over,
});
const row = (rows: Awaited<ReturnType<typeof checkVoice>>, name: RegExp) =>
  rows.find((r) => name.test(r.name))!;

describe('checkVoice: a healthy voice server', () => {
  it('is ok on the server, its keys, recording and the address players use', async () => {
    const rows = await checkVoice(base({ listRooms: async () => [{}, {}] }));
    expect(row(rows, /LiveKit server/).badge).toBe('ok');
    expect(row(rows, /LiveKit keys/).badge).toBe('ok');
    expect(row(rows, /LiveKit keys/).detail).toMatch(/2 rooms? in use/);
    expect(row(rows, /Recording/).badge).toBe('ok');
    expect(row(rows, /Address/).badge).toBe('ok');
    expect(row(rows, /Address/).detail).toContain('wss://play.example.com/livekit');
  });

  it('says what the server cannot know: the media ports, from inside it', async () => {
    const r = row(await checkVoice(base()), /ports/i);
    expect(r.badge).toBe('off');
    expect(r.detail).toMatch(/50000/);
    expect(r.detail).toMatch(/7881/);
    expect(r.detail).toMatch(/test reach/);
  });
});

describe('checkVoice: when something is wrong', () => {
  it('fails the server when it does not answer, and stops there rather than blaming the keys', async () => {
    const rows = await checkVoice(
      base({
        fetchImpl: (async () => {
          throw new Error('connect ECONNREFUSED');
        }) as typeof fetch,
      }),
    );
    expect(row(rows, /LiveKit server/).badge).toBe('fail');
    expect(row(rows, /LiveKit server/).detail).toMatch(/ECONNREFUSED/);
    expect(rows.find((r) => /LiveKit keys/.test(r.name))).toBeUndefined();
  });

  it('fails the keys when LiveKit refuses them, and says where they live', async () => {
    const r = row(
      await checkVoice(
        base({
          listRooms: async () => {
            throw new Error('invalid token');
          },
        }),
      ),
      /LiveKit keys/,
    );
    expect(r.badge).toBe('fail');
    expect(r.detail).toMatch(/LIVEKIT_API_KEY/);
  });

  it('fails recording when Egress cannot be reached, because a session would not be recorded', async () => {
    const r = row(
      await checkVoice(
        base({
          listEgress: async () => {
            throw new Error('egress unavailable');
          },
        }),
      ),
      /Recording/,
    );
    expect(r.badge).toBe('fail');
    expect(r.detail).toMatch(/egress unavailable/);
  });

  it('leaves recording out when it is not set up', async () => {
    const r = row(await checkVoice(base({ recordingConfigured: false })), /Recording/);
    expect(r.badge).toBe('off');
  });

  it('warns about a plain ws:// address, which only a LAN or --http install uses', async () => {
    const r = row(await checkVoice(base({ publicUrl: 'ws://192.168.1.5/livekit' })), /Address/);
    expect(r.badge).toBe('warn');
    expect(r.detail).toMatch(/LAN|private|only/i);
  });
});
