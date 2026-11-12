import type { VersionCheck } from './tauriBridge.js';

/** The warning to show for a check, or `undefined` when the versions fit (patch drift is fine). */
export function versionWarning(check: VersionCheck | undefined): string | undefined {
  if (!check?.serverVersion) return undefined;
  // Show the plain MAJOR.MINOR.PATCH: a "-dev.N" suffix is noise in a sentence.
  const app = check.appVersion.split(/[-+]/)[0];
  const server = check.serverVersion.split(/[-+]/)[0];
  if (check.relation === 'appOlder') {
    return `This app (${app}) is older than your server (${server}). Update the app to keep everything working.`;
  }
  if (check.relation === 'appNewer') {
    return `This app (${app}) is newer than your server (${server}). Ask your DM to update the server.`;
  }
  return undefined;
}

/** What to show when the server refused this app's protocol on the live connection (`update_required`). */
export const INCOMPATIBLE_WARNING =
  'Your server and this app speak different versions, so live updates are off. Update the app to reconnect.';
