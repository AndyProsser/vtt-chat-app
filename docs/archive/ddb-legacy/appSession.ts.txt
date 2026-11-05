import type { AppSessionClaims } from '@vtt-chat-app/shared';
import { SignJWT, jwtVerify } from 'jose';

import { APP_SESSION_TOKEN_TTL_SECONDS } from '../../consts/index.js';

export async function issueAppSessionToken(
  claims: AppSessionClaims,
  secret: string,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${APP_SESSION_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

export async function verifyAppSessionToken(
  token: string,
  secret: string,
): Promise<AppSessionClaims> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key);
  return {
    ddbUserId: String(payload.ddbUserId),
    campaignId: String(payload.campaignId),
    isDm: Boolean(payload.isDm),
  };
}
