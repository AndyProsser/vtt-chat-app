import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu } from '@radix-ui/themes';

import { useThemeStore } from '../../lib/themeStore.js';
import { THEMES } from '../../lib/themes.js';

/** Theme picker, a dropdown with a colour preview per theme. Light/dark is the OS's call; applies at once. */
export function AppearanceSection() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const current = THEMES.find((t) => t.id === themeId) ?? THEMES[0]!;
  const swatches = (t: (typeof THEMES)[number]) => (
    <span className="vtt-swatches" aria-hidden>
      {[t.dark.bg, t.dark.gold, t.dark.glow, t.light.bg].map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
    </span>
  );
  return (
    <div className="vtt-theme-pick">
      <span className="vtt-muted">Theme</span>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <button type="button" className="vtt-theme-trigger" aria-label="Theme">
            {swatches(current)}
            {current.name}
            <ChevronDown size={14} aria-hidden />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          {THEMES.map((t) => (
            <DropdownMenu.Item key={t.id} onSelect={() => setTheme(t.id)}>
              <span className="vtt-theme-item">
                {swatches(t)}
                {t.name}
                {t.id === themeId && <Check size={14} aria-hidden />}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
      <span className="vtt-muted">Light or dark follows your system setting.</span>
    </div>
  );
}
