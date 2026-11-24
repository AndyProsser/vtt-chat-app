import type { SenseKind } from '@vtt-chat-app/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Icon } from '../components/Icon.js';
import { ICON, SENSE_ICON, VITAL_ICON } from './icons.js';
import { SenseIcon, VitalIcon } from '../components/Icon.js';

const SENSES: SenseKind[] = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];

describe('the shared icon vocabulary', () => {
  it('gives every special sense an icon', () => {
    for (const kind of SENSES) expect(SENSE_ICON[kind], kind).toBeDefined();
  });

  it('gives armour class, hit points and passive perception their icons', () => {
    expect(Object.keys(VITAL_ICON).sort()).toEqual(['ac', 'hp', 'pp']);
    expect(VITAL_ICON.ac).toBe(ICON.shield);
    expect(VITAL_ICON.hp).toBe(ICON.heart);
    expect(VITAL_ICON.pp).toBe(ICON.eye);
  });

  it('maps every name to a drawable component', () => {
    for (const [name, Component] of Object.entries(ICON)) {
      const html = renderToStaticMarkup(createElement(Component, { size: 20 }));
      expect(html, name).toContain('<svg');
    }
  });

  it('keeps the meanings the desktop app already uses', () => {
    expect(SENSE_ICON.darkvision).toBe(ICON.moon);
    expect(SENSE_ICON.truesight).toBe(ICON.scanEye);
    expect(ICON.handouts.displayName).toBe('FileText');
    expect(ICON.history.displayName).toBe('ScrollText');
    expect(ICON.sessions.displayName).toBe('CalendarClock');
  });
});

describe('<Icon>', () => {
  it('draws the named icon at the given size, hidden from assistive technology', () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: 'check', size: 14 }));
    expect(html).toContain('width="14"');
    expect(html).toContain('aria-hidden="true"');
  });

  it('defaults to 18 pixels', () => {
    expect(renderToStaticMarkup(createElement(Icon, { name: 'plus' }))).toContain('width="18"');
  });
});

describe('<SenseIcon> and <VitalIcon>', () => {
  it('draw the sense icon for a kind', () => {
    const html = renderToStaticMarkup(createElement(SenseIcon, { kind: 'darkvision', size: 12 }));
    expect(html).toContain('lucide-moon');
    expect(html).toContain('width="12"');
  });

  it('draw the vital icon for ac, hp and pp', () => {
    const cls = (vital: string) =>
      renderToStaticMarkup(createElement(VitalIcon, { vital, size: 16 }));
    expect(cls('ac')).toContain('lucide-shield');
    expect(cls('hp')).toContain('lucide-heart');
    expect(cls('pp')).toContain('lucide-eye');
  });

  it('fall back to the shield for a vital this build does not know', () => {
    const html = renderToStaticMarkup(createElement(VitalIcon, { vital: 'xp', size: 16 }));
    expect(html).toContain('lucide-shield');
  });
});
