import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  LiveKitConnectionState,
  MicrophoneStatePayload,
  SpeakingStatePayload,
} from '@vtt-chat-app/shared';

import { ACCOUNT_ERROR_EVENT, SYNC_EVENT } from '../consts/index.js';
import type {
  AccountError,
  AccountStatus,
  Hydration,
  RecordingAction,
  SyncEvent,
} from '../types/index.js';
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

// ---- account, feed and commands (see src-tauri/src/account_commands.rs, bridge.rs) ----

export const accountStatus = () => invoke<AccountStatus>('account_status');

export const accountSignIn = (server: string, email: string, password: string) =>
  invoke<AccountStatus>('account_sign_in', { server, email, password });

export const accountSelectCampaign = (campaignId: string) =>
  invoke<AccountStatus>('account_select_campaign', { campaignId });

export const accountSignOut = () => invoke<AccountStatus>('account_sign_out');

export const panelHydrate = () => invoke<Hydration>('panel_hydrate');

export const chatSend = (text: string, to?: string) => invoke<void>('chat_send', { text, to });

/** A DM soundboard or voice-group command (`sync_command`); the server checks the sender is the DM. */
export const syncCommand = (t: string, data: Record<string, unknown>) =>
  invoke<void>('sync_command', { t, data });

export const recordingControl = (action: RecordingAction) =>
  invoke<void>('recording_control', { action });

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A REST call relayed by Rust (`campaign_api`); `path` is relative to the campaign, e.g. `loot`. */
export const campaignApi = <T = unknown>(method: Method, path: string, body?: unknown) =>
  invoke<T>('campaign_api', { method, path, body });

/** An image the server holds, as a `data:` URL (`campaign_file`). */
export const campaignFile = (path: string) => invoke<string>('campaign_file', { path });

export const panelOpen = (name: string) => invoke<void>('panel_open', { name });

export function onSyncEvent(handler: (event: SyncEvent) => void): Promise<UnlistenFn> {
  return listen<SyncEvent>(SYNC_EVENT, (event) => handler(event.payload));
}

export function onAccountError(handler: (error: AccountError) => void): Promise<UnlistenFn> {
  return listen<AccountError>(ACCOUNT_ERROR_EVENT, (event) => handler(event.payload));
}

/** Tauri rejects with whatever the command returned; account commands return `{ code, message }`. */
export function accountErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === 'string' ? error : 'Something went wrong.';
}
