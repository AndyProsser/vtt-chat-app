import { useAccount } from '../hooks/useAccount.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { AvatarRail } from './AvatarRail.js';
import { ChatView } from './ChatView.js';
import { Composer } from './Composer.js';
import { TopBar } from './TopBar.js';

/** The one window used during play. Remaining slots are filled by the following tasks. */
export function MainWindow() {
  usePanelBridge();
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  return (
    <div className="vtt-main">
      <TopBar dm={dm} />
      <div className="vtt-body">
        <AvatarRail />
        <ChatView selfId={status?.userId ?? null} />
      </div>
      <footer className="vtt-bottom">
        <Composer selfId={status?.userId ?? null} role={dm ? 'dm' : 'player'} />
      </footer>
    </div>
  );
}
