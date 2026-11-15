import { describe, expect, it } from 'vitest';

describe('parseRecordCues', () => {
  it('defaults to scene changes only, and takes lists, all and none', async () => {
    const { parseRecordCues } = await import('./config.js');
    expect([...parseRecordCues(undefined)]).toEqual(['scene']);
    expect([...parseRecordCues('')]).toEqual(['scene']);
    expect([...parseRecordCues('scene, groups')].sort()).toEqual(['groups', 'scene']);
    expect([...parseRecordCues('ALL')].sort()).toEqual(['groups', 'scene', 'sounds', 'voice']);
    expect([...parseRecordCues('none')]).toEqual([]);
    expect([...parseRecordCues('bogus')]).toEqual([]);
  });
});

describe('loadConfig mail settings', () => {
  it('needs PUBLIC_URL when SMTP_URL is set', async () => {
    const { loadConfig } = await import('./config.js');
    expect(() => loadConfig({ SMTP_URL: 'smtp://relay:25' })).toThrow(/PUBLIC_URL/);
    const both = loadConfig({ SMTP_URL: 'smtp://relay:25', PUBLIC_URL: 'https://x.test' });
    expect(both.smtp?.url).toBe('smtp://relay:25');
    expect(loadConfig({}).smtp).toBeUndefined();
  });
});
