import { useEffect, useState } from 'react';

import type { SummaryView } from '../lib/history.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';

/** The summaries one recorded session has that this person may read (the server decides), or why they could not be loaded. */
export function useRecordingSummaries(id: string | undefined): {
  summaries: SummaryView[] | undefined;
  error: string | undefined;
} {
  const [summaries, setSummaries] = useState<SummaryView[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setSummaries(undefined);
    setError(undefined);
    campaignApi<{ summaries: SummaryView[] }>('GET', `recordings/${id}`)
      .then((d) => !cancelled && setSummaries(d.summaries))
      .catch((e) => !cancelled && setError(accountErrorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { summaries, error };
}
