export type SoundCategory = 'effect' | 'ambience' | 'music';

/** One recording of a sound. A sound with several takes plays a different one each time. */
export interface Take {
  id: string;
  soundId: string;
  mediaId: string;
  /** Per-take loudness trim, 0–1. */
  level: number;
  position: number;
}

export interface Sound {
  id: string;
  ownerId: string;
  name: string;
  category: SoundCategory;
  tags: string[];
  takes: Take[];
  createdAt: number;
}

export type ButtonMode = 'oneshot' | 'loop';

export interface BoardButton {
  id: string;
  label: string;
  soundId: string;
  mode: ButtonMode;
  /** 0–1. */
  volume: number;
  /** A note only the DM sees. */
  note: string;
}

export interface Board {
  id: string;
  ownerId: string;
  name: string;
  buttons: BoardButton[];
  createdAt: number;
}

/** `loop` plays continuously; `random` drops the sound in every so often (drips, footsteps). */
export type LayerMode = 'loop' | 'random';

export interface SceneLayer {
  id: string;
  soundId: string;
  mode: LayerMode;
  volume: number;
  /** Random layers only: seconds between drops, drawn between min and max. */
  minIntervalSec: number | null;
  maxIntervalSec: number | null;
}

export interface Scene {
  id: string;
  ownerId: string;
  name: string;
  layers: SceneLayer[];
  createdAt: number;
}

/** The DM's sound library. Postgres is the real one; the in-memory one backs tests. */
export interface SoundStore {
  /** Inserts or replaces a sound together with its takes. */
  putSound(sound: Sound): Promise<void>;
  getSound(id: string): Promise<Sound | undefined>;
  listSounds(ownerId: string): Promise<Sound[]>;
  /** Removes the sound and its take rows; the caller deletes the media files they pointed at. */
  deleteSound(id: string): Promise<void>;
  /** A take and the sound it belongs to, for playback and for authorising the download. */
  getTake(takeId: string): Promise<{ take: Take; sound: Sound } | undefined>;

  putBoard(board: Board): Promise<void>;
  getBoard(id: string): Promise<Board | undefined>;
  listBoards(ownerId: string): Promise<Board[]>;
  deleteBoard(id: string): Promise<void>;

  putScene(scene: Scene): Promise<void>;
  getScene(id: string): Promise<Scene | undefined>;
  listScenes(ownerId: string): Promise<Scene[]>;
  deleteScene(id: string): Promise<void>;
}
