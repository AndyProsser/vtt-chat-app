import { Theme } from '@radix-ui/themes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Member, TableCard } from '../types/index.js';
import { ChatCard } from './ChatCard.js';

const member = (userId: string, role: 'dm' | 'player'): Member =>
  ({ userId, displayName: userId, role, online: true }) as unknown as Member;
const MEMBERS = [member('dm', 'dm'), member('p1', 'player'), member('p2', 'player')];
const coin = (over: Partial<TableCard> = {}): TableCard => ({
  id: 'loot:c1',
  kind: 'loot',
  title: 'gp',
  quantity: 40,
  coin: true,
  after: null,
  ...over,
});
const html = (card: TableCard, selfId: string) =>
  renderToStaticMarkup(
    <Theme>
      <ChatCard card={card} members={MEMBERS} selfId={selfId} />
    </Theme>,
  );

describe('a coin card in chat', () => {
  it('offers to split an unclaimed pile of coin, as the inventory does', () => {
    expect(html(coin(), 'p1')).toContain('Split the coin equally');
    expect(html(coin(), 'dm')).toContain('Split the coin equally');
  });
  it('does not once someone holds it, and not for an item that is not coin', () => {
    expect(html(coin({ claimedBy: 'p2', claimedFor: 'self' }), 'p1')).not.toContain(
      'Split the coin',
    );
    expect(html(coin({ coin: false, title: 'Rope' }), 'p1')).not.toContain('Split the coin');
  });
});
