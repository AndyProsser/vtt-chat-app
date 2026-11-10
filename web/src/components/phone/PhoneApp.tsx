import { Badge, Button, DropdownMenu, Flex, Spinner, Text } from '@radix-ui/themes';
import { useCallback, useEffect, useState } from 'react';

import { TABS } from '../../consts/phone.js';
import { useLiveChat } from '../../hooks/useLiveChat.js';
import { campaigns, logout, me } from '../../lib/phone/phoneApi.js';
import { type Tab, usePhoneStore } from '../../lib/phone/phoneStore.js';
import { saveCampaign, saveToken, savedCampaign, savedToken } from '../../lib/phone/storage.js';
import { CampaignPicker } from './CampaignPicker.js';
import { ChatTab } from './ChatTab.js';
import { HandoutsTab } from './HandoutsTab.js';
import { HistoryTab } from './HistoryTab.js';
import { SessionsTab } from './SessionsTab.js';
import { SignIn } from './SignIn.js';

type Boot = 'checking' | 'ready';

/** The phone app: sign in, choose a table, then four tabs. */
export function PhoneApp() {
  const token = usePhoneStore((s) => s.token);
  const campaignId = usePhoneStore((s) => s.campaignId);
  const list = usePhoneStore((s) => s.campaigns);
  const [boot, setBoot] = useState<Boot>('checking');
  const [error, setError] = useState<string>();

  const enter = useCallback(async (t: string, userId?: string) => {
    const store = usePhoneStore.getState();
    const id = userId ?? (await me(t)).user.id;
    saveToken(t);
    store.signedIn(t, id);
    const mine = await campaigns(t);
    store.setCampaigns(mine);
    const wanted = savedCampaign();
    const pick = mine.find((c) => c.id === wanted) ?? (mine.length === 1 ? mine[0] : undefined);
    if (pick) store.pickCampaign(pick.id);
  }, []);

  useEffect(() => {
    const saved = savedToken();
    if (!saved) {
      setBoot('ready');
      return;
    }
    enter(saved)
      .catch(() => {
        // Expired or revoked (or the server is unreachable): back to the sign-in screen.
        saveToken(undefined);
        usePhoneStore.getState().signedOut();
      })
      .finally(() => setBoot('ready'));
  }, [enter]);

  const signOut = useCallback(() => {
    const t = usePhoneStore.getState().token;
    if (t) void logout(t);
    saveToken(undefined);
    saveCampaign(undefined);
    usePhoneStore.getState().signedOut();
  }, []);

  if (boot === 'checking') {
    return (
      <Flex justify="center" p="6">
        <Spinner size="3" />
      </Flex>
    );
  }
  if (!token) {
    return (
      <SignIn
        onSignedIn={(t, userId) => {
          setError(undefined);
          enter(t, userId).catch(() => setError('Signed in, but could not load your campaigns.'));
        }}
      />
    );
  }
  if (!campaignId) {
    return (
      <>
        <CampaignPicker
          campaigns={list}
          onPick={(id) => {
            saveCampaign(id);
            usePhoneStore.getState().pickCampaign(id);
          }}
        />
        <Flex justify="center" p="3">
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </Flex>
        {error && <Text color="red">{error}</Text>}
      </>
    );
  }
  return <Shell token={token} campaignId={campaignId} onSignOut={signOut} />;
}

function Shell({
  token,
  campaignId,
  onSignOut,
}: {
  token: string;
  campaignId: string;
  onSignOut: () => void;
}) {
  const tab = usePhoneStore((s) => s.tab);
  const unread = usePhoneStore((s) => s.unread);
  const live = usePhoneStore((s) => s.live);
  const campaign = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId));
  const many = usePhoneStore((s) => s.campaigns.length > 1);
  const say = useLiveChat(token, campaignId, onSignOut);
  return (
    <div className="phone-shell">
      <header className="phone-header">
        <Flex align="center" gap="2" style={{ minWidth: 0 }}>
          <span
            className={`phone-dot phone-dot-${live}`}
            role="img"
            aria-label={live === 'live' ? 'Connected' : 'Not connected'}
          />
          <Text size="4" weight="medium" className="phone-title">
            {campaign?.name ?? 'Your table'}
          </Text>
        </Flex>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="ghost" aria-label="Menu">
              Menu
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {many && (
              <DropdownMenu.Item
                onSelect={() => {
                  saveCampaign(undefined);
                  usePhoneStore.getState().pickCampaign(undefined);
                }}
              >
                Switch table
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Item color="red" onSelect={onSignOut}>
              Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </header>
      <main className="phone-main">
        {tab === 'chat' && <ChatTab token={token} campaignId={campaignId} say={say} />}
        {tab === 'sessions' && <SessionsTab token={token} campaignId={campaignId} />}
        {tab === 'handouts' && <HandoutsTab token={token} campaignId={campaignId} />}
        {tab === 'history' && <HistoryTab token={token} campaignId={campaignId} />}
      </main>
      <nav className="phone-tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`phone-tab ${tab === t.id ? 'phone-tab-on' : ''}`}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => usePhoneStore.getState().setTab(t.id as Tab)}
          >
            {t.label}
            {t.id === 'chat' && unread > 0 && (
              <Badge color="violet" variant="solid" radius="full" ml="1">
                {unread}
              </Badge>
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
