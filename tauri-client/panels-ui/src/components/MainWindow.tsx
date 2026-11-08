import { Box, Flex, Text } from '@radix-ui/themes';

import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { useTableFeed } from '../hooks/useTableFeed.js';

const slot = (label: string) => (
  <Box p="2" style={{ border: '1px dashed var(--vtt-edge)' }}>
    <Text size="1">{label}</Text>
  </Box>
);

/** The one window used during play. Slots are filled by the following tasks. */
export function MainWindow() {
  usePanelBridge();
  useTableFeed();
  return (
    <Flex
      direction="column"
      style={{ height: '100vh', background: 'var(--vtt-bg)', color: 'var(--vtt-ink)' }}
    >
      {slot('top bar')}
      <Flex flexGrow="1" style={{ minHeight: 0 }}>
        <Box style={{ width: 56 }}>{slot('rail')}</Box>
        <Box flexGrow="1">{slot('chat')}</Box>
      </Flex>
      {slot('bottom bar')}
    </Flex>
  );
}
