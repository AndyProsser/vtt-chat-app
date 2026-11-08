import { useMemo, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { useCampaignQuery } from '../hooks/useCampaignQuery.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { itemLabel } from '../lib/timeline.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { LootItem } from '../types/index.js';

/**
 * The party inventory: a shared pool. The DM drops items and coin; a player grabs an item for
 * themselves or for the party, and every grab shows who took it. Coin can be split equally (by
 * default among every player, online or not). It does not touch anyone's character sheet.
 */
export function LootPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const players = useMemo(() => members.filter((m) => m.role === 'player'), [members]);
  const { data, error, reload } = useCampaignQuery<{ loot: LootItem[] }>('loot', ['loot.']);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [coin, setCoin] = useState(false);
  const [splitting, setSplitting] = useState<string>();
  const [chosen, setChosen] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string>();

  async function run(call: () => Promise<unknown>) {
    try {
      setActionError(undefined);
      await call();
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }
  const startSplit = (id: string) => {
    setSplitting(id);
    setChosen(players.map((p) => p.userId)); // default: every player, offline included
  };
  const problem = error ?? actionError;

  return (
    <div className="vtt-inventory">
      <h2 className="vtt-head">Party inventory</h2>
      {problem && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {problem}
        </div>
      )}
      {data?.loot.length === 0 && <p className="vtt-muted">Nothing in the pool yet.</p>}
      {data?.loot.map((item) => {
        const open = !item.claimedBy;
        return (
          <div key={item.id} className={open ? 'vtt-loot' : 'vtt-loot vtt-loot-taken'}>
            <div className="vtt-loot-text">
              <b>{itemLabel(item, members)}</b>
              {item.description && <span className="vtt-muted">{item.description}</span>}
            </div>
            <div className="vtt-drawer-row">
              {open && !dm && (
                <>
                  <button
                    type="button"
                    className="vtt-pill"
                    onClick={() =>
                      void run(() => campaignApi('POST', `loot/${item.id}/claim`, { for: 'self' }))
                    }
                  >
                    Take for me
                  </button>
                  <button
                    type="button"
                    className="vtt-pill"
                    onClick={() =>
                      void run(() => campaignApi('POST', `loot/${item.id}/claim`, { for: 'party' }))
                    }
                  >
                    For the party
                  </button>
                </>
              )}
              {open && item.kind === 'coin' && (
                <button type="button" className="vtt-pill" onClick={() => startSplit(item.id)}>
                  Split…
                </button>
              )}
              {dm && (
                <button
                  type="button"
                  className="vtt-pill"
                  onClick={() => void run(() => campaignApi('DELETE', `loot/${item.id}`))}
                >
                  Remove
                </button>
              )}
            </div>
            {splitting === item.id && (
              <fieldset className="vtt-split">
                <legend>
                  Split {item.quantity} {item.name} equally among
                </legend>
                {players.map((p) => (
                  <label key={p.userId}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(p.userId)}
                      onChange={(e) =>
                        setChosen((c) =>
                          e.target.checked ? [...c, p.userId] : c.filter((id) => id !== p.userId),
                        )
                      }
                    />
                    {p.character?.name ?? p.displayName}
                    {!p.online && <span className="vtt-muted"> (offline)</span>}
                  </label>
                ))}
                <div className="vtt-drawer-row">
                  <button
                    type="button"
                    className="vtt-pill"
                    disabled={chosen.length === 0}
                    onClick={() =>
                      void run(() =>
                        campaignApi('POST', `loot/${item.id}/split`, { userIds: chosen }),
                      ).then(() => setSplitting(undefined))
                    }
                  >
                    Split among {chosen.length}
                  </button>
                  <button
                    type="button"
                    className="vtt-pill"
                    onClick={() => setSplitting(undefined)}
                  >
                    Cancel
                  </button>
                </div>
              </fieldset>
            )}
          </div>
        );
      })}
      {dm && (
        <form
          className="vtt-drawer-row"
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            void run(() =>
              campaignApi('POST', 'loot', { name: n, quantity, kind: coin ? 'coin' : 'item' }),
            ).then(() => setName(''));
          }}
        >
          <input
            className="vtt-input"
            style={{ flex: 1, minWidth: 120 }}
            aria-label={coin ? 'Currency' : 'Item'}
            placeholder={coin ? 'Currency (gp, sp…)' : 'Drop an item…'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="vtt-input"
            style={{ width: 80 }}
            type="number"
            min={1}
            aria-label={coin ? 'Amount' : 'Quantity'}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          />
          <label className="vtt-volume">
            <input type="checkbox" checked={coin} onChange={(e) => setCoin(e.target.checked)} />
            Coin
          </label>
          <button type="submit" className="vtt-pill">
            Drop
          </button>
        </form>
      )}
    </div>
  );
}
