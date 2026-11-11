import { ApiError, request } from './api.js';

export interface DeviceRequest {
  deviceLabel: string;
  requestIp: string;
  createdAt: number;
}

export type DescribeResult =
  | { status: 'ok'; device: DeviceRequest }
  | { status: 'expired' }
  | { status: 'error'; message: string };

export type ApproveResult =
  { status: 'approved' } | { status: 'expired' } | { status: 'error'; message: string };

/** The code the app put in the link (`/connect?c=ABCD-2345`), or undefined when absent. */
export function codeFromSearch(search: string): string | undefined {
  const raw = new URLSearchParams(search).get('c')?.trim();
  return raw ? raw.toUpperCase() : undefined;
}

/** The server answers unknown, expired and already-approved identically: 404 invalid_token. */
function toFailure(e: unknown): { status: 'expired' } | { status: 'error'; message: string } {
  if (e instanceof ApiError && e.status === 404 && e.code === 'invalid_token') {
    return { status: 'expired' };
  }
  const message = e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
  return { status: 'error', message };
}

export async function describeDevice(token: string, userCode: string): Promise<DescribeResult> {
  try {
    const device = await request<DeviceRequest>(
      'GET',
      `/api/auth/device/${encodeURIComponent(userCode)}`,
      { token },
    );
    return { status: 'ok', device };
  } catch (e) {
    return toFailure(e);
  }
}

export async function approveDevice(token: string, userCode: string): Promise<ApproveResult> {
  try {
    await request('POST', '/api/auth/device/approve', { token, body: { userCode } });
    return { status: 'approved' };
  } catch (e) {
    return toFailure(e);
  }
}
