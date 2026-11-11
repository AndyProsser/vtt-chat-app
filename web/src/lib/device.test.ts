import { afterEach, describe, expect, it, vi } from 'vitest';

import { approveDevice, codeFromSearch, describeDevice, deviceSummary } from './device.js';

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('codeFromSearch', () => {
  it('reads and upper-cases the c param', () => {
    expect(codeFromSearch('?c=abcd-2345')).toBe('ABCD-2345');
  });
  it('is undefined when missing or blank', () => {
    expect(codeFromSearch('')).toBeUndefined();
    expect(codeFromSearch('?c=')).toBeUndefined();
    expect(codeFromSearch('?c=%20')).toBeUndefined();
  });
});

describe('deviceSummary', () => {
  it('shows the label and address as sent', () => {
    expect(
      deviceSummary({ deviceLabel: 'Tray app (linux)', requestIp: '203.0.113.4', createdAt: 1 }),
    ).toEqual({ label: 'Tray app (linux)', address: '203.0.113.4' });
  });
  it('falls back when the server has no label or address', () => {
    expect(deviceSummary({ deviceLabel: null, requestIp: null, createdAt: 1 })).toEqual({
      label: 'Unknown device',
      address: 'unknown address',
    });
  });
});

describe('describeDevice', () => {
  it('returns the device on success, riding on the session cookie', async () => {
    const fn = mockFetch(200, { deviceLabel: 'Linux', requestIp: '203.0.113.4', createdAt: 1 });
    const r = await describeDevice('ABCD-2345');
    expect(r).toEqual({
      status: 'ok',
      device: { deviceLabel: 'Linux', requestIp: '203.0.113.4', createdAt: 1 },
    });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/device/ABCD-2345');
    expect(init.credentials).toBe('same-origin');
  });
  it('maps 404 invalid_token to expired', async () => {
    mockFetch(404, { error: 'invalid_token' });
    expect(await describeDevice('ABCD-2345')).toEqual({ status: 'expired' });
  });
  it('maps other failures to error', async () => {
    mockFetch(500, { error: 'boom', message: 'bad' });
    expect(await describeDevice('X')).toEqual({ status: 'error', message: 'bad' });
  });
});

describe('approveDevice', () => {
  it('posts the code and reports approved on 204', async () => {
    const fn = mockFetch(204);
    expect(await approveDevice('ABCD-2345')).toEqual({ status: 'approved' });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/device/approve');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ userCode: 'ABCD-2345' });
  });
  it('maps 404 invalid_token to expired', async () => {
    mockFetch(404, { error: 'invalid_token' });
    expect(await approveDevice('ABCD-2345')).toEqual({ status: 'expired' });
  });
  it('maps a network failure to error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    expect((await approveDevice('A')).status).toBe('error');
  });
});
