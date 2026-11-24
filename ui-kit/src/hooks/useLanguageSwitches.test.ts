// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_READING_PREFS, useReadingPrefsStore } from '../lib/readingPrefs.js';
import { useLanguageSwitches } from './useLanguageSwitches.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe = () => createElement('i', null, JSON.stringify(useLanguageSwitches()));

let host: HTMLElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useReadingPrefsStore.setState({ ...DEFAULT_READING_PREFS });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

describe('useLanguageSwitches', () => {
  it('reports language fonts on and force readable off by default', () => {
    act(() => root.render(createElement(Probe)));
    expect(JSON.parse(host.textContent ?? '')).toEqual({
      languageFonts: true,
      forceReadable: false,
    });
  });

  it('redraws when a switch is flipped', () => {
    act(() => root.render(createElement(Probe)));
    act(() => useReadingPrefsStore.getState().set({ forceReadable: true, languageFonts: false }));
    expect(JSON.parse(host.textContent ?? '')).toEqual({
      languageFonts: false,
      forceReadable: true,
    });
  });
});
