import { IconButton, Tooltip } from '@radix-ui/themes';
import { memo } from 'react';

import { useExpandStore } from '../lib/expandStore.js';

/**
 * The compact view's dedicated expand affordance (and the expanded view's collapse affordance
 * — same control, same store, opposite label/glyph depending on current state). Deliberately
 * not click-anywhere-on-the-panel: this is used often enough to deserve its own target, per
 * the compact-view redesign spec's "Expand / Collapse" section.
 */
export const ExpandToggle = memo(function ExpandToggle() {
  const expanded = useExpandStore((state) => state.expanded);
  const toggle = useExpandStore((state) => state.toggle);

  return (
    <Tooltip content={expanded ? 'Collapse' : 'Expand'}>
      <IconButton type="button" size="1" variant="ghost" onClick={toggle}>
        <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </IconButton>
    </Tooltip>
  );
});
