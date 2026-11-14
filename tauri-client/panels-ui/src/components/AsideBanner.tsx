import { Lock } from 'lucide-react';

import { asideInfo, asideText } from '../lib/aside.js';
import { useTableStore } from '../lib/tableStore.js';
import { syncCommand } from '../lib/tauriBridge.js';

/**
 * Shown to the whole table while the DM talks privately with one player, so nobody wonders why the DM went quiet:
 * the DM and that player see their own side, everyone else sees who is being spoken to. The DM gets the button that ends it.
 */
export function AsideBanner({ selfId }: { selfId: string | null }) {
  const view = useTableStore((s) => s.parties);
  const members = useTableStore((s) => s.members);
  const info = asideInfo(view, members, selfId);
  if (!info) return null;
  const { title, detail } = asideText(info);
  return (
    <div className="vtt-aside" role="status" data-role={info.role}>
      <Lock size={14} aria-hidden />
      <span className="vtt-aside-text">
        <strong>{title}</strong> <span>{detail}</span>
      </span>
      {info.role === 'dm' && (
        <button
          type="button"
          className="vtt-pill"
          onClick={() => void syncCommand('party.aside', { userId: null }).catch(() => undefined)}
        >
          End
        </button>
      )}
    </div>
  );
}
