// The web fonts the language styles use (`LANGUAGE_STYLE_CSS` in shared/). Each import only declares an
// `@font-face`; the browser downloads a font file the first time a line in that style is actually shown, so a
// table that never uses `/say-goblin` never fetches the Goblin font. Files are bundled with the app (nothing is
// loaded from the internet) and are SIL Open Font Licence fonts packaged by Fontsource.
import '@fontsource/cormorant-garamond/latin-500-italic.css';
import '@fontsource/alfa-slab-one/latin-400.css';
import '@fontsource/pirata-one/latin-400.css';
import '@fontsource/fredoka/latin-500.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/cinzel-decorative/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
