import { Tabs } from '@radix-ui/themes';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import { useTableFeed } from '../../hooks/useTableFeed.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import type { GlossaryTerm, GmNotesData } from '../../types/index.js';
import { GlossaryTab } from './GlossaryTab.js';
import { NotesPage } from './NotesPage.js';

/**
 * The Game Master's window: their notes page and the campaign glossary. Both are the Game Master's alone; the
 * server refuses anyone else, and this window says so rather than showing an error to a player who somehow opens it.
 */
export function GmNotesPanel() {
  useTableFeed();
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const notes = useCampaignQuery<GmNotesData>('gm/notes', []);
  const glossary = useCampaignQuery<{ terms: GlossaryTerm[] }>('gm/glossary', []);
  if (members.length > 0 && !dm)
    return <span className="vtt-muted">The notes are the Game Master&apos;s alone.</span>;
  return (
    <Tabs.Root defaultValue="notes" className="vtt-notes-window">
      <Tabs.List size="1">
        <Tabs.Trigger value="notes">Notes</Tabs.Trigger>
        <Tabs.Trigger value="glossary">Glossary</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="notes">
        <div className="vtt-settings-page vtt-notes-page">
          {notes.error && <span className="vtt-composer-error">{notes.error}</span>}
          {!notes.data && !notes.error && <span className="vtt-muted">Loading…</span>}
          {notes.data && <NotesPage data={notes.data} reload={notes.reload} />}
        </div>
      </Tabs.Content>
      <Tabs.Content value="glossary">
        <div className="vtt-settings-page">
          {glossary.error && <span className="vtt-composer-error">{glossary.error}</span>}
          {!glossary.data && !glossary.error && <span className="vtt-muted">Loading…</span>}
          {glossary.data && <GlossaryTab terms={glossary.data.terms} reload={glossary.reload} />}
        </div>
      </Tabs.Content>
    </Tabs.Root>
  );
}
