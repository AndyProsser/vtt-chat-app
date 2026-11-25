import { Theme } from '@radix-ui/themes';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { GmNotesData } from '../../types/phone.js';
import { GmNotesView } from './GmNotesView.js';

const data = (over: Partial<GmNotesData> = {}): GmNotesData => ({
  body: '# Notes\n\n## Secrets\nThe mayor is a ghoul.\n\n## Places\nSkelling.',
  updatedAt: 1,
  maxFileBytes: 5 * 1024 * 1024,
  files: [
    {
      id: 'f1',
      name: 'harbour map.png',
      kind: 'image',
      mime: 'image/png',
      bytes: 840 * 1024,
      createdAt: 1,
    },
    {
      id: 'f2',
      name: 'cult.pdf',
      kind: 'pdf',
      mime: 'application/pdf',
      bytes: 3_400_000,
      createdAt: 2,
    },
  ],
  ...over,
});

const render = (d: GmNotesData, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(
      Theme,
      null,
      createElement(GmNotesView, {
        data: d,
        busy: false,
        onEdit: () => undefined,
        onOpenFile: () => undefined,
        onDeleteFile: () => undefined,
        onAttach: () => undefined,
        ...extra,
      }),
    ),
  );

describe('GmNotesView', () => {
  it('shows the page', () => {
    expect(render(data())).toContain('The mayor is a ghoul.');
  });

  it('lists the headings to jump to once there are two or more', () => {
    const html = render(data());
    expect(html).toContain('Jump to');
    expect(html).toContain('Secrets');
    expect(html).toContain('Places');
    expect(render(data({ body: '# Only one\ntext' }))).not.toContain('Jump to');
  });

  it('lists the attachments with their kind and size, and a way to attach another', () => {
    const html = render(data());
    expect(html).toContain('harbour map.png');
    expect(html).toContain('840 KB');
    expect(html).toContain('cult.pdf');
    expect(html).toContain('3.2 MB');
    expect(html).toContain('Attach a picture or PDF');
  });

  it('invites the Game Master to write when the page is empty', () => {
    const html = render(data({ body: '  ', files: [] }));
    expect(html).toMatch(/Nothing here yet/);
    expect(html).toMatch(/No attachments/);
  });

  it('can be edited', () => {
    expect(render(data())).toContain('Edit the notes');
  });

  it('shows why something failed', () => {
    expect(render(data(), { error: 'That file is empty.' })).toContain('That file is empty.');
  });
});
