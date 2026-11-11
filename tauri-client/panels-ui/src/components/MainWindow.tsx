import { useEffect, useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { useJoinFeed } from '../hooks/useJoinFeed.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { gateState } from '../lib/gate.js';
import { readMonitorPref } from '../lib/monitorPref.js';
import { soundboardMonitorSet } from '../lib/tauriBridge.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { AvatarRail } from './AvatarRail.js';
import { ChatView } from './ChatView.js';
import { BottomBar } from './BottomBar.js';
import { SoundDrawer } from './deck/SoundDrawer.js';
import { SignInGate } from './SignInGate.js';
import { TopBar } from './TopBar.js';
import { JoinNotice } from './JoinNotice.js';
import { UpdateBanner } from './UpdateBanner.js';
import { VersionBanner } from './VersionBanner.js';

/** The one window used during play. It is the sign-in screen until there is a table to show. */
export function MainWindow() {
  const { status } = useAccount();
  const gate = gateState(status);
  if (gate === 'loading') return <div className="vtt-main" aria-busy="true" />;
  if (gate !== 'ready') return <SignInGate />;
  return <Table key={status?.campaignId ?? ''} selfId={status?.userId ?? null} />;
}

function Table({ selfId }: { selfId: string | null }) {
  usePanelBridge();
  useTableFeed();
  useJoinFeed();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, selfId);
  const [drawer, setDrawer] = useState(false);
  // Tell the sound engine whether this DM wants to hear effects locally (their saved choice).
  useEffect(() => {
    void soundboardMonitorSet(readMonitorPref()).catch(() => undefined);
  }, []);
  return (
    <div className="vtt-main">
      <TopBar dm={dm} effectsOpen={drawer} onToggleEffects={() => setDrawer((d) => !d)} />
      <VersionBanner />
      <UpdateBanner />
      <JoinNotice />
      <div className="vtt-body">
        <AvatarRail dm={dm} selfId={selfId} />
        <div className="vtt-chat-col">
          {dm && drawer && (
            <aside className="vtt-drawer" aria-label="Sound effects">
              <SoundDrawer />
            </aside>
          )}
          <ChatView selfId={selfId} />
        </div>
      </div>
      <BottomBar selfId={selfId} role={dm ? 'dm' : 'player'} />
    </div>
  );
}
