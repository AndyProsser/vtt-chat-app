import { AccessToken } from 'livekit-server-sdk';

export interface LiveKitTokenParams {
  apiKey: string;
  apiSecret: string;
  identity: string;
  roomName: string;
  /** Display name shown to other participants. */
  name?: string;
  /** How long the token is valid for joining. LiveKit's default (6 h) covers a long session. */
  ttl?: string | number;
}

export async function mintLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  roomName,
  name,
  ttl,
}: LiveKitTokenParams): Promise<string> {
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity,
    ...(name === undefined ? {} : { name }),
    ...(ttl === undefined ? {} : { ttl }),
  });
  accessToken.addGrant({ roomJoin: true, room: roomName });
  return accessToken.toJwt();
}
