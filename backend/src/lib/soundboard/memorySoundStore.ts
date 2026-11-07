import type { Board, Scene, Sound, SoundStore, Take } from './soundStore.js';

const copy = <T>(v: T): T => structuredClone(v);
const byCreated = <T extends { createdAt: number }>(a: T, b: T): number =>
  a.createdAt - b.createdAt;

export class MemorySoundStore implements SoundStore {
  private sounds = new Map<string, Sound>();
  private boards = new Map<string, Board>();
  private scenes = new Map<string, Scene>();

  putSound = async (s: Sound) => void this.sounds.set(s.id, copy(s));
  getSound = async (id: string) => {
    const s = this.sounds.get(id);
    return s ? copy(s) : undefined;
  };
  listSounds = async (ownerId: string) =>
    [...this.sounds.values()]
      .filter((s) => s.ownerId === ownerId)
      .sort(byCreated)
      .map(copy);
  deleteSound = async (id: string) => void this.sounds.delete(id);
  getTake = async (takeId: string): Promise<{ take: Take; sound: Sound } | undefined> => {
    for (const sound of this.sounds.values()) {
      const take = sound.takes.find((t) => t.id === takeId);
      if (take) return copy({ take, sound });
    }
    return undefined;
  };

  putBoard = async (b: Board) => void this.boards.set(b.id, copy(b));
  getBoard = async (id: string) => {
    const b = this.boards.get(id);
    return b ? copy(b) : undefined;
  };
  listBoards = async (ownerId: string) =>
    [...this.boards.values()]
      .filter((b) => b.ownerId === ownerId)
      .sort(byCreated)
      .map(copy);
  deleteBoard = async (id: string) => void this.boards.delete(id);

  putScene = async (s: Scene) => void this.scenes.set(s.id, copy(s));
  getScene = async (id: string) => {
    const s = this.scenes.get(id);
    return s ? copy(s) : undefined;
  };
  listScenes = async (ownerId: string) =>
    [...this.scenes.values()]
      .filter((s) => s.ownerId === ownerId)
      .sort(byCreated)
      .map(copy);
  deleteScene = async (id: string) => void this.scenes.delete(id);
}
