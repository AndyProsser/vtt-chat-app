import { BackpackIcon, FileTextIcon } from '@radix-ui/react-icons';

import { panelOpen } from '../lib/tauriBridge.js';

/** Quick doors to the two windows people reach for most during play. */
export function ChatChips() {
  return (
    <div className="vtt-chips">
      <button type="button" className="vtt-pill" onClick={() => void panelOpen('handouts')}>
        <FileTextIcon /> Handouts
      </button>
      <button type="button" className="vtt-pill" onClick={() => void panelOpen('inventory')}>
        <BackpackIcon /> Party inventory
      </button>
    </div>
  );
}
