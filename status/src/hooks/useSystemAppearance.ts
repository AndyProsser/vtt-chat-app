import { useEffect, useState } from 'react';

/**
 * `light` or `dark`, following the operating system and changing when it does. Radix's `inherit`
 * appearance does not look at the OS by itself, so the page has to tell it (CLAUDE.md §4).
 */
export function useSystemAppearance(): 'light' | 'dark' {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const change = (e: MediaQueryListEvent) => setDark(e.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return dark ? 'dark' : 'light';
}
