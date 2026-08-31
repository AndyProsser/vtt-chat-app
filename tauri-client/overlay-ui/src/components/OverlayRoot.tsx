import { useOverlayBridge } from '../hooks/useOverlayBridge.js';
import { useOverlayVisible } from '../hooks/useOverlayVisible.js';
import { useExpandStore } from '../lib/expandStore.js';
import { CompactPanel } from './CompactPanel.js';
import { ExpandedPanel } from './ExpandedPanel.js';
import { OverlayCornerMenu } from './OverlayCornerMenu.js';

export function OverlayRoot() {
  // Called before the visibility check on purpose: the bridge owns the Tauri event listeners,
  // including the `overlay:toggle` one that makes the overlay visible again. Unmounting it while
  // hidden would leave nothing listening for the key that brings it back — and would tear down
  // the LiveKit session wiring along with it.
  useOverlayBridge();
  const visible = useOverlayVisible();
  const expanded = useExpandStore((state) => state.expanded);

  if (!visible) return null;

  return (
    <OverlayCornerMenu>
      <div className="vtt-overlay">{expanded ? <ExpandedPanel /> : <CompactPanel />}</div>
    </OverlayCornerMenu>
  );
}
