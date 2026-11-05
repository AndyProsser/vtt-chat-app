import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  LiveKitConnectionState,
  MicrophoneStatePayload,
  SpeakingStatePayload,
} from '@vtt-chat-app/shared';
import {
  LIVEKIT_MICROPHONE_EVENT,
  LIVEKIT_SPEAKERS_EVENT,
  LIVEKIT_STATE_EVENT,
} from '@vtt-chat-app/shared';

export function onLiveKitState(
  handler: (state: LiveKitConnectionState) => void,
): Promise<UnlistenFn> {
  return listen<LiveKitConnectionState>(LIVEKIT_STATE_EVENT, (event) => handler(event.payload));
}

export function onMicrophoneState(
  handler: (payload: MicrophoneStatePayload) => void,
): Promise<UnlistenFn> {
  return listen<MicrophoneStatePayload>(LIVEKIT_MICROPHONE_EVENT, (event) =>
    handler(event.payload),
  );
}

/** Emitted on every `RoomEvent::ActiveSpeakersChanged` — carries the complete current speaker set. */
export function onSpeakersChanged(
  handler: (payload: SpeakingStatePayload) => void,
): Promise<UnlistenFn> {
  return listen<SpeakingStatePayload>(LIVEKIT_SPEAKERS_EVENT, (event) => handler(event.payload));
}

export function connectLiveKit(url: string, token: string): Promise<void> {
  return invoke('livekit_connect', { url, token });
}

export function disconnectLiveKit(): Promise<void> {
  return invoke('livekit_disconnect');
}

export function setMicrophoneMuted(muted: boolean): Promise<void> {
  return invoke('set_microphone_muted', { muted });
}
