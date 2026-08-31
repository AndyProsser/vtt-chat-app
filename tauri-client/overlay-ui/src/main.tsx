import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { OverlayRoot } from './components/OverlayRoot.js';
import { cornerStyle, getCorner } from './lib/corner.js';
import { ShadowPortalContainerProvider } from './lib/shadowRootContext.js';
import overlayStyles from './styles/theme.css?inline';
import radixComponents from '@radix-ui/themes/components.css?inline';
import radixTokens from '@radix-ui/themes/tokens.css?inline';

const HOST_ELEMENT_ID = 'vtt-chat-overlay-host';

function mount(): void {
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  // Positioning lives here, on the light-DOM host, not on anything inside the Shadow DOM — see
  // the Stage 3a z-index fix this builds on. Corner is read once, here, before React ever
  // renders: it's deliberately not reactive within a window's lifetime (compact-view redesign
  // spec, "Corner Positioning") — `OverlayCornerMenu` only writes future-load state via
  // `setCorner`, it never touches this window's own DOM.
  host.setAttribute(
    'style',
    `all: initial; position: fixed !important; ${cornerStyle(getCorner())}; ` +
      'z-index: 2147483647 !important; pointer-events: none !important;',
  );
  document.body.appendChild(host);

  // Shadow DOM keeps DDB's page CSS from bleeding into the overlay and vice versa (CLAUDE.md §9).
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Radix's stylesheets have to be injected into the shadow tree directly, same as theme.css —
  // there's no document <head> to hang a <link> off inside a Shadow DOM, and Radix's CSS custom
  // properties/component styles are useless to components rendered outside the tree they're
  // attached to. Only tokens.css + components.css: this stage doesn't use Radix's Flex/Grid/Box
  // (layout.css) or style-prop utility classes (utilities.css).
  const radixStyleTag = document.createElement('style');
  radixStyleTag.textContent = radixTokens + radixComponents;
  shadowRoot.appendChild(radixStyleTag);

  const styleTag = document.createElement('style');
  styleTag.textContent = overlayStyles;
  shadowRoot.appendChild(styleTag);

  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  // Dedicated portal target, a sibling of `reactRoot` rather than reusing it: Radix's
  // `Tooltip`/`ContextMenu.Content` portal their DOM elsewhere in the tree regardless of where
  // they're declared in JSX, and giving them their own element inside the shadow root (instead
  // of the default `document.body`, which is outside the Shadow DOM entirely) keeps that portaled
  // content under the same injected stylesheets and the host's max z-index — see Critical 1.
  const portalContainer = document.createElement('div');
  shadowRoot.appendChild(portalContainer);

  createRoot(reactRoot).render(
    <Theme appearance="dark" accentColor="gray" hasBackground={false}>
      <ShadowPortalContainerProvider container={portalContainer}>
        <OverlayRoot />
      </ShadowPortalContainerProvider>
    </Theme>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
