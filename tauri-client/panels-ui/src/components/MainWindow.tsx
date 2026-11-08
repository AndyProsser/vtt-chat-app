import { Box, Text } from '@radix-ui/themes';

import { useAccount } from '../hooks/useAccount.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { useTableFeed } from '../hooks/useTableFeed.js';
import { isDm } from '../lib/tableModel.js';
import { useTableStore } from '../lib/tableStore.js';
import { TopBar } from './TopBar.js';

const slot = (label: string) => (
  <Box p="2" style={{ border: '1px dashed var(--vtt-edge)' }}>
    <Text size="1">{label}</Text>
  </Box>
);

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
        <Box style={{ width: 56 }}>{slot('rail')}</Box>
        <Box flexGrow="1">{slot('chat')}</Box>
      </div>
      {slot('bottom bar')}
    </div>
  );
}
