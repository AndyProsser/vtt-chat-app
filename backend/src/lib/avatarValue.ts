/**
 * What an avatar value may be: an uploaded picture (`avatar:<id>`), a built-in emblem, or (for
 * characters, which may carry one from an import) a web address. Anything else is refused, so a value
 * can never smuggle a script URL into a client.
 */
export const AVATAR_VALUE =
  /^(https?:\/\/\S{1,2040}|emblem:[a-z0-9-]{1,30}|avatar:[0-9a-f-]{36})$/i;

/** People's own portrait: no web addresses (the app never loads from the open web). */
export const OWN_AVATAR_VALUE = /^(emblem:[a-z0-9-]{1,30}|avatar:[0-9a-f-]{36})$/i;
