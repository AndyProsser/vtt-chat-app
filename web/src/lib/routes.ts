/** Which page the static `index.html` should show for a path. Mirrors the paths the server serves it for. */
export type SiteRoute = 'landing' | 'connect' | 'download' | 'full-app' | 'join' | 'not-found';

/**
 * The server answers any unknown browser path with this same page (status 404), so the page itself has to
 * tell "a real page" from "nothing here". Anything that is not one of the known paths is not-found.
 */
export function resolveRoute(pathname: string): SiteRoute {
  const path = pathname.replace(/\/+$/, '');
  if (path === '') return 'landing';
  if (path === '/connect') return 'connect';
  if (path === '/download') return 'download';
  if (path === '/full-app') return 'full-app';
  if (path === '/join' || path.startsWith('/join/')) return 'join';
  return 'not-found';
}
