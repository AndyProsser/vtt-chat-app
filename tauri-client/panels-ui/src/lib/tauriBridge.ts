import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  LiveKitConnectionState,
  MicrophoneStatePayload,
  SpeakingStatePayload,
} from '@vtt-chat-app/shared';

import { ACCOUNT_ERROR_EVENT, SYNC_EVENT } from '../consts/index.js';
import type { UpdateInfo } from './updateInfo.js';
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

/** Joins voice with the signed-in account (`voice_connect`); chat does not need it. */
export function voiceConnect(): Promise<void> {
  return invoke('voice_connect');
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

/** Joins a campaign by invite code, or creates one, then switches to it (`account_add_campaign`). */
export const accountAddCampaign = (action: 'join' | 'create' | 'refresh', value: string) =>
  invoke<AccountStatus>('account_add_campaign', { action, value });

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

/** Uploads a picture as a new handout (`handout_upload`); `data` is the file as base64. */
export const handoutUpload = (title: string, kind: 'image' | 'map', name: string, data: string) =>
  invoke<{ handout: { id: string } }>('handout_upload', { title, kind, name, data });

/** An image the server holds, as a `data:` URL (`campaign_file`). */
export const campaignFile = (path: string) => invoke<string>('campaign_file', { path });

/** Tells Rust this window has painted, so it can be shown (windows start hidden to avoid a blank flash). */
export const windowReady = () => invoke<void>('window_ready');

/** The server a `vtt-chat://connect?server=…` link supplied, once (`take_pending_server`). */
export const takePendingServer = () => invoke<string | null>('take_pending_server');

export function onLinkedServer(handler: (server: string) => void): Promise<UnlistenFn> {
  return listen<string>('deeplink:server', (event) => handler(event.payload));
}

/** Asks the signed-in server for a newer client; `null` is up to date (`update_check`). */
export const updateCheck = () => invoke<UpdateInfo | null>('update_check');
/** Installs what `updateCheck` found, then the app restarts itself (`update_install`). */
export const updateInstall = () => invoke<void>('update_install');

/** The DM's character voice (`voice_effect_set`); `normal` turns the effect off. Rejects if not in voice. */
export const voiceEffectSet = (name: string) => invoke<void>('voice_effect_set', { name });
export const voiceEffectGet = () => invoke<string>('voice_effect_get');
export function onVoiceEffect(handler: (name: string) => void): Promise<UnlistenFn> {
  return listen<string>('voice:effect', (event) => handler(event.payload));
}

export const autostartEnabled = () => invoke<boolean>('autostart_enabled');
export const autostartSet = (enabled: boolean) => invoke<void>('autostart_set', { enabled });

export const panelOpen = (name: string) => invoke<void>('panel_open', { name });

export function onSyncEvent(handler: (event: SyncEvent) => void): Promise<UnlistenFn> {
  return listen<SyncEvent>(SYNC_EVENT, (event) => handler(event.payload));
}

/** Sign-in, sign-out, campaign choice, or a session the server ended: re-read `accountStatus`. */
export function onAccountChanged(handler: () => void): Promise<UnlistenFn> {
  return listen('account:changed', () => handler());
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
