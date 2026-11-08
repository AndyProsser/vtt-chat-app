import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { AvatarRail } from './AvatarRail.js';
import { ChatView } from './ChatView.js';
import { BottomBar } from './BottomBar.js';
import { EffectsStrip } from './EffectsStrip.js';
import { TopBar } from './TopBar.js';
import { UpdateBanner } from './UpdateBanner.js';

/** The one window used during play. Remaining slots are filled by the following tasks. */
export function MainWindow() {
  usePanelBridge();
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const [drawer, setDrawer] = useState(false);
  return (
    <div className="vtt-main">
      <TopBar dm={dm} />
      <UpdateBanner />
      <div className="vtt-body">
        <AvatarRail />
        <div className="vtt-chat-col">
          {dm && drawer && (
            <aside className="vtt-drawer" aria-label="Sound effects">
              <EffectsStrip />
            </aside>
          )}
          <ChatView selfId={status?.userId ?? null} />
        </div>
      </div>
      <BottomBar
        selfId={status?.userId ?? null}
        role={dm ? 'dm' : 'player'}
        drawerOpen={drawer}
        onToggleDrawer={() => setDrawer((d) => !d)}
      />
    </div>
  );
}
