import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StorytellerPicker } from './StorytellerPicker.js';

const render = (offered: string[], chosen: string) =>
  renderToStaticMarkup(
    createElement(StorytellerPicker, { offered, chosen, busy: false, onPick: () => undefined }),
  );

describe('StorytellerPicker', () => {
  it('lists the storytellers this server offers, and marks the chosen one', () => {
    const html = render(['tavern', 'dry', 'sarcastic'], 'dry');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it('does not list a storyteller the operator turned off', () => {
    const html = render(['tavern', 'dry'], 'tavern');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
  });

  it('shows each storyteller’s name and what they are like', () => {
    const html = render(['tavern'], 'tavern');
    expect(html).toContain('The Tavern Bard');
    expect(html).toContain('phone-bard-option');
  });

  it('is a labelled group, for assistive technology', () => {
    expect(render(['tavern'], 'tavern')).toContain('role="radiogroup"');
  });
});
