import { describe, expect, it } from 'vitest';

import { characterIdFromUrl, characterSheetUrl } from './characterUrl.js';
import { fetchCharacter, portraitAllowed } from './fetchCharacter.js';
import { parseCharacter } from './parseCharacter.js';

const reply = {
  success: true,
  data: {
    name: ' Thessaly Brightwater ',
    race: { fullName: 'Half-Elf', baseName: 'Half-Elf' },
    classes: [
      { level: 3, definition: { name: 'Fighter' } },
      { level: 2, definition: { name: 'Wizard' } },
    ],
    decorations: { avatarUrl: 'https://www.dndbeyond.com/avatars/1/2/abc.jpeg' },
  },
};

describe('characterIdFromUrl', () => {
  it('reads the id from a sheet address, with or without extras', () => {
    expect(characterIdFromUrl('https://www.dndbeyond.com/characters/12345678')).toBe('12345678');
    expect(characterIdFromUrl('https://dndbeyond.com/characters/12345678/builder?x=1')).toBe(
      '12345678',
    );
    expect(characterIdFromUrl('https://www.dndbeyond.com/profile/Andy/characters/99')).toBe('99');
    expect(characterIdFromUrl(' 4242 ')).toBe('4242');
  });
  it('refuses other hosts, schemes and non-digit ids', () => {
    expect(characterIdFromUrl('https://evil.example/characters/1')).toBeUndefined();
    expect(characterIdFromUrl('http://www.dndbeyond.com/characters/1')).toBeUndefined();
    expect(characterIdFromUrl('https://www.dndbeyond.com/characters/1a')).toBeUndefined();
    expect(
      characterIdFromUrl('https://www.dndbeyond.com.evil.example/characters/1'),
    ).toBeUndefined();
    expect(characterIdFromUrl('')).toBeUndefined();
  });
  it('builds the stored link', () => {
    expect(characterSheetUrl('7')).toBe('https://www.dndbeyond.com/characters/7');
  });
});

describe('parseCharacter', () => {
  it('reads name, race, a multiclass summary, total level and portrait', () => {
    expect(parseCharacter(reply)).toEqual({
      name: 'Thessaly Brightwater',
      race: 'Half-Elf',
      className: 'Fighter 3 / Wizard 2',
      level: 5,
      portraitUrl: 'https://www.dndbeyond.com/avatars/1/2/abc.jpeg',
    });
  });
  it('uses a single class name plainly and tolerates missing fields', () => {
    const one = parseCharacter({
      data: { name: 'Bo', classes: [{ level: 4, definition: { name: 'Monk' } }] },
    });
    expect(one).toEqual({ name: 'Bo', race: null, className: 'Monk', level: 4, portraitUrl: null });
  });
  it('drops non-https portraits and refuses a reply with no name', () => {
    expect(
      parseCharacter({ data: { name: 'Bo', avatarUrl: 'http://x/y.png' } })?.portraitUrl,
    ).toBeNull();
    expect(parseCharacter({ data: {} })).toBeUndefined();
    expect(parseCharacter('nope')).toBeUndefined();
  });
});

describe('fetchCharacter', () => {
  const respond = (status: number, body?: unknown) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  it('returns the parsed character', async () => {
    const out = await fetchCharacter('1', respond(200, reply));
    expect(out.ok && out.character.name).toBe('Thessaly Brightwater');
  });
  it('tells private, missing, transient and unreadable apart', async () => {
    expect(await fetchCharacter('1', respond(403))).toEqual({ ok: false, reason: 'private' });
    expect(await fetchCharacter('1', respond(404))).toEqual({ ok: false, reason: 'not_found' });
    expect(await fetchCharacter('1', respond(503))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await fetchCharacter('1', respond(200, { data: {} }))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const down = async () => {
      throw new Error('offline');
    };
    expect(await fetchCharacter('1', down)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('portraitAllowed', () => {
  it('allows only https on the listed hosts and their subdomains', () => {
    const hosts = ['dndbeyond.com', 'cursecdn.com'];
    expect(portraitAllowed('https://www.dndbeyond.com/a.png', hosts)).toBe(true);
    expect(portraitAllowed('https://media-waterdeep.cursecdn.com/a.png', hosts)).toBe(true);
    expect(portraitAllowed('https://notdndbeyond.com/a.png', hosts)).toBe(false);
    expect(portraitAllowed('http://www.dndbeyond.com/a.png', hosts)).toBe(false);
    expect(portraitAllowed('https://127.0.0.1/a.png', hosts)).toBe(false);
  });
});
