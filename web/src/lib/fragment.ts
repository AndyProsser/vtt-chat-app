/**
 * Reads the one-time token an emailed link carries after the `#` and removes it from the address bar, so it
 * is not left in the browser's history or a screenshot. The fragment is never sent to the server, which is
 * the point of putting it there (see docs/architecture/SIGN-IN-OPTIONS.md).
 */
export function takeTokenFromHash(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): string | undefined {
  const token = new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  history.replaceState(null, '', location.pathname + location.search);
  return token && token.length <= 256 ? token : undefined;
}
