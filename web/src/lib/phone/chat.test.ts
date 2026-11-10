import { describe, expect, it } from 'vitest';

import { lineFromFrame, lineFromHistory, MAX_LINES, mergeLines, whisperPeer } from './chat.js';

const line = (id: string, at: number, over = {}) => ({
  id,
  at,
  fromId: 'a',
  fromName: 'Aria',
  toId: null,
  text: id,
  ...over,
});

describe('chat lines', () => {
  it('reads a history row', () => {
    expect(
      lineFromHistory({
        id: '1',
        senderId: 'a',
        senderName: 'Aria',
        recipientId: null,
        text: 'hi',
        at: 5,
      }),
    ).toEqual(line('1', 5, { text: 'hi' }));
  });
  it('reads a live public line and a live whisper', () => {
    expect(
      lineFromFrame({ id: '1', at: 5, text: 'hi', from: { userId: 'a', name: 'Aria' } }),
    ).toEqual(line('1', 5, { text: 'hi' }));
    expect(
      lineFromFrame({
        id: '2',
        at: 6,
        text: 'psst',
        from: { userId: 'a', name: 'Aria' },
        to: { userId: 'b', name: 'Bo' },
      })?.toId,
    ).toBe('b');
  });
  it('ignores a frame that is not a line', () => {
    expect(lineFromFrame({ id: 1 })).toBeUndefined();
    expect(lineFromFrame(null)).toBeUndefined();
    expect(lineFromFrame({ id: 'x', at: 1, text: 2 })).toBeUndefined();
  });
  it('keeps one copy of a line that arrives twice, oldest first', () => {
    const merged = mergeLines([line('2', 20), line('1', 10)], [line('2', 20), line('3', 30)]);
    expect(merged.map((l) => l.id)).toEqual(['1', '2', '3']);
  });
  it('keeps only the newest lines when there are too many', () => {
    const many = Array.from({ length: MAX_LINES + 20 }, (_, i) => line(`m${i}`, i));
    const merged = mergeLines([], many);
    expect(merged).toHaveLength(MAX_LINES);
    expect(merged[0]?.id).toBe('m20');
  });
  it('names the other person in a whisper, from either side', () => {
    const w = line('w', 1, { fromId: 'a', toId: 'b' });
    expect(whisperPeer(w, 'a')).toBe('b');
    expect(whisperPeer(w, 'b')).toBe('a');
    expect(whisperPeer(line('p', 1), 'a')).toBeNull();
  });
});
