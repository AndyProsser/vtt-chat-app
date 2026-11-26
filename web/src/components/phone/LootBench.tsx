import { Badge, Button, Callout, Flex, Select, Text, TextField } from '@radix-ui/themes';
import {
  draftFromItem,
  customDraft,
  ITEM_TYPES,
  RARITIES,
  rarityLabel,
  replaceAt,
  typeLabel,
  withAssignee,
  type ItemType,
  type LootDraft,
  type Rarity,
  type SrdItem,
} from '@vtt-chat-app/shared';
import { useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { lootBatch, lootCatalog, lootReroll, lootRoll } from '../../lib/phone/phoneApi.js';
import { playerLines } from '../../lib/phone/rail.js';
import type { Member } from '../../types/phone.js';
import { IconTool } from './IconTool.js';
import { Sheet } from './Sheet.js';

const RARITY_COLOR: Record<string, 'gray' | 'green' | 'blue' | 'violet' | 'orange' | 'red'> = {
  common: 'gray',
  uncommon: 'green',
  rare: 'blue',
  'very rare': 'violet',
  legendary: 'orange',
  artifact: 'red',
};

/** Who a staged draft goes to when dropped: the pool, or one named player. */
function AssignSelect({
  value,
  players,
  onChange,
}: {
  value: string;
  players: Member[];
  onChange: (userId: string) => void;
}) {
  if (players.length === 0) return null;
  return (
    <Select.Root
      size="1"
      value={value || 'pool'}
      onValueChange={(v) => onChange(v === 'pool' ? '' : v)}
    >
      <Select.Trigger aria-label="Give it to" variant="soft" />
      <Select.Content>
        <Select.Item value="pool">Pool</Select.Item>
        {players.map((p) => (
          <Select.Item key={p.userId} value={p.userId}>
            {playerLines(p).primary}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/**
 * The DM's loot bench, on the phone: a random roll, SRD items found by search, custom items — staged
 * here first, nothing reaches the table until "Drop all" (the same flow as the desktop app's workbench,
 * against the same server endpoints and drafting logic).
 */
export function LootBench({
  campaignId,
  players,
  onClose,
  onDropped,
}: {
  campaignId: string;
  players: Member[];
  onClose: () => void;
  onDropped: () => void;
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
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const roll = (kind: 'individual' | 'hoard') =>
    guard(async () => {
      setLastKind(kind);
      const r = await lootRoll(campaignId, cr, kind);
      setDrafts(r.drafts);
    });

  const rerollEntry = (index: number) =>
    guard(async () => {
      const r = await lootReroll(campaignId, cr, drafts[index]!);
      setDrafts((d) => replaceAt(d, index, r.draft));
    });

  const search = () =>
    guard(async () => {
      const r = await lootCatalog(campaignId, {
        ...(query ? { q: query } : {}),
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(rarityFilter ? { rarity: rarityFilter } : {}),
        limit: 30,
      });
      setResults(r.items);
    });

  const dropAll = () =>
    guard(async () => {
      await lootBatch(campaignId, drafts);
      setDrafts([]);
      onDropped();
    });

  return (
    <Sheet
      title="Add loot"
      dirty={drafts.length > 0}
      onClose={onClose}
      actions={
        <IconTool
          label={`Drop ${drafts.length} into the party inventory`}
          icon="packagePlus"
          disabled={busy || drafts.length === 0}
          onClick={() => void dropAll()}
        />
      }
    >
      <Flex direction="column" gap="3" className="phone-pad">
        <Flex gap="2" align="center" wrap="wrap">
          <Text size="2" color="gray">
            CR
          </Text>
          <TextField.Root
            size="2"
            style={{ width: 64 }}
            type="number"
            min={0}
            max={30}
            step={1}
            aria-label="Challenge rating"
            data-autofocus
            value={cr}
            onChange={(e) => setCr(Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
          />
          <IconTool
            label="Roll individual treasure (coin) for this CR"
            icon="coins"
            disabled={busy}
            onClick={() => void roll('individual')}
          />
          <IconTool
            label="Roll a treasure hoard for this CR"
            icon="gem"
            disabled={busy}
            onClick={() => void roll('hoard')}
          />
          <IconTool
            label="Roll again (replaces the list)"
            icon="dice"
            disabled={busy}
            onClick={() => void roll(lastKind)}
          />
        </Flex>

        {drafts.length > 0 && (
          <Flex direction="column" gap="2" role="list" aria-label="Ready to drop">
            {drafts.map((d, i) => (
              <Flex key={`${d.name}-${i}`} align="center" gap="2" role="listitem" wrap="wrap">
                <Text style={{ flex: 1, minWidth: 0 }}>
                  {d.kind === 'coin' ? `${d.quantity} ${d.name}` : d.name}
                  {d.kind === 'item' && d.quantity > 1 ? ` ×${d.quantity}` : ''}
                </Text>
                {d.rarity && <Badge color={RARITY_COLOR[d.rarity] ?? 'gray'}>{d.rarity}</Badge>}
                <AssignSelect
                  value={d.assignTo ?? ''}
                  players={players}
                  onChange={(userId) => setDrafts((l) => replaceAt(l, i, withAssignee(d, userId)))}
                />
                <IconTool
                  small
                  label="Re-roll this one"
                  icon="rotate"
                  disabled={busy}
                  onClick={() => void rerollEntry(i)}
                />
                <IconTool
                  small
                  label="Remove it from the list"
                  icon="x"
                  danger
                  onClick={() => setDrafts((l) => replaceAt(l, i, undefined))}
                />
              </Flex>
            ))}
          </Flex>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              size="2"
              style={{ flex: 1, minWidth: 120 }}
              aria-label="Search the SRD"
              placeholder="Search SRD items…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select.Root
              value={typeFilter || 'any'}
              onValueChange={(v) => setTypeFilter(v === 'any' ? '' : (v as ItemType))}
            >
              <Select.Trigger aria-label="Item type" variant="soft" />
              <Select.Content>
                <Select.Item value="any">Any type</Select.Item>
                {ITEM_TYPES.map((t) => (
                  <Select.Item key={t} value={t}>
                    {typeLabel(t)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <Select.Root
              value={rarityFilter || 'any'}
              onValueChange={(v) => setRarityFilter(v === 'any' ? '' : (v as Rarity))}
            >
              <Select.Trigger aria-label="Rarity" variant="soft" />
              <Select.Content>
                <Select.Item value="any">Any rarity</Select.Item>
                {RARITIES.map((r) => (
                  <Select.Item key={r} value={r}>
                    {rarityLabel(r)}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <IconTool label="Search" icon="search" submit disabled={busy} />
          </Flex>
        </form>
        {results.length > 0 && (
          <Flex direction="column" gap="1" role="list" aria-label="SRD search results">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                className="phone-card-button"
                title={item.blurb}
                onClick={() => setDrafts((d) => [...d, draftFromItem(item)])}
              >
                <Flex align="center" gap="2">
                  <Text style={{ flex: 1 }}>{item.name}</Text>
                  {item.rarity && (
                    <Badge color={RARITY_COLOR[item.rarity] ?? 'gray'}>{item.rarity}</Badge>
                  )}
                  {!item.rarity && item.valueGp !== undefined && (
                    <Text size="1" color="gray">
                      {item.valueGp} gp
                    </Text>
                  )}
                </Flex>
              </button>
            ))}
          </Flex>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const draft = customDraft({ name, quantity, coin, itemType, rarity: rarity || null });
            if (!draft) return;
            setDrafts((d) => [...d, draft]);
            setName('');
          }}
        >
          <Flex gap="2" align="center" wrap="wrap">
            <TextField.Root
              size="2"
              style={{ flex: 1, minWidth: 100 }}
              aria-label={coin ? 'Currency' : 'Custom item name'}
              placeholder={coin ? 'Currency (gp, sp…)' : 'Custom item…'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField.Root
              size="2"
              style={{ width: 64 }}
              type="number"
              min={1}
              aria-label="Amount"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
            <Button
              type="button"
              size="2"
              variant={coin ? 'solid' : 'soft'}
              onClick={() => setCoin((c) => !c)}
            >
              Coin
            </Button>
            {!coin && (
              <>
                <Select.Root value={itemType} onValueChange={(v) => setItemType(v as ItemType)}>
                  <Select.Trigger aria-label="Item type" variant="soft" />
                  <Select.Content>
                    {ITEM_TYPES.filter((t) => t !== 'coin').map((t) => (
                      <Select.Item key={t} value={t}>
                        {typeLabel(t)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                <Select.Root
                  value={rarity || 'mundane'}
                  onValueChange={(v) => setRarity(v === 'mundane' ? '' : (v as Rarity))}
                >
                  <Select.Trigger aria-label="Rarity" variant="soft" />
                  <Select.Content>
                    <Select.Item value="mundane">Mundane</Select.Item>
                    {RARITIES.map((r) => (
                      <Select.Item key={r} value={r}>
                        {rarityLabel(r)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
              </>
            )}
            <IconTool label="Add to the list" icon="packagePlus" submit />
          </Flex>
        </form>

        {error && (
          <Callout.Root color="red">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Sheet>
  );
}
