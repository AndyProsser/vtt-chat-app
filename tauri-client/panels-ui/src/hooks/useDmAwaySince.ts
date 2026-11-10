import { useEffect, useState } from 'react';

import { useTableStore } from '../lib/tableStore.js';

/**
 * When this window saw the campaign's DM go offline, or `null` while they are connected. A window that
 * opens with the DM already gone counts from the moment it opened (the server is the real gate).
 */
export function useDmAwaySince(): number | null {
  const dmOnline = useTableStore((s) => {
    const dm = s.members.find((m) => m.role === 'dm');
    return dm ? dm.online : true;
  });
  const [since, setSince] = useState<number | null>(() => (dmOnline ? null : Date.now()));
  useEffect(() => {
    setSince((previous) => (dmOnline ? null : (previous ?? Date.now())));
  }, [dmOnline]);
  return since;
}
