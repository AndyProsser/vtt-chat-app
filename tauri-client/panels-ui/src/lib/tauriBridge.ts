import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  LiveKitConnectionState,
  MicrophoneStatePayload,
  SpeakingStatePayload,
} from '@vtt-chat-app/shared';

import { ACCOUNT_ERROR_EVENT, SYNC_EVENT } from '../consts/index.js';
import type { Status } from './statusStore.js';
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

/**
 * Where voice and the microphone stand right now. The app joins voice when it starts, before any window
 * is listening, so a window asks once when it opens instead of waiting for a change that may never come.
 */
export const livekitSnapshot = () =>
  invoke<[LiveKitConnectionState, MicrophoneStatePayload]>('livekit_snapshot');

export function onLiveKitState(
  handler: (state: LiveKitConnectionState) => void,
): Promise<UnlistenFn> {
  return listen<LiveKitConnectionState>(LIVEKIT_STATE_EVENT, (event) => handler(event.payload));
}

/** Status (online, away, offline) and the choice of when to go Away by itself. Every launch starts Offline. */
export const statusGet = () => invoke<Status>('status_get');
export const statusSet = (status: Status) => invoke<void>('status_set', { status });
export const awayMinutesGet = () => invoke<number>('away_minutes_get');
export const awayMinutesSet = (minutes: number) => invoke<void>('away_minutes_set', { minutes });
export function onStatus(handler: (status: Status) => void): Promise<UnlistenFn> {
  return listen<Status>('status:changed', (event) => handler(event.payload));
}
/** An unmute was pressed (hotkey) while not in voice: offer to join. */
export function onOfferConnect(handler: () => void): Promise<UnlistenFn> {
  return listen('status:offer-connect', () => handler());
}

/** Opens (or reuses) the handout viewer window for one handout. */
export const handoutViewOpen = (id: string) => invoke<void>('handout_view_open', { id });
/** The viewer window is already open and another handout was clicked. */
export function onHandoutView(handler: (id: string) => void): Promise<UnlistenFn> {
  return listen<string>('handout:view', (event) => handler(event.payload));
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

/** Which optional sign-in methods the server offers (`auth_providers`). */
export const authProviders = (server: string) =>
  invoke<{ oidc: boolean; mail: boolean }>('auth_providers', { server });

/** Opens the server's single sign-on page in the system browser (`account_open_sso`). */
export const accountOpenSso = (server: string) => invoke<void>('account_open_sso', { server });

/** Emails a one-time sign-in code (the answer is the same whether or not the address has an account). */
export const accountRequestCode = (server: string, email: string) =>
  invoke<void>('account_request_code', { server, email });

/** Signs in with a one-time code, from email or handed over by the DM or operator. */
export const accountSignInCode = (server: string, code: string) =>
  invoke<AccountStatus>('account_sign_in_code', { server, code });

export const accountSelectCampaign = (campaignId: string) =>
  invoke<AccountStatus>('account_select_campaign', { campaignId });

/** Changes the player's own name (the server validates it). */
export const accountRename = (name: string) => invoke<AccountStatus>('account_rename', { name });

/** Sets (or with `null` clears) your own portrait: `avatar:<id>` from an upload, or an emblem. */
export const accountSetAvatar = (avatar: string | null) =>
  invoke<AccountStatus>('account_set_avatar', { avatar });

/** Searches the campaign's recorded history (`records_search`). */
export const recordsSearch = (query: string) =>
  invoke<{ hits: import('./history.js').SearchHit[] }>('records_search', { query });

/** D&D Beyond sync (`ddb_api`): is it on, link a sheet, sync now, unlink. Answers the updated character. */
export const ddbStatus = () => invoke<{ enabled: boolean }>('ddb_api', { action: 'status' });
export const ddbAction = (action: 'link' | 'sync' | 'unlink', characterId: string, url?: string) =>
  invoke<{ character: unknown }>('ddb_api', { action, characterId, url });

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

/** Whether the DM also hears effects on their own speakers (`soundboard_monitor_set`). */
export const soundboardMonitorSet = (on: boolean) => invoke<void>('soundboard_monitor_set', { on });

/** The picture on the system clipboard as base64 PNG, or `null` if there is none (`clipboard_picture`). */
export const clipboardPicture = () => invoke<string | null>('clipboard_picture');

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

export interface AudioDeviceList {
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
  chosenInput: string | null;
  chosenOutput: string | null;
}

/** The microphones and speakers the system offers, and which ones are chosen. */
export const audioDevices = () => invoke<AudioDeviceList>('audio_devices');

/** Picks the microphone (`input`) or speaker (`output`); `null` is the system default. */
export const audioDeviceChoose = (kind: 'input' | 'output', id: string | null) =>
  invoke<void>('audio_device_choose', { kind, id });

/** Which audio engine is chosen (for the next call) and which this call uses (`null` when not in voice). */
export interface AudioEngineState {
  engine: 'mixer' | 'platform';
  active: 'mixer' | 'platform' | null;
  micGain: number;
  /** Adjust the microphone volume automatically (chosen for the next call). */
  autoGain: boolean;
  volumes: Record<string, number>;
}
export const audioEngine = () => invoke<AudioEngineState>('audio_engine');
export const audioEngineSet = (engine: 'mixer' | 'platform') =>
  invoke<void>('audio_engine_set', { engine });
/** Microphone volume, 0 to 4 (new engine only). */
export const micGainSet = (gain: number) => invoke<void>('mic_gain_set', { gain });
/** Automatic microphone volume on or off; takes effect the next time you join voice. */
export const autoGainSet = (on: boolean) => invoke<void>('auto_gain_set', { on });
/** The microphone's level right now, 0 to 1, or `null` when the new engine is not running. */
export const micLevel = () => invoke<number | null>('mic_level');
/** One person's volume, 0 to 2 (new engine only). */
export const playerVolumeSet = (userId: string, gain: number) =>
  invoke<void>('player_volume_set', { userId, gain });

/** Uploads a shrunken portrait (base64) and returns its id. */
export const avatarUpload = (data: string) => invoke<{ id: string }>('avatar_upload', { data });

/** A portrait as a `data:` URL (the window may not fetch from the network). */
export const avatarImage = (id: string) => invoke<string>('avatar_image', { id });

/** The DM's volume for stingers and for scenes (0 to 1 each), applied as each sound starts. */
export const soundboardLevelsSet = (stingers: number, scenes: number) =>
  invoke<void>('soundboard_levels_set', { stingers, scenes });
