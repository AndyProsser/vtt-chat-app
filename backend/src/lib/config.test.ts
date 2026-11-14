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
