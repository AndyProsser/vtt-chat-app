import { describe, expect, it } from 'vitest';

import { appLink, codeFromPath, detectPlatform } from './platform.js';

describe('detectPlatform', () => {
  it('recognises desktop platforms and treats phones as other', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macos');
    expect(detectPlatform('Mozilla/5.0 (X11; Ubuntu; Linux x86_64)')).toBe('linux');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('other');
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('other');
  });
});

describe('codeFromPath', () => {
  it('reads the invite code from the path', () => {
    expect(codeFromPath('/join/ABCD-EFGH')).toBe('ABCD-EFGH');
    expect(codeFromPath('/join/ABCD-EFGH/')).toBe('ABCD-EFGH');
    expect(codeFromPath('/join')).toBeUndefined();
    expect(codeFromPath('/join/%E0%A4%A')).toBeUndefined();
  });
});

describe('appLink', () => {
  it('carries the server address, encoded', () => {
    expect(appLink('vtt-chat', 'https://play.example.com')).toBe(
      'vtt-chat://connect?server=https%3A%2F%2Fplay.example.com',
    );
  });
});
