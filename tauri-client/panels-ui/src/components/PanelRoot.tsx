import { Flex, Text } from '@radix-ui/themes';

import { useConnected } from '../hooks/useConnected.js';
import { usePanelBridge } from '../hooks/usePanelBridge.js';
import { MuteIcon } from './MuteIcon.js';

/** Placeholder connection panel: proves the local page → Rust core wiring until Stage 4 builds the real panels. */
export function PanelRoot() {
  usePanelBridge();
  const connected = useConnected();

  return (
    <Flex align="center" gap="3" p="3">
      <MuteIcon />
      <Text size="2">{connected ? 'Connected' : 'Not connected'}</Text>
    </Flex>
  );
}
