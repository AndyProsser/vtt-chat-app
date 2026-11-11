import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountStatus } from '../types/index.js';
import { createDeviceConnect, type DeviceConnectDeps } from './useDeviceConnect.js';

const STATUS: AccountStatus = {
  signedIn: true,
  server: 'https://play.example.com',
  campaignId: null,
  userId: 'u1',
  displayName: 'Ann',
  campaigns: [],
};

function setup(overrides: Partial<DeviceConnectDeps> = {}) {
  let visible = true;
  const listeners = new Set<(v: boolean) => void>();
  const mocks = {
    start: vi.fn(async (_server: string) => ({
      requestId: 'r1',
      userCode: 'ABCD-2345',
      pollSecret: 's1',
      expiresAt: 0,
      approveUrl: 'https://play.example.com/connect?code=ABCD-2345',
    })),
    poll: vi.fn(async (..._args: [string, string, string]): Promise<AccountStatus | null> => null),
    onStatus: vi.fn(),
  };
  const deps: DeviceConnectDeps = {
    ...mocks,
    now: () => Date.now(),
    isVisible: () => visible,
    watchVisibility: (cb: (v: boolean) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ...overrides,
  };
  return {
    deps: mocks,
    ctl: createDeviceConnect(deps),
    setVisible(v: boolean) {
      visible = v;
      listeners.forEach((l) => l(v));
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createDeviceConnect', () => {
  it('starts idle, then waits with a code after start()', async () => {
    const { ctl, deps } = setup();
    expect(ctl.getState().phase).toBe('idle');
    await ctl.start('https://play.example.com');
    expect(deps.start).toHaveBeenCalledWith('https://play.example.com');
    expect(ctl.getState()).toMatchObject({
      phase: 'waiting',
      userCode: 'ABCD-2345',
      approveUrl: 'https://play.example.com/connect?code=ABCD-2345',
    });
    ctl.cancel();
  });

  it('keeps waiting while polls answer null, polling every 2 s with the start server', async () => {
    const { ctl, deps } = setup();
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(6000);
    expect(deps.poll).toHaveBeenCalledTimes(3);
    expect(deps.poll).toHaveBeenCalledWith('https://play.example.com', 'r1', 's1');
    expect(ctl.getState().phase).toBe('waiting');
    ctl.cancel();
  });

  it('reports the status and stops polling once a poll signs in', async () => {
    const { ctl, deps } = setup();
    deps.poll.mockResolvedValueOnce(null).mockResolvedValueOnce(STATUS);
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.onStatus).toHaveBeenCalledWith(STATUS);
    expect(deps.poll).toHaveBeenCalledTimes(2);
    expect(ctl.getState().phase).toBe('idle');
  });

  it('an `expired` poll error ends in the expired phase; start() again gives a new code', async () => {
    const { ctl, deps } = setup();
    deps.poll.mockRejectedValueOnce({ code: 'expired', message: 'gone' });
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctl.getState().phase).toBe('expired');
    deps.start.mockResolvedValueOnce({
      requestId: 'r2',
      userCode: 'WXYZ-6789',
      pollSecret: 's2',
      expiresAt: 0,
      approveUrl: 'https://play.example.com/connect?code=WXYZ-6789',
    });
    await ctl.start('https://play.example.com');
    expect(ctl.getState()).toMatchObject({ phase: 'waiting', userCode: 'WXYZ-6789' });
    ctl.cancel();
  });

  it('cancel() stops polling and returns to idle', async () => {
    const { ctl, deps } = setup();
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(2000);
    ctl.cancel();
    const calls = deps.poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(deps.poll.mock.calls.length).toBe(calls);
    expect(ctl.getState().phase).toBe('idle');
  });

  it('an unreachable server ends in the error phase with the message', async () => {
    const { ctl } = setup({
      start: vi.fn(async () => {
        throw { code: 'network', message: 'Could not reach the server.' };
      }),
    });
    await ctl.start('https://nope.example.com');
    expect(ctl.getState()).toMatchObject({ phase: 'error', error: 'Could not reach the server.' });
  });

  it('does not poll while hidden, and polls again when shown', async () => {
    const { ctl, deps, setVisible } = setup();
    await ctl.start('https://play.example.com');
    setVisible(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(deps.poll).not.toHaveBeenCalled();
    expect(ctl.getState().phase).toBe('waiting');
    setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.poll).toHaveBeenCalledTimes(1);
    ctl.cancel();
  });

  it('expires by its own deadline (receipt + 5 min - 5 s), ignoring the server clock', async () => {
    // The server says it expires in the distant past; that must not matter.
    const { ctl } = setup();
    await ctl.start('https://play.example.com');
    expect(ctl.getState().deadline).toBe(Date.now() + 295_000);
    await vi.advanceTimersByTimeAsync(294_000);
    expect(ctl.getState().phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctl.getState().phase).toBe('expired');
  });

  it('notices an elapsed deadline the moment the window is shown again', async () => {
    const { ctl, setVisible } = setup();
    await ctl.start('https://play.example.com');
    setVisible(false);
    vi.setSystemTime(Date.now() + 400_000);
    setVisible(true);
    expect(ctl.getState().phase).toBe('expired');
  });

  it('rides out 4 failed polls, then signs in', async () => {
    const { ctl, deps } = setup();
    const down = { code: 'network', message: 'Could not reach the server.' };
    deps.poll
      .mockRejectedValueOnce(down)
      .mockRejectedValueOnce(down)
      .mockRejectedValueOnce(down)
      .mockRejectedValueOnce(down)
      .mockResolvedValueOnce(STATUS);
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(8000);
    expect(ctl.getState().phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.onStatus).toHaveBeenCalledWith(STATUS);
  });

  it('a success between failures resets the count', async () => {
    const { ctl, deps } = setup();
    const down = { code: 'network', message: 'down' };
    for (let i = 0; i < 4; i++) deps.poll.mockRejectedValueOnce(down);
    deps.poll.mockResolvedValueOnce(null);
    for (let i = 0; i < 4; i++) deps.poll.mockRejectedValueOnce(down);
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(18_000);
    expect(ctl.getState().phase).toBe('waiting');
    ctl.cancel();
  });

  it('5 consecutive failed polls end in the error phase with the last message', async () => {
    const { ctl, deps } = setup();
    for (let i = 1; i <= 5; i++)
      deps.poll.mockRejectedValueOnce({ code: 'network', message: `down ${i}` });
    await ctl.start('https://play.example.com');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ctl.getState()).toMatchObject({ phase: 'error', error: 'down 5' });
    const calls = deps.poll.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(deps.poll.mock.calls.length).toBe(calls);
  });

  it('remembers the server the request started on', async () => {
    const { ctl } = setup();
    await ctl.start('https://a.example.com');
    expect(ctl.getState().server).toBe('https://a.example.com');
    ctl.cancel();
  });

  it('cancel() after a start on server A (a deep link to B) leaves idle and polls A no more', async () => {
    const { ctl, deps } = setup();
    await ctl.start('https://a.example.com');
    await vi.advanceTimersByTimeAsync(2000);
    const calls = deps.poll.mock.calls.length;
    ctl.cancel();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(deps.poll.mock.calls.length).toBe(calls);
    expect(ctl.getState()).toEqual({ phase: 'idle' });
  });

  it('is `starting` until the server answers, and ignores a second start()', async () => {
    let resolve!: (v: Awaited<ReturnType<DeviceConnectDeps['start']>>) => void;
    const startFn = vi.fn(
      () => new Promise<Awaited<ReturnType<DeviceConnectDeps['start']>>>((r) => (resolve = r)),
    );
    const { ctl } = setup({ start: startFn });
    const first = ctl.start('https://play.example.com');
    expect(ctl.getState().phase).toBe('starting');
    await ctl.start('https://play.example.com');
    expect(startFn).toHaveBeenCalledTimes(1);
    resolve({
      requestId: 'r',
      userCode: 'ABCD-2345',
      pollSecret: 's',
      expiresAt: 0,
      approveUrl: 'u',
    });
    await first;
    expect(ctl.getState().phase).toBe('waiting');
    ctl.cancel();
  });
});
