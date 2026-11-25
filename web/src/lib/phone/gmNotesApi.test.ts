import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addGmNoteFile,
  deleteGmNoteFile,
  gmNoteFile,
  gmNotes,
  saveGmNotes,
  updateCampaign,
} from './phoneApi.js';

const calls: { url: string; init: RequestInit }[] = [];
const reply =
  (body: unknown, status = 200) =>
  () =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
let next: () => Promise<Response>;

beforeEach(() => {
  calls.length = 0;
  next = reply({});
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return next();
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the Game Master’s notes, on the phone', () => {
  it('reads the page, with its attachments and the server’s file ceiling', async () => {
    next = reply({ body: '# Notes', updatedAt: 5, files: [], maxFileBytes: 1024 });
    const data = await gmNotes('c1');
    expect(calls[0]?.url).toBe('/api/campaigns/c1/gm/notes');
    expect(calls[0]?.init.method).toBe('GET');
    expect(data.maxFileBytes).toBe(1024);
  });

  it('saves the page as { body }', async () => {
    await saveGmNotes('c1', '# Mine');
    expect(calls[0]?.url).toBe('/api/campaigns/c1/gm/notes');
    expect(calls[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ body: '# Mine' });
  });

  it('fetches an attachment with the session cookie, as a blob, and says when it fails', async () => {
    next = () => Promise.resolve(new Response(new Blob(['x']), { status: 200 }));
    const blob = await gmNoteFile('c1', 'f1');
    expect(calls[0]?.url).toBe('/api/campaigns/c1/gm/notes/files/f1');
    expect(calls[0]?.init.credentials).toBe('same-origin');
    expect(blob.size).toBe(1);
    next = () => Promise.resolve(new Response('', { status: 404 }));
    await expect(gmNoteFile('c1', 'gone')).rejects.toThrow(/404/);
  });

  it('uploads an attachment as the file’s own bytes, named in the query', async () => {
    next = reply({ file: { id: 'f2', name: 'map one.png', kind: 'image' } }, 201);
    const file = new File(['bytes'], 'map one.png', { type: 'image/png' });
    const added = await addGmNoteFile('c1', file);
    expect(calls[0]?.url).toBe('/api/campaigns/c1/gm/notes/files?name=map%20one.png');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.body).toBe(file);
    expect((calls[0]?.init.headers as Record<string, string>)['X-VTT-Client']).toBe('web');
    expect(added.id).toBe('f2');
  });

  it('turns a refused upload into the server’s own message', async () => {
    next = reply({ error: 'too_large', message: 'That file is too big.' }, 413);
    await expect(addGmNoteFile('c1', new File(['x'], 'a.png'))).rejects.toThrow(/too big/);
  });

  it('deletes an attachment', async () => {
    next = reply(undefined, 204);
    await deleteGmNoteFile('c1', 'f1');
    expect(calls[0]?.url).toBe('/api/campaigns/c1/gm/notes/files/f1');
    expect(calls[0]?.init.method).toBe('DELETE');
  });
});

describe('the storyteller, on the phone', () => {
  it('is changed by sending only the bard', async () => {
    await updateCampaign('c1', { bard: 'dry' });
    expect(calls[0]?.url).toBe('/api/campaigns/c1');
    expect(calls[0]?.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ bard: 'dry' });
  });
});
