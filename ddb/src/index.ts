// Optional D&D Beyond character sync (public character sheets only). Off unless the operator enables it.
// The previous cobalt-cookie/identity code is archived in docs/archive/ddb-legacy/.
export { characterIdFromUrl, characterSheetUrl } from './lib/characterUrl.js';
export { fetchCharacter, portraitAllowed, type FetchOutcome } from './lib/fetchCharacter.js';
export { parseCharacter } from './lib/parseCharacter.js';
export { PORTRAIT_HOSTS } from './consts/index.js';
export type { DdbCharacter, FetchLike } from './types/index.js';
