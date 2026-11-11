import { Badge, Button, DropdownMenu, Flex, Spinner, Text } from '@radix-ui/themes';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { Icon } from '../icons/index.js';
import { TABS } from '../../consts/phone.js';
import { useLiveChat } from '../../hooks/useLiveChat.js';
import { takeHandoffToken } from '../../lib/handoff.js';
import { appPromoHref } from '../../lib/phone/promo.js';
import { isMobile } from '../../lib/platform.js';
import { campaigns, logout, me, redeemCode } from '../../lib/phone/phoneApi.js';
import { type Tab, usePhoneStore } from '../../lib/phone/phoneStore.js';
import { forgetLegacyToken, saveCampaign, savedCampaign } from '../../lib/phone/storage.js';
import { markSignedIn, markSignedOut } from '../../lib/session.js';
import { SiteHeader } from '../SiteHeader.js';
import { CampaignPicker } from './CampaignPicker.js';
import { ChatTab } from './ChatTab.js';
import { HandoutsTab } from './HandoutsTab.js';
import { HistoryTab } from './HistoryTab.js';
import { SessionsTab } from './SessionsTab.js';
import { SignIn } from './SignIn.js';

type Boot = 'checking' | 'ready';

/** The phone app: sign in, choose a table, then four tabs. */
export function PhoneApp() {
  const authed = usePhoneStore((s) => s.authed);
  const campaignId = usePhoneStore((s) => s.campaignId);
  const list = usePhoneStore((s) => s.campaigns);
  const [boot, setBoot] = useState<Boot>('checking');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<{ userId?: string }>();

  // The session is the browser's HttpOnly cookie, already set by whichever sign-in got us here.
  const enter = useCallback(async (userId?: string) => {
    const store = usePhoneStore.getState();
    const id = userId ?? (await me()).user.id;
    store.signedIn(id);
    markSignedIn();
    const mine = await campaigns();
    store.setCampaigns(mine);
    const wanted = savedCampaign();
    const pick = mine.find((c) => c.id === wanted) ?? (mine.length === 1 ? mine[0] : undefined);
    if (pick) store.pickCampaign(pick.id);
  }, []);

  useEffect(() => {
    forgetLegacyToken();
    // Hand-off from the landing page: `/app#connect=<single-use token>`. Removed from the address bar
    // first, redeemed once, never logged or stored; the response sets the session cookie.
    const link = takeHandoffToken();
    if (link !== undefined) {
      redeemCode(link)
        .then(async (res) => {
          if (!res.signedIn) throw new Error('no session');
          const userId = res.user?.id;
          if (res.needsConsent) {
            setPending(userId ? { userId } : {});
            return;
          }
          await enter(userId).catch(() =>
            setError('Signed in, but could not load your campaigns.'),
          );
        })
        .catch(() => {
          setNotice('That sign-in link has expired or was already used. Please sign in here.');
        })
        .finally(() => setBoot('ready'));
      return;
    }
    // Returning visit: a good cookie is the normal case, so go straight in (this call also slides it).
    enter()
      .catch(() => {
        // No cookie, or it expired or was revoked (or the server is unreachable): the sign-in screen.
        usePhoneStore.getState().signedOut();
      })
      .finally(() => setBoot('ready'));
  }, [enter]);

  const signOut = useCallback(() => {
    void logout();
    markSignedOut();
    saveCampaign(undefined);
    usePhoneStore.getState().signedOut();
  }, []);

  if (boot === 'checking') {
    return (
      <Frame>
        <Flex justify="center" p="6">
          <Spinner size="3" />
        </Flex>
      </Frame>
    );
  }
  if (!authed) {
    return (
      <Frame>
        <SignIn
          {...(notice ? { notice } : {})}
          {...(pending ? { initialPending: pending } : {})}
          onSignedIn={(userId) => {
            setError(undefined);
            enter(userId).catch(() => setError('Signed in, but could not load your campaigns.'));
          }}
        />
      </Frame>
    );
  }
  if (!campaignId) {
    return (
      <Frame>
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
      </Frame>
    );
  }
  return <Shell campaignId={campaignId} onSignOut={signOut} />;
}

function Shell({ campaignId, onSignOut }: { campaignId: string; onSignOut: () => void }) {
  const tab = usePhoneStore((s) => s.tab);
  const unread = usePhoneStore((s) => s.unread);
  const live = usePhoneStore((s) => s.live);
  const campaign = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId));
  const many = usePhoneStore((s) => s.campaigns.length > 1);
  const say = useLiveChat(campaignId, onSignOut);
  return (
    <div className="phone-page phone-page-app">
      <div className="phone-shell">
        <header className="phone-header">
          <div className="phone-header-row">
            <a className="site-brand" href="/">
              <img src="/app-icon-192.png" alt="" width="36" height="36" />
              VTT Chat
            </a>
            <div className="phone-header-actions">
              <a
                className="phone-promo"
                href={appPromoHref(isMobile(navigator.userAgent, navigator.maxTouchPoints))}
                aria-label="Get the full app"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="4" width="18" height="12" rx="2" />
                  <path d="M8 20h8M12 16v4" />
                </svg>
                <span className="phone-promo-text">Get the app</span>
              </a>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <button type="button" className="phone-burger" aria-label="Menu">
                    <svg
                      viewBox="0 0 24 24"
                      width="22"
                      height="22"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M4 7h16M4 12h16M4 17h16" />
                    </svg>
                  </button>
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
                  <DropdownMenu.Item asChild>
                    <a href="/">Home</a>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <a href="/download">Download</a>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item asChild>
                    <a href="/status">Status</a>
                  </DropdownMenu.Item>
                  <DropdownMenu.Item color="red" onSelect={onSignOut}>
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          </div>
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
        </header>
        <main className="phone-main">
          {tab === 'chat' && <ChatTab campaignId={campaignId} say={say} />}
          {tab === 'sessions' && <SessionsTab campaignId={campaignId} />}
          {tab === 'handouts' && <HandoutsTab campaignId={campaignId} />}
          {tab === 'history' && <HistoryTab campaignId={campaignId} />}
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
              <span className="phone-tab-icon">
                <Icon name={t.icon} size={20} />
                {t.id === 'chat' && unread > 0 && (
                  <Badge color="violet" variant="solid" radius="full" className="phone-tab-badge">
                    {unread}
                  </Badge>
                )}
              </span>
              <span className="phone-tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** The Home-page look around the screens that come before the tabs: the shared header on the page background. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="phone-page">
      <div className="phone-top">
        <SiteHeader current="chat" />
      </div>
      <div className="phone-page-body">{children}</div>
    </div>
  );
}
