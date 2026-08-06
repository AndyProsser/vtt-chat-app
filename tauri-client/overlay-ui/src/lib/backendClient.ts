import type { DdbIdentity, SessionResponse } from '@vtt-chat-app/shared';

import { BACKEND_SESSION_URL } from '../consts/index.js';

export class BackendSessionError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'BackendSessionError';
  }
}

export async function requestSession(identity: DdbIdentity): Promise<SessionResponse> {
  const response = await fetch(BACKEND_SESSION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity }),
  });

  if (!response.ok) {
    throw new BackendSessionError(
      `session request failed with status ${response.status}`,
      response.status,
    );
  }

  return (await response.json()) as SessionResponse;
}
