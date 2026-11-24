// One font file per in-world language (see LANGUAGE_FONTS). Each import only declares an `@font-face`: a browser
// downloads a file the first time a line in that language is shown, so a table that never speaks Goblin never
// fetches the Goblin font. Bundled with each client (nothing is loaded from the internet); SIL Open Font Licence
// 1.1, packaged by Fontsource. Elvish (Cormorant Garamond italic) and Thieves' cant (Inter) come from `core.ts`.
import '@fontsource/alegreya-sc/latin-500.css';
import '@fontsource/uncial-antiqua/latin-400.css';
import '@fontsource/im-fell-english/latin-400.css';
import '@fontsource/alegreya-sans-sc/latin-700.css';
import '@fontsource/cinzel-decorative/latin-700.css';
import '@fontsource/im-fell-dw-pica/latin-400.css';
import '@fontsource/black-ops-one/latin-400.css';
import '@fontsource/metamorphous/latin-400.css';
import '@fontsource/julius-sans-one/latin-400.css';
import '@fontsource/philosopher/latin-400.css';
import '@fontsource/special-elite/latin-400.css';
import '@fontsource/patrick-hand/latin-400.css';
import '@fontsource/pirata-one/latin-400.css';
import '@fontsource/spirax/latin-400.css';
import '@fontsource/merienda/latin-400.css';
