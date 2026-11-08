import { useThemeStore } from '../../lib/themeStore.js';
import { THEMES } from '../../lib/themes.js';

/** Theme picker. Light/dark is the OS's call; this chooses the look. Applies immediately. */
export function AppearanceSection() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  return (
    <div className="vtt-themes" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === themeId}
          className={t.id === themeId ? 'vtt-theme vtt-theme-on' : 'vtt-theme'}
          onClick={() => setTheme(t.id)}
        >
          <span className="vtt-swatches" aria-hidden>
            {[t.dark.bg, t.dark.gold, t.dark.glow, t.light.bg].map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          {t.name}
        </button>
      ))}
      <p className="vtt-muted">Light or dark follows your system setting.</p>
    </div>
  );
}
