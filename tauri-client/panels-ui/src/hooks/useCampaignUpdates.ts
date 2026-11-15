import { useEffect } from 'react';

import { accountAddCampaign, onSyncEvent } from '../lib/tauriBridge.js';

/**
 * When the server says a campaign was renamed or edited (`campaign.updated`), re-reads the campaign list.
 * That also announces the change to every open window, so the name changes everywhere at once. Used by the
 * main window only: one refresh, not one per panel.
 */
export function useCampaignUpdates(): void {
  useEffect(() => {
    const unlisten = onSyncEvent((event) => {
      if (event.t === 'campaign.updated') {
        void accountAddCampaign('refresh', '').catch(() => undefined);
      }
    });
    return () => void unlisten.then((fn) => fn());
  }, []);
}
