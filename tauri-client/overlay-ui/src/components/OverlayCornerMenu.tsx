import { ContextMenu } from '@radix-ui/themes';
import { type ReactNode, useState } from 'react';

import { getCorner, setCorner, type Corner } from '../lib/corner.js';
import { useShadowPortalContainer } from '../lib/shadowRootContext.js';

const CORNER_LABELS: Record<Corner, string> = {
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-left': 'Bottom left',
  'bottom-right': 'Bottom right',
};

/**
 * Right-click surface for the whole overlay — currently just the corner picker. DM-only items
 * (group management, voice FX presets) land in this same menu in later plans; built here so
 * they have somewhere to go without restructuring this component again.
 *
 * The picker's own display state tracks the *pending* selection immediately (so clicking an
 * option highlights right away), independent of whether `setCorner`'s `localStorage` write
 * succeeds — per the design spec, the current window never moves anyway, only future loads do.
 */
export function OverlayCornerMenu({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Corner>(() => getCorner());
  const container = useShadowPortalContainer();

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content container={container}>
        <ContextMenu.RadioGroup
          value={selected}
          onValueChange={(value) => {
            const corner = value as Corner;
            setSelected(corner);
            setCorner(corner);
          }}
        >
          {(Object.keys(CORNER_LABELS) as Corner[]).map((corner) => (
            <ContextMenu.RadioItem key={corner} value={corner}>
              {CORNER_LABELS[corner]}
            </ContextMenu.RadioItem>
          ))}
        </ContextMenu.RadioGroup>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
