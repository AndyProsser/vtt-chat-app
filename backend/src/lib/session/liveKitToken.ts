import { AccessToken } from 'livekit-server-sdk';

export interface LiveKitTokenParams {
  apiKey: string;
  apiSecret: string;
  identity: string;
  roomName: string;
}

export async function mintLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  roomName,
}: LiveKitTokenParams): Promise<string> {
  const accessToken = new AccessToken(apiKey, apiSecret, { identity });
  accessToken.addGrant({ roomJoin: true, room: roomName });
  return accessToken.toJwt();
}
