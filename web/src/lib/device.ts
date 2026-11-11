import { UNKNOWN_ADDRESS, UNKNOWN_DEVICE } from '../consts/connect.js';
import { ApiError, request } from './api.js';

/** As the server describes a waiting request: the app may send no label, and the address may be unknown. */
export interface DeviceRequest {
  deviceLabel: string | null;
  requestIp: string | null;
  createdAt: number;
}

/** What the approval page shows, with a readable stand-in for anything the server left empty. */
export function deviceSummary(device: DeviceRequest): { label: string; address: string } {
  return {
    label: device.deviceLabel || UNKNOWN_DEVICE,
    address: device.requestIp || UNKNOWN_ADDRESS,
  };
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
