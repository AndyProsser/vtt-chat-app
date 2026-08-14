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
  // Positioning lives here, on the light-DOM host, not on anything inside the Shadow DOM.
  // `.vtt-overlay` (styles/theme.css) used to carry `position: fixed` + this same z-index, but
  // that stacking context gets evaluated relative to wherever the host element sits in DDB's
  // own page — confirmed live 2026-08-14 that DDB's own header/breadcrumb bar still painted
  // over it despite z-index already being maxed out (2147483647, the ceiling for a CSS z-index;
  // there's no higher number to "bump" to). Setting it directly on the host, with `!important`
  // as defense against any DDB page rule that happens to target bare `div`s, is the standard
  // fix for injected overlays: it establishes the fixed-position stacking context at the
  // topmost point in the light DOM instead of several shadow-tree levels down.
  host.setAttribute(
    'style',
    'all: initial; position: fixed !important; top: 0 !important; left: 0 !important; ' +
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
