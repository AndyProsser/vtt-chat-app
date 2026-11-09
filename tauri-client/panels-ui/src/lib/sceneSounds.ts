export interface PickableSound {
  id: string;
  name: string;
  category?: string;
}

/**
 * The sounds a scene layer may use. A loop plays for as long as the scene does, so it takes ambience and
 * music; a random layer drops a one-shot in now and then, so it takes the effects (the same sounds the
 * stingers use). A sound with no category counts as an effect.
 */
export function soundsFor(mode: 'loop' | 'random', sounds: PickableSound[]): PickableSound[] {
  const looping = (s: PickableSound) => s.category === 'ambience' || s.category === 'music';
  return sounds.filter((s) => (mode === 'loop' ? looping(s) : !looping(s)));
}
