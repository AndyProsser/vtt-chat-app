import { useCallback, useEffect, useState } from 'react';

import { togglePin } from '../lib/stingers.js';

const key = (kind: string, campaignId: string) => `vtt.${kind}.${campaignId}`;

function read(kind: string, campaignId: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(key(kind, campaignId));
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')
      ? (parsed as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** The DM's pinned stingers (or scenes: `kind`) for this campaign, remembered on this machine (a convenience, not shared state). */
export function usePins(campaignId: string | null, fallback: string[], kind = 'stingers') {
  const [pins, setPins] = useState<string[] | undefined>(() =>
    campaignId ? read(kind, campaignId) : undefined,
  );
  useEffect(() => setPins(campaignId ? read(kind, campaignId) : undefined), [campaignId, kind]);
  const toggle = useCallback(
    (soundId: string) => {
      setPins((current) => {
        const next = togglePin(current ?? fallback, soundId);
        try {
          if (campaignId) localStorage.setItem(key(kind, campaignId), JSON.stringify(next));
        } catch {
          /* not remembering is acceptable */
        }
        return next;
      });
    },
    [campaignId, fallback, kind],
  );
  return { pins: pins ?? fallback, toggle };
}
