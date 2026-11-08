import { useEffect, useState } from 'react';

const QUERY = '(prefers-color-scheme: dark)';
const current = (): 'light' | 'dark' => (window.matchMedia(QUERY).matches ? 'dark' : 'light');

/** The OS light/dark preference, kept live: switching the OS setting restyles with no reload. */
export function useSystemAppearance(): 'light' | 'dark' {
  const [appearance, setAppearance] = useState(current);
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const on = () => setAppearance(current());
    media.addEventListener('change', on);
    return () => media.removeEventListener('change', on);
  }, []);
  return appearance;
}
