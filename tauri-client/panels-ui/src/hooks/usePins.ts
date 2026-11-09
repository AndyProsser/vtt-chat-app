import { useCallback, useEffect, useState } from 'react';

import { togglePin } from '../lib/stingers.js';

const key = (campaignId: string) => `vtt.stingers.${campaignId}`;

function read(campaignId: string): string[] | undefined {
  try {
    const raw = localStorage.getItem(key(campaignId));
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')
      ? (parsed as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** The DM's pinned stingers for this campaign, remembered on this machine (a convenience, not shared state). */
export function usePins(campaignId: string | null, fallback: string[]) {
  const [pins, setPins] = useState<string[] | undefined>(() =>
    campaignId ? read(campaignId) : undefined,
  );
  useEffect(() => setPins(campaignId ? read(campaignId) : undefined), [campaignId]);
  const toggle = useCallback(
    (soundId: string) => {
      setPins((current) => {
        const next = togglePin(current ?? fallback, soundId);
        try {
          if (campaignId) localStorage.setItem(key(campaignId), JSON.stringify(next));
        } catch {
          /* not remembering is acceptable */
        }
        return next;
      });
    },
    [campaignId, fallback],
  );
  return { pins: pins ?? fallback, toggle };
}
