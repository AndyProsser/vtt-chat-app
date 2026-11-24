/** How one in-world language is set. The first family in the stack is a bundled web font; the rest is the fallback. */
export interface LanguageFont {
  /** The CSS family name, exactly as the `@font-face` declares it. */
  family: string;
  weight: number;
  italic?: boolean;
  /** Nudges the size, because these faces have very different x-heights. */
  size?: string;
  tracking?: string;
  /** The system stack used until the file arrives, or if it never does. */
  fallback: string;
}

/** The two reading switches that change how a language line is drawn (see `readingPrefs`). */
export interface LanguageSwitches {
  languageFonts: boolean;
  forceReadable: boolean;
}
