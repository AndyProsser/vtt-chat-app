import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import {
  DEVICE_POLL_INTERVAL_MS,
  DEVICE_POLL_MAX_FAILURES,
  DEVICE_REQUEST_TTL_MS,
} from '../consts/index.js';
import { isPageVisible, watchPageVisibility } from '../lib/pageVisibility.js';
import {
  accountDevicePoll,
  accountDeviceStart,
  accountErrorMessage,
  accountStatus,
} from '../lib/tauriBridge.js';
import type { AccountStatus, DeviceStart } from '../types/index.js';

export type ConnectPhase = 'idle' | 'starting' | 'waiting' | 'expired' | 'error';

export interface DeviceConnectState {
  phase: ConnectPhase;
  /** The server this request started on; everything shown while waiting must use it, not the field. */
  server?: string;
  userCode?: string;
  approveUrl?: string;
  /** Client-clock time the code stops being offered (receipt + TTL); never the server's `expiresAt`. */
  deadline?: number;
  error?: string;
}

export interface DeviceConnectDeps {
  start: (server: string) => Promise<DeviceStart>;
  poll: (server: string, requestId: string, pollSecret: string) => Promise<AccountStatus | null>;
  /**
   * The app's saved account. Read after a failed poll: the session may have been delivered and saved
   * even though a later step (listing campaigns, going live) failed, and then the app IS signed in.
   */
  status: () => Promise<AccountStatus>;
  now: () => number;
  isVisible: () => boolean;
  watchVisibility: (onChange: (visible: boolean) => void) => () => void;
  /** Called with the account status when the browser approved the request. */
  onStatus: (status: AccountStatus) => void;
}

const IDLE: DeviceConnectState = { phase: 'idle' };

/**
 * The browser-approved sign-in as a small state machine. Polling runs only while a request is
 * waiting AND the window is visible, so a hidden window has no timer. Expiry is judged by the
 * client's own deadline, so a skewed clock on either side cannot keep or kill a code wrongly.
 */
export function createDeviceConnect(deps: DeviceConnectDeps) {
  let state: DeviceConnectState = IDLE;
  const listeners = new Set<() => void>();
  let generation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unwatch: (() => void) | undefined;
  let inFlight = false;
  let failures = 0;
  let request: { server: string; requestId: string; pollSecret: string } | undefined;

  const set = (next: DeviceConnectState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const teardown = () => {
    generation++;
    stopTimer();
    unwatch?.();
    unwatch = undefined;
    request = undefined;
    inFlight = false;
    failures = 0;
  };

  const expire = () => {
    teardown();
    set({ phase: 'expired' });
  };

  async function tick(gen: number) {
    if (gen !== generation || !request || inFlight) return;
    if (state.deadline !== undefined && deps.now() >= state.deadline) return expire();
    const { server, requestId, pollSecret } = request;
    inFlight = true;
    try {
      const status = await deps.poll(server, requestId, pollSecret);
      if (gen !== generation) return;
      failures = 0;
      if (status) {
        teardown();
        set(IDLE);
        deps.onStatus(status);
      }
    } catch (e) {
      if (gen !== generation) return;
      const saved = await deps.status().catch(() => undefined);
      if (gen !== generation) return;
      if (saved?.signedIn) {
        teardown();
        set(IDLE);
        deps.onStatus(saved);
        return;
      }
      const code =
        typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : '';
      if (code === 'expired') {
        teardown();
        set({ phase: 'expired' });
      } else if (code === 'consent_required') {
        // The server spent the delivery; retrying can only end in "expired". Say what to do instead.
        teardown();
        set({ phase: 'error', error: accountErrorMessage(e) });
      } else if (++failures >= DEVICE_POLL_MAX_FAILURES) {
        teardown();
        set({ phase: 'error', error: accountErrorMessage(e) });
      }
    } finally {
      if (gen === generation) inFlight = false;
    }
  }

  function applyVisibility(gen: number, visible: boolean) {
    if (gen !== generation) return;
    stopTimer();
    if (!visible) return;
    if (state.deadline !== undefined && deps.now() >= state.deadline) return expire();
    void tick(gen);
    timer = setInterval(() => void tick(gen), DEVICE_POLL_INTERVAL_MS);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start(server: string) {
      if (state.phase === 'starting') return;
      teardown();
      const gen = generation;
      set({ phase: 'starting' });
      let started: DeviceStart;
      try {
        started = await deps.start(server);
      } catch (e) {
        if (gen === generation) set({ phase: 'error', error: accountErrorMessage(e) });
        return;
      }
      if (gen !== generation) return;
      request = { server, requestId: started.requestId, pollSecret: started.pollSecret };
      set({
        phase: 'waiting',
        server,
        userCode: started.userCode,
        approveUrl: started.approveUrl,
        deadline: deps.now() + DEVICE_REQUEST_TTL_MS,
      });
      unwatch = deps.watchVisibility((v) => applyVisibility(gen, v));
      // First poll is one interval away (the person has to approve first); none while hidden.
      if (deps.isVisible()) timer = setInterval(() => void tick(gen), DEVICE_POLL_INTERVAL_MS);
    },
    cancel() {
      teardown();
      set(IDLE);
    },
  };
}

export interface DeviceConnectApi extends DeviceConnectState {
  start: (server: string) => Promise<void>;
  cancel: () => void;
}

/** The device sign-in for the Connect screen; `onStatus` receives the account once approved. */
export function useDeviceConnect(onStatus: (status: AccountStatus) => void): DeviceConnectApi {
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const controller = useMemo(
    () =>
      createDeviceConnect({
        start: accountDeviceStart,
        poll: accountDevicePoll,
        status: accountStatus,
        now: () => Date.now(),
        isVisible: () => isPageVisible(),
        watchVisibility: (cb) => watchPageVisibility(document, cb),
        onStatus: (s) => onStatusRef.current(s),
      }),
    [],
  );
  useEffect(() => () => controller.cancel(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  return { ...state, start: controller.start, cancel: controller.cancel };
}
