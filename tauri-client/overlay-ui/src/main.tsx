import { Theme } from '@radix-ui/themes';
import { createRoot } from 'react-dom/client';

import { OverlayRoot } from './components/OverlayRoot.js';
import overlayStyles from './styles/theme.css?inline';
import radixComponents from '@radix-ui/themes/components.css?inline';
import radixTokens from '@radix-ui/themes/tokens.css?inline';

const HOST_ELEMENT_ID = 'vtt-chat-overlay-host';

function mount(): void {
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
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

  createRoot(reactRoot).render(
    <Theme appearance="dark" accentColor="gray" hasBackground={false}>
      <OverlayRoot />
    </Theme>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
