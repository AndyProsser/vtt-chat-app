import { describe, expect, it } from 'vitest';

import { missingCountries, pickNodes, serverCountry, type NodeList } from './nodes.js';

const node = (cc: string, city = 'X'): { location: [string, string, string] } => ({
  location: [cc, cc.toUpperCase(), city],
});
const ALL: NodeList = {
  'sg1.node.check-host.net': node('sg'),
  'id1.node.check-host.net': node('id'),
  'id2.node.check-host.net': node('id'),
  'us1.node.check-host.net': node('us'),
  'us2.node.check-host.net': node('us'),
  'de1.node.check-host.net': node('de'),
  'de2.node.check-host.net': node('de'),
  'gb1.node.check-host.net': node('gb'),
};
const first = () => 0;

describe('pickNodes', () => {
  it('starts with a node in the server’s own country when there is one', () => {
    const picked = pickNodes(ALL, 'de', 3, first);
    expect(picked).toHaveLength(3);
    expect(picked[0]).toMatch(/^de/);
  });

  it('starts with the nearest country that has a node when there is none at home (Australia has none)', () => {
    expect(pickNodes(ALL, 'au', 3, first)[0]).toBe('sg1.node.check-host.net');
    expect(pickNodes(ALL, 'nz', 2, first)[0]).toBe('sg1.node.check-host.net');
  });

  it('fills the rest from other countries, never the same node twice', () => {
    const picked = pickNodes(ALL, 'au', 4, first);
    expect(new Set(picked).size).toBe(4);
    const ccs = picked.map((n) => n.slice(0, 2));
    expect(new Set(ccs).size).toBe(4);
  });

  it('just picks from everywhere when the country is unknown', () => {
    expect(pickNodes(ALL, undefined, 3, first)).toHaveLength(3);
  });

  it('never returns more than exist', () => {
    expect(pickNodes(ALL, 'de', 50, first)).toHaveLength(Object.keys(ALL).length);
  });
});

describe('pickNodes: countries the operator asked for', () => {
  it('puts one node from each requested country first, before the nearest', () => {
    const picked = pickNodes(ALL, 'au', 3, first, ['gb', 'us']);
    expect(picked.slice(0, 2).map((n) => n.slice(0, 2))).toEqual(['gb', 'us']);
    expect(picked).toHaveLength(3);
  });
  it('skips a requested country with no node and still fills the count', () => {
    const picked = pickNodes(ALL, 'au', 3, first, ['nz', 'gb']);
    expect(picked[0]).toBe('gb1.node.check-host.net');
    expect(picked).toHaveLength(3);
  });
  it('can say which requested countries have no node', () => {
    expect(missingCountries(ALL, ['nz', 'gb', 'AU'])).toEqual(['nz', 'au']);
  });
});

describe('serverCountry', () => {
  const page = (body: string) =>
    (async () => new Response(`<html>${body}</html>`)) as unknown as typeof fetch;
  it('reads the two-letter country out of check-host’s IP page', async () => {
    expect(
      await serverCountry(
        '203.0.113.9',
        page(
          '<!-- Country --><tr><td>Country</td>\n<td class="break-words">\n<img class="inline flag"\nsrc="/images/flags2/au.svg" />\n<strong>Australia</strong>\n(AU)\n</td></tr><td>Region</td>',
        ),
      ),
    ).toBe('au');
  });
  it('gives nothing for a page without one, an error, or a failed request', async () => {
    expect(await serverCountry('203.0.113.9', page('<p>nothing</p>'))).toBeUndefined();
    expect(
      await serverCountry(
        '203.0.113.9',
        (async () => new Response('', { status: 500 })) as unknown as typeof fetch,
      ),
    ).toBeUndefined();
    expect(
      await serverCountry('203.0.113.9', (async () => {
        throw new Error('down');
      }) as unknown as typeof fetch),
    ).toBeUndefined();
  });
});
