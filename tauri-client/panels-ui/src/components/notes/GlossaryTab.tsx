import { Button, Select, TextField } from '@radix-ui/themes';
import {
  GLOSSARY_KIND_LABELS,
  GLOSSARY_KINDS,
  GLOSSARY_TERM_MAX,
  type GlossaryKind,
} from '@vtt-chat-app/shared';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { aliasesText, parseAliases } from '../../lib/gmNotes.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import type { GlossaryTerm } from '../../types/index.js';
import { ToolButton } from '../ToolButton.js';

/** One term's fields, for adding and for editing. */
function TermForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: GlossaryTerm;
  submitLabel: string;
  onSubmit: (value: { term: string; kind: GlossaryKind; aliases: string[] }) => Promise<void>;
  onCancel?: () => void;
}) {
  const [term, setTerm] = useState(initial?.term ?? '');
  const [kind, setKind] = useState<GlossaryKind>(initial?.kind ?? 'person');
  const [aliases, setAliases] = useState(aliasesText(initial?.aliases ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <form
      className="vtt-glossary-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (term.trim() === '') return;
        setBusy(true);
        setError(undefined);
        onSubmit({ term, kind, aliases: parseAliases(aliases) })
          .then(() => {
            if (!initial) {
              setTerm('');
              setAliases('');
            }
          })
          .catch((err) => setError(accountErrorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="vtt-form-row">
        <TextField.Root
          aria-label="Term"
          placeholder="Name, place, item or spell"
          size="1"
          style={{ flex: 1 }}
          maxLength={GLOSSARY_TERM_MAX}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Select.Root size="1" value={kind} onValueChange={(v) => setKind(v as GlossaryKind)}>
          <Select.Trigger aria-label="Kind" />
          <Select.Content>
            {GLOSSARY_KINDS.map((k) => (
              <Select.Item key={k} value={k}>
                {GLOSSARY_KIND_LABELS[k]}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </div>
      <TextField.Root
        aria-label="Other ways it is said"
        placeholder="Other ways it is said, separated by commas (nicknames, short forms)"
        size="1"
        value={aliases}
        onChange={(e) => setAliases(e.target.value)}
      />
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      <div className="vtt-form-row">
        <Button size="1" type="submit" loading={busy} disabled={term.trim() === ''}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="1" type="button" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The campaign's vocabulary: names, places, items and spells, with the other ways each is said. It is for you to
 * keep; the app will use it to hear your table's words correctly. Suggested terms wait here for you to approve.
 */
export function GlossaryTab({ terms, reload }: { terms: GlossaryTerm[]; reload: () => void }) {
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const approved = terms.filter((t) => t.status === 'approved');
  const suggested = terms.filter((t) => t.status === 'suggested');

  async function run(call: () => Promise<unknown>) {
    setError(undefined);
    try {
      await call();
      reload();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <div className="vtt-glossary">
      <span className="vtt-muted">
        The words your table uses: character names, places, items, spells. Only you can see and edit
        this list.
      </span>
      <TermForm
        submitLabel="Add"
        onSubmit={async (v) => {
          await campaignApi('POST', 'gm/glossary', v);
          reload();
        }}
      />
      {error && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error}
        </div>
      )}
      {suggested.length > 0 && (
        <section>
          <b>Suggested</b>
          {suggested.map((t) => (
            <div key={t.id} className="vtt-glossary-row">
              <span className="vtt-glossary-term">
                {t.term} <small className="vtt-muted">{GLOSSARY_KIND_LABELS[t.kind]}</small>
              </span>
              <ToolButton
                label={`Approve ${t.term}`}
                onClick={() => void run(() => campaignApi('POST', `gm/glossary/${t.id}/approve`))}
              >
                <Check size={14} />
              </ToolButton>
              <ToolButton
                label={`Dismiss ${t.term}`}
                onClick={() => void run(() => campaignApi('DELETE', `gm/glossary/${t.id}`))}
              >
                <X size={14} />
              </ToolButton>
            </div>
          ))}
        </section>
      )}
      <section>
        <b>Your terms</b>
        {approved.length === 0 && <span className="vtt-muted">Nothing here yet.</span>}
        {approved.map((t) =>
          editing === t.id ? (
            <TermForm
              key={t.id}
              initial={t}
              submitLabel="Save"
              onCancel={() => setEditing(undefined)}
              onSubmit={async (v) => {
                await campaignApi('PATCH', `gm/glossary/${t.id}`, v);
                setEditing(undefined);
                reload();
              }}
            />
          ) : (
            <div key={t.id} className="vtt-glossary-row">
              <span className="vtt-glossary-term">
                {t.term} <small className="vtt-muted">{GLOSSARY_KIND_LABELS[t.kind]}</small>
                {t.aliases.length > 0 && (
                  <small className="vtt-muted"> · also {aliasesText(t.aliases)}</small>
                )}
              </span>
              <ToolButton label={`Edit ${t.term}`} onClick={() => setEditing(t.id)}>
                <Pencil size={13} />
              </ToolButton>
              <ToolButton
                label={`Delete ${t.term}`}
                danger
                onClick={() => void run(() => campaignApi('DELETE', `gm/glossary/${t.id}`))}
              >
                <Trash2 size={13} />
              </ToolButton>
            </div>
          ),
        )}
      </section>
    </div>
  );
}
