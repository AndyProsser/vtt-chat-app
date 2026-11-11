import { useEffect, useState } from 'react';

/**
 * Whether the landing page may play its background video: only on a wide screen, for someone who has
 * not asked for reduced motion or data saving. Everyone else keeps the still image (which the video
 * covers), so the page never depends on the video.
 */
export function useHeroMotion(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(
      '(prefers-reduced-motion: no-preference) and (min-width: 700px)',
    );
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    const update = () => setOk(query.matches && saveData !== true);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return ok;
}
