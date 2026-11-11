import { Button, Flex, Link, Text } from '@radix-ui/themes';

import { PLATFORM_LABELS } from '../consts/index.js';
import { detectPlatform } from '../lib/platform.js';
import type { Downloads } from '../types/index.js';

/** Whether the server offers any installer at all. */
export const hasDownloads = (d: Downloads): boolean =>
  (Object.keys(PLATFORM_LABELS) as (keyof typeof PLATFORM_LABELS)[]).some((p) => d[p]);

/**
 * Download buttons: a primary one for the visitor's own OS, the rest as links, and the other Linux
 * formats as a one-line note. Renders nothing when the server has no downloads to offer.
 */
export function DownloadLinks({ downloads }: { downloads: Downloads }) {
  const detected = detectPlatform(navigator.userAgent);
  const primary = detected !== 'other' && downloads[detected] ? detected : undefined;
  const others = (Object.keys(PLATFORM_LABELS) as (keyof typeof PLATFORM_LABELS)[]).filter(
    (p) => downloads[p] && p !== primary,
  );
  if (!hasDownloads(downloads)) return null;

  const showLinuxFormats =
    (primary === 'linux' || others.includes('linux')) && (downloads.linuxDeb || downloads.linuxRpm);

  return (
    <Flex direction="column" gap="2" align="start">
      {primary && (
        <Button asChild size="3">
          <a href={downloads[primary]}>Download for {PLATFORM_LABELS[primary]}</a>
        </Button>
      )}
      {others.length > 0 && (
        <Text size="2" color="gray">
          {primary ? 'Other platforms: ' : 'Download for: '}
          {others.map((p, i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <Link href={downloads[p]}>{PLATFORM_LABELS[p]}</Link>
            </span>
          ))}
        </Text>
      )}
      {showLinuxFormats && (
        <Text size="1" color="gray">
          Linux: {downloads.linux && <Link href={downloads.linux}>AppImage</Link>}
          {downloads.linuxDeb && (
            <>
              {downloads.linux && ' / '}
              <Link href={downloads.linuxDeb}>.deb</Link>
            </>
          )}
          {downloads.linuxRpm && (
            <>
              {' / '}
              <Link href={downloads.linuxRpm}>.rpm</Link>
            </>
          )}
        </Text>
      )}
    </Flex>
  );
}
