import { useEffect, useState, type RefObject } from 'react';

/**
 * The height that reaches from the top of an element to the bottom of the window, less a small gap, kept up to
 * date as the window changes size. A viewer frame uses it to fill its window exactly (no guessed offsets), and
 * scrolls inside itself when its content is larger.
 */
export function useFillHeight(
  ref: RefObject<HTMLElement | null>,
  ready = true,
  gap = 14,
  min = 160,
) {
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!ready) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      setHeight(
        Math.max(min, Math.floor(window.innerHeight - el.getBoundingClientRect().top - gap)),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    // The toolbar above may wrap or the window settle after first paint: measure once more shortly after.
    const t = window.setTimeout(measure, 150);
    return () => {
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, [ref, ready, gap, min]);
  return height;
}
