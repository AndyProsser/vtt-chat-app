import { describe, expect, it } from 'vitest';

import type { VersionCheck } from './tauriBridge.js';
import { versionWarning } from './versionWarning.js';

const check = (
  relation: VersionCheck['relation'],
  app = '0.3.2',
  server: string | null = '0.4.0-dev.1',
): VersionCheck => ({
  appVersion: app,
  serverVersion: server,
  relation,
});

describe('versionWarning', () => {
  it('warns when the app is older, naming plain versions', () => {
    expect(versionWarning(check('appOlder'))).toBe(
      'This app (0.3.2) is older than your server (0.4.0). Update the app to keep everything working.',
    );
  });
  it('tells the player to ask the DM when the app is newer', () => {
    expect(versionWarning(check('appNewer', '0.5.0', '0.4.0'))).toBe(
      'This app (0.5.0) is newer than your server (0.4.0). Ask your DM to update the server.',
    );
  });
  it.each(['match', 'patchDiffers', 'unknown'] as const)('is quiet for %s', (r) => {
    expect(versionWarning(check(r))).toBeUndefined();
  });
  it('is quiet before the first check and with no server version', () => {
    expect(versionWarning(undefined)).toBeUndefined();
    expect(versionWarning(check('appOlder', '0.3.2', null))).toBeUndefined();
  });
});
