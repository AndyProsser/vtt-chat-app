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

/** The three reading switches (Appearance on the desktop, the account page on the phone), kept per device. */
export interface ReadingPrefs {
  /** Draw each language in its own font. Off: every language reads in the body font. */
  languageFonts: boolean;
  /** Draw handouts in the narrative face. Off: handouts read in the body font. */
  documentFonts: boolean;
  /** Everything in the body font, whatever the two above say. The language and its caption stay. */
  forceReadable: boolean;
}
