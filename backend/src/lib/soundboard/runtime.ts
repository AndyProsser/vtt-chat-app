import { randomUUID } from 'node:crypto';

import { DomainError } from '../errors.js';
import type { ButtonMode, Scene, Sound, SoundStore } from './soundStore.js';

/** A sound playing (or just triggered) in a campaign. Clients fetch the take and play it locally. */
export interface PlayRecord {
  playId: string;
  soundId: string;
  takeId: string;
  mode: ButtonMode;
  /** The DM's volume for this trigger, 0–1. */
  volume: number;
  /** The take's own loudness trim, 0–1. */
  level: number;
  startedAt: number;
  /** Set when a scene layer started it. */
  layerId: string | null;
  /** `null` = everyone in the campaign; otherwise only these accounts hear it. */
  targets: string[] | null;
}

/** What the runtime tells the world; the hub turns it into WebSocket frames. */
export interface RuntimeEvents {
  emit(campaignId: string, type: string, data: unknown, only?: ReadonlySet<string>): void;
}

export interface RuntimeDeps {
  sounds: SoundStore;
  events: RuntimeEvents;
  now?: () => number;
  /** In [0, 1). Injected so tests are deterministic. */
  random?: () => number;
  newId?: () => string;
  /** Injected so tests can drive time. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface ActiveScene {
  scene: Scene;
  timers: Map<string, unknown>;
  loopPlayIds: string[];
}

interface CampaignState {
  loops: Map<string, PlayRecord>;
  scene: ActiveScene | null;
  master: number;
  gains: Map<string, number>;
}

/**
 * What is playing at each table. The DM's actions (`play`, `startScene`, …) arrive from the hub,
 * already known to come from the campaign's DM; this class checks the sounds are really theirs,
 * picks the take (so every client hears the same recording), runs random scene layers on a timer,
 * and keeps the "now playing" state so a late joiner or a reconnecting client catches up.
 *
 * Clients play locally through their own cue player — never through the SFU, so none of this is in
 * a recording. State is in memory by design: a server restart ends the scene, which the DM can
 * simply start again.
 */
export class SoundboardRuntime {
  private readonly campaigns = new Map<string, CampaignState>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly deps: RuntimeDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.newId = deps.newId ?? randomUUID;
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const h = setTimeout(fn, ms);
        h.unref();
        return h;
      });
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  private state(campaignId: string): CampaignState {
    let s = this.campaigns.get(campaignId);
    if (!s) {
      s = { loops: new Map(), scene: null, master: 1, gains: new Map() };
      this.campaigns.set(campaignId, s);
    }
    return s;
  }

  private async ownedSound(ownerId: string, soundId: string): Promise<Sound> {
    const sound = await this.deps.sounds.getSound(soundId);
    if (!sound || sound.ownerId !== ownerId)
      throw new DomainError('not_found', 'that sound is not in your library');
    if (sound.takes.length === 0) throw new DomainError('conflict', 'that sound has no recordings');
    return sound;
  }

  private pickTake(sound: Sound, takeId?: string) {
    if (takeId !== undefined) {
      const chosen = sound.takes.find((t) => t.id === takeId);
      if (!chosen) throw new DomainError('not_found', 'no such take');
      return chosen;
    }
    // A random take, so a button pressed twice does not play the same recording twice.
    return sound.takes[
      Math.min(sound.takes.length - 1, Math.floor(this.random() * sound.takes.length))
    ] as Sound['takes'][number];
  }

  private announce(campaignId: string, rec: PlayRecord): void {
    this.deps.events.emit(
      campaignId,
      'sound.play',
      { campaignId, ...rec, targets: undefined },
      rec.targets ? new Set(rec.targets) : undefined,
    );
  }

  /** Triggers a sound for everyone, or for chosen people. Loops are remembered until stopped. */
  async play(
    campaignId: string,
    dmId: string,
    input: { soundId: string; takeId?: string; mode?: ButtonMode; volume?: number; to?: string[] },
  ): Promise<PlayRecord> {
    const sound = await this.ownedSound(dmId, input.soundId);
    const take = this.pickTake(sound, input.takeId);
    const rec: PlayRecord = {
      playId: this.newId(),
      soundId: sound.id,
      takeId: take.id,
      mode: input.mode === 'loop' ? 'loop' : 'oneshot',
      volume: clamp(input.volume ?? 1, 0, 1),
      level: take.level,
      startedAt: this.now(),
      layerId: null,
      targets: input.to && input.to.length > 0 ? [...new Set(input.to)] : null,
    };
    if (rec.mode === 'loop') this.state(campaignId).loops.set(rec.playId, rec);
    this.announce(campaignId, rec);
    return rec;
  }

  /** Stops one play, or (with no id) every loop and the scene. */
  stop(campaignId: string, playId?: string): void {
    const s = this.state(campaignId);
    if (playId === undefined) {
      this.stopScene(campaignId);
      s.loops.clear();
      this.deps.events.emit(campaignId, 'sound.stop', { campaignId, playId: null });
      return;
    }
    s.loops.delete(playId);
    this.deps.events.emit(campaignId, 'sound.stop', { campaignId, playId });
  }

  async startScene(campaignId: string, dmId: string, sceneId: string): Promise<void> {
    const scene = await this.deps.sounds.getScene(sceneId);
    if (!scene || scene.ownerId !== dmId)
      throw new DomainError('not_found', 'that scene is not in your library');
    this.stopScene(campaignId);
    const s = this.state(campaignId);
    const active: ActiveScene = { scene, timers: new Map(), loopPlayIds: [] };
    s.scene = active;
    this.deps.events.emit(campaignId, 'scene.started', {
      campaignId,
      sceneId: scene.id,
      name: scene.name,
    });

    for (const layer of scene.layers) {
      const sound = await this.deps.sounds.getSound(layer.soundId);
      if (!sound || sound.ownerId !== dmId || sound.takes.length === 0) continue; // a deleted sound just drops out
      if (layer.mode === 'loop') {
        const take = this.pickTake(sound);
        const rec: PlayRecord = {
          playId: this.newId(),
          soundId: sound.id,
          takeId: take.id,
          mode: 'loop',
          volume: layer.volume,
          level: take.level,
          startedAt: this.now(),
          layerId: layer.id,
          targets: null,
        };
        s.loops.set(rec.playId, rec);
        active.loopPlayIds.push(rec.playId);
        this.announce(campaignId, rec);
      } else {
        this.scheduleRandom(campaignId, active, layer.id);
      }
    }
  }

  private scheduleRandom(campaignId: string, active: ActiveScene, layerId: string): void {
    const layer = active.scene.layers.find((l) => l.id === layerId);
    if (!layer || layer.minIntervalSec === null || layer.maxIntervalSec === null) return;
    const seconds =
      layer.minIntervalSec + this.random() * (layer.maxIntervalSec - layer.minIntervalSec);
    const handle = this.setTimer(() => {
      void (async () => {
        if (this.campaigns.get(campaignId)?.scene !== active) return; // the scene changed meanwhile
        const sound = await this.deps.sounds.getSound(layer.soundId).catch(() => undefined);
        if (sound && sound.takes.length > 0 && this.campaigns.get(campaignId)?.scene === active) {
          const take = this.pickTake(sound);
          this.announce(campaignId, {
            playId: this.newId(),
            soundId: sound.id,
            takeId: take.id,
            mode: 'oneshot',
            volume: layer.volume,
            level: take.level,
            startedAt: this.now(),
            layerId: layer.id,
            targets: null,
          });
        }
        if (this.campaigns.get(campaignId)?.scene === active)
          this.scheduleRandom(campaignId, active, layerId);
      })();
    }, seconds * 1000);
    active.timers.set(layerId, handle);
  }

  stopScene(campaignId: string): void {
    const s = this.campaigns.get(campaignId);
    if (!s?.scene) return;
    for (const handle of s.scene.timers.values()) this.clearTimer(handle);
    for (const id of s.scene.loopPlayIds) s.loops.delete(id);
    s.scene = null;
    this.deps.events.emit(campaignId, 'scene.stopped', { campaignId });
  }

  setMaster(campaignId: string, volume: number): void {
    const s = this.state(campaignId);
    s.master = clamp(volume, 0, 1);
    this.deps.events.emit(campaignId, 'sound.volume', { campaignId, master: s.master });
  }

  /** The DM turns one player's soundboard up or down (0 = silent, up to 2 = double). */
  setPlayerGain(campaignId: string, userId: string, gain: number): void {
    const s = this.state(campaignId);
    const g = clamp(gain, 0, 2);
    s.gains.set(userId, g);
    this.deps.events.emit(campaignId, 'sound.volume', { campaignId, player: { userId, gain: g } });
  }

  /** What a joining or reconnecting client needs: loops still running (that it can hear), the scene, the volumes. */
  snapshot(campaignId: string, viewerId: string) {
    const s = this.campaigns.get(campaignId);
    if (!s)
      return {
        loops: [] as Omit<PlayRecord, 'targets'>[],
        scene: null,
        master: 1,
        gains: {} as Record<string, number>,
      };
    return {
      loops: [...s.loops.values()]
        .filter((r) => r.targets === null || r.targets.includes(viewerId))
        .map(({ targets: _targets, ...rec }) => rec),
      scene: s.scene ? { sceneId: s.scene.scene.id, name: s.scene.scene.name } : null,
      master: s.master,
      gains: Object.fromEntries(s.gains),
    };
  }

  /** Forgets a campaign (nobody is connected any more): timers stop, state goes. */
  reset(campaignId: string): void {
    const s = this.campaigns.get(campaignId);
    if (!s) return;
    if (s.scene) for (const handle of s.scene.timers.values()) this.clearTimer(handle);
    this.campaigns.delete(campaignId);
  }

  close(): void {
    for (const id of [...this.campaigns.keys()]) this.reset(id);
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : hi));
