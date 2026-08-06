import type { CobaltCookieDetectedPayload, LiveKitConnectionState } from '@vtt-chat-app/shared';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function onCobaltCookieDetected(
  handler: (payload: CobaltCookieDetectedPayload) => void,
): Promise<UnlistenFn> {
  return listen<CobaltCookieDetectedPayload>('ddb:cobalt-cookie', (event) =>
    handler(event.payload),
  );
}

export function onLiveKitState(
  handler: (state: LiveKitConnectionState) => void,
): Promise<UnlistenFn> {
  return listen<LiveKitConnectionState>('livekit:state', (event) => handler(event.payload));
}

export function connectLiveKit(url: string, token: string): Promise<void> {
  return invoke('livekit_connect', { url, token });
}

export function disconnectLiveKit(): Promise<void> {
  return invoke('livekit_disconnect');
}
