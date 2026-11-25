import { Theme } from '@radix-ui/themes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LootActions } from './LootActions.js';

const dmView = (inChat: boolean) =>
  renderToStaticMarkup(
    <Theme>
      <LootActions
        item={{ id: 'l1', claimedBy: null }}
        selfId="dm"
        dm
        players={[]}
        inChat={inChat}
      />
    </Theme>,
  );

describe('LootActions', () => {
  it('offers the DM "post it again" on the inventory screen', () => {
    expect(dmView(false)).toContain('Post it in the chat again');
  });
  it('leaves it off the card in chat, where the card itself is the post', () => {
    expect(dmView(true)).not.toContain('Post it in the chat again');
  });
});
