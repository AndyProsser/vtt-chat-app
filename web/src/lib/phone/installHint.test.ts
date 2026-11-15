import { describe, expect, it } from 'vitest';

import { installHintKind } from './installHint.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64)';

describe('installHintKind', () => {
  it('tells an iPhone, and an iPad that calls itself a Mac, to use Share', () => {
    expect(installHintKind(IPHONE, 5, false)).toBe('ios');
    expect(installHintKind(IPAD_AS_MAC, 5, false)).toBe('ios');
  });

  it('tells Android to use the browser menu', () => {
    expect(installHintKind(ANDROID, 5, false)).toBe('android');
  });

  it('says nothing on a real Mac or a desktop, or once it is already installed', () => {
    expect(installHintKind(IPAD_AS_MAC, 0, false)).toBeUndefined();
    expect(installHintKind(DESKTOP, 0, false)).toBeUndefined();
    expect(installHintKind(IPHONE, 5, true)).toBeUndefined();
  });
});
