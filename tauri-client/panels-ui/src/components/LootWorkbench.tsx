import { Coins, Dices, Gem, PackagePlus, RotateCw, Search, X } from 'lucide-react';
import { useState } from 'react';

import { ITEM_TYPES, RARITIES, rarityLabel, typeLabel } from '../lib/itemStyle.js';
import {
  batchBody,
  customDraft,
  draftFromItem,
  replaceAt,
  withAssignee,
} from '../lib/lootDraft.js';
import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import type { ItemType, LootDraft, Member, Rarity, SrdItem } from '../types/index.js';
import { ItemIcon } from './ItemIcon.js';
import { PlayerSelect } from './PlayerSelect.js';
import { Dropdown } from './Dropdown.js';
import { ToolButton } from './ToolButton.js';

/**
 * The DM's loot bench. Everything is staged here first — a random roll, SRD items found by search,
 * custom items — and nothing reaches the table until "Drop all": roll again, re-roll or remove any
 * entry, add more, then drop. Random rolls use our own treasure generator (docs/architecture/LOOT.md).
 */
export function LootWorkbench({
  onDropped,
  players,
}: {
  onDropped: () => void;
  players: Member[];
}) {
  const [drafts, setDrafts] = useState<LootDraft[]>([]);
  const [cr, setCr] = useState(5);
  const [lastKind, setLastKind] = useState<'individual' | 'hoard'>('hoard');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SrdItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<ItemType | ''>('');
  const [rarityFilter, setRarityFilter] = useState<Rarity | ''>('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [coin, setCoin] = useState(false);
  const [itemType, setItemType] = useState<ItemType>('other');
  const [rarity, setRarity] = useState<Rarity | ''>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function guard(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(accountErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const roll = (kind: 'individual' | 'hoard') =>
    guard(async () => {
      setLastKind(kind);
      const r = await campaignApi<{ drafts: LootDraft[] }>('POST', 'loot/roll', { cr, kind });
      setDrafts(r.drafts);
    });

  const rerollEntry = (index: number) =>
    guard(async () => {
      const r = await campaignApi<{ draft: LootDraft }>('POST', 'loot/roll/reroll', {
        cr,
        draft: drafts[index],
      });
      setDrafts((d) => replaceAt(d, index, r.draft));
    });

  const search = () =>
    guard(async () => {
      const r = await campaignApi<{ items: SrdItem[] }>('POST', 'loot/catalog', {
        q: query || undefined,
        type: typeFilter || undefined,
        rarity: rarityFilter || undefined,
        limit: 30,
      });
      setResults(r.items);
    });

  const dropAll = () =>
    guard(async () => {
      await campaignApi('POST', 'loot/batch', batchBody(drafts));
      setDrafts([]);
      onDropped();
    });

  return (
    <section className="vtt-workbench" aria-label="Loot bench">
      <div className="vtt-form-row">
        <label className="vtt-volume" title="Challenge rating of what was defeated">
          CR
          <input
            className="vtt-input"
            style={{ width: 64 }}
            type="number"
            min={0}
            max={30}
            step={1}
            aria-label="Challenge rating"
            value={cr}
            onChange={(e) => setCr(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
          />
        </label>
        <ToolButton
          label="Roll individual treasure (coin) for this CR"
          disabled={busy}
          onClick={() => void roll('individual')}
        >
          <Coins size={15} />
        </ToolButton>
        <ToolButton
          label="Roll a treasure hoard for this CR"
          disabled={busy}
          onClick={() => void roll('hoard')}
        >
          <Gem size={15} />
        </ToolButton>
        <ToolButton
          label="Roll again (replaces the list)"
          disabled={busy}
          onClick={() => void roll(lastKind)}
        >
          <Dices size={15} />
        </ToolButton>
      </div>

      {drafts.length > 0 && (
        <div className="vtt-results" role="list" aria-label="Ready to drop">
          {drafts.map((d, i) => (
            <div key={`${d.name}-${i}`} className="vtt-result" role="listitem">
              <ItemIcon type={d.itemType} rarity={d.rarity} />
              <span style={{ flex: 1 }}>
                {d.kind === 'coin' ? `${d.quantity} ${d.name}` : d.name}
                {d.kind === 'item' && d.quantity > 1 ? ` ×${d.quantity}` : ''}
                {d.rarity ? <span className="vtt-muted"> · {rarityLabel(d.rarity)}</span> : null}
              </span>
              <PlayerSelect
                label={`Give ${d.name} to`}
                noneLabel="Pool"
                players={players}
                value={d.assignTo ?? ''}
                onChange={(userId) => setDrafts((l) => replaceAt(l, i, withAssignee(d, userId)))}
              />
              <ToolButton
                label="Re-roll this one"
                disabled={busy}
                onClick={() => void rerollEntry(i)}
              >
                <RotateCw size={13} />
              </ToolButton>
              <ToolButton
                label="Remove it from the list"
                danger
                onClick={() => setDrafts((l) => replaceAt(l, i, undefined))}
              >
                <X size={13} />
              </ToolButton>
            </div>
          ))}
        </div>
      )}

      <form
        className="vtt-form-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          className="vtt-input"
          style={{ flex: 1, minWidth: 100 }}
          aria-label="Search the SRD"
          placeholder="Search SRD items…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Dropdown
          label="Type"
          value={typeFilter}
          onChange={(v) => setTypeFilter(v as ItemType | '')}
          options={[
            { value: '', label: 'Any type' },
            ...ITEM_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
          ]}
        />
        <Dropdown
          label="Rarity"
          value={rarityFilter}
          onChange={(v) => setRarityFilter(v as Rarity | '')}
          options={[
            { value: '', label: 'Any rarity' },
            ...RARITIES.map((r) => ({ value: r, label: rarityLabel(r) })),
          ]}
        />
        <ToolButton label="Search" submit disabled={busy}>
          <Search size={14} />
        </ToolButton>
      </form>
      {results.length > 0 && (
        <div className="vtt-results" role="list" aria-label="SRD search results">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="vtt-result"
              title={item.blurb}
              onClick={() => setDrafts((d) => [...d, draftFromItem(item)])}
            >
              <ItemIcon type={item.type} rarity={item.rarity} />
              <span style={{ flex: 1 }}>{item.name}</span>
              <span className="vtt-muted">
                {item.rarity
                  ? rarityLabel(item.rarity)
                  : item.valueGp !== undefined
                    ? `${item.valueGp} gp`
                    : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <form
        className="vtt-form-row"
        onSubmit={(e) => {
          e.preventDefault();
          const draft = customDraft({ name, quantity, coin, itemType, rarity: rarity || null });
          if (!draft) return;
          setDrafts((d) => [...d, draft]);
          setName('');
        }}
      >
        <input
          className="vtt-input"
          style={{ flex: 1, minWidth: 100 }}
          aria-label={coin ? 'Currency' : 'Custom item name'}
          placeholder={coin ? 'Currency (gp, sp…)' : 'Custom item…'}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="vtt-input"
          style={{ width: 64 }}
          type="number"
          min={1}
          aria-label="Amount"
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
        <label className="vtt-volume" title="A pile of coin">
          <Coins size={14} />
          <input
            type="checkbox"
            aria-label="Coin"
            checked={coin}
            onChange={(e) => setCoin(e.target.checked)}
          />
        </label>
        {!coin && (
          <>
            <Dropdown
              label="Item type"
              value={itemType}
              onChange={(v) => setItemType(v as ItemType)}
              options={ITEM_TYPES.filter((t) => t !== 'coin').map((t) => ({
                value: t,
                label: typeLabel(t),
              }))}
            />
            <Dropdown
              label="Rarity"
              value={rarity}
              onChange={(v) => setRarity(v as Rarity | '')}
              options={[
                { value: '', label: 'Mundane' },
                ...RARITIES.map((r) => ({ value: r, label: rarityLabel(r) })),
              ]}
            />
          </>
        )}
        <ToolButton label="Add to the list" submit>
          <PackagePlus size={14} />
        </ToolButton>
      </form>

      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      <div className="vtt-form-row">
        <ToolButton
          label={`Drop ${drafts.length} into the party inventory`}
          disabled={busy || drafts.length === 0}
          text={drafts.length > 0 ? `Drop ${drafts.length}` : undefined}
          onClick={() => void dropAll()}
        >
          <PackagePlus size={14} />
        </ToolButton>
        {drafts.length > 0 && (
          <ToolButton label="Clear the list" onClick={() => setDrafts([])}>
            <X size={14} />
          </ToolButton>
        )}
      </div>
    </section>
  );
}
