import { createRoot } from 'react-dom/client';

import { OverlayRoot } from './components/OverlayRoot.js';
import overlayStyles from './styles/theme.css?inline';

const HOST_ELEMENT_ID = 'vtt-chat-overlay-host';

function mount(): void {
  if (document.getElementById(HOST_ELEMENT_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ELEMENT_ID;
  document.body.appendChild(host);

  // Shadow DOM keeps DDB's page CSS from bleeding into the overlay and vice versa (CLAUDE.md §9).
  const shadowRoot = host.attachShadow({ mode: 'open' });

  const styleTag = document.createElement('style');
  styleTag.textContent = overlayStyles;
  shadowRoot.appendChild(styleTag);

  const reactRoot = document.createElement('div');
  shadowRoot.appendChild(reactRoot);

  createRoot(reactRoot).render(<OverlayRoot />);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
