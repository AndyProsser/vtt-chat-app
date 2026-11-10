import { TextField } from '@radix-ui/themes';
import { Check, ChevronDown, ChevronRight, Plus, Save, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import { EMBLEMS, avatarValue, emblemOf, emblemValue } from '../../lib/avatars.js';
import {
  abilityLine,
  blankDraft,
  characterPatch,
  draftOf,
  vitalsLine,
  type CharacterDraft,
  type CharacterRecord,
} from '../../lib/characters.js';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi } from '../../lib/tauriBridge.js';
import { DdbLink } from './DdbLink.js';
import { PictureButton } from '../PictureButton.js';
import { EmblemIcon, Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';

/**
 * Your character in THIS campaign. Every campaign keeps its own profile (name, race, class, level,
 * emblem), so being Aria in one table and Corwin in another is just two profiles. The table sees the
 * one marked as playing.
 */
export function CharacterSection() {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const me = members.find((m) => m.userId === status?.userId);
  const { data, error, reload } = useCampaignQuery<{ characters: CharacterRecord[] }>(
    'characters',
    [],
  );
  const [actionError, setActionError] = useState<string>();
  const [adding, setAdding] = useState(false);

  async function run(call: () => Promise<unknown>) {
    try {
      setActionError(undefined);
      await call();
      reload();
    } catch (e) {
      setActionError(accountErrorMessage(e));
    }
  }

  const campaign = status?.campaigns.find((c) => c.id === status.campaignId);
  if (!campaign) return <span className="vtt-muted">Choose a campaign first.</span>;
  const characters = data?.characters ?? [];
  const activeName = me?.character?.name;

  return (
    <div className="vtt-sessions">
      <span className="vtt-muted">
        Your character in <b>{campaign.name}</b>. Other campaigns have their own.
        {dm && ' As the DM you do not play a character here; yours are kept for if you swap back.'}
      </span>
      {(error ?? actionError) && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error ?? actionError}
        </div>
      )}
      {data && characters.length === 0 && !adding && (
        <span className="vtt-muted">No character yet.</span>
      )}
      {characters.map((c) => (
        <CharacterCard
          key={c.id}
          record={c}
          playerName={status?.displayName ?? ''}
          playing={!dm && c.name === activeName}
          canPlay={!dm}
          onSave={(patch) => run(() => campaignApi('PATCH', `characters/${c.id}`, patch))}
          onPlay={() => run(() => campaignApi('PUT', 'active-character', { characterId: c.id }))}
          onLinkChanged={reload}
        />
      ))}
      {adding ? (
        <NewCharacter
          onCreate={(draft) =>
            run(async () => {
              await campaignApi('POST', 'characters', {
                name: draft.name.trim(),
                className: draft.className.trim() || null,
                race: draft.race.trim() || null,
                level: /^\d+$/.test(draft.level) ? Number(draft.level) : null,
                avatarUrl: draft.avatarUrl,
              });
              setAdding(false);
            })
          }
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div>
          <ToolButton label="Add a character" text="New" onClick={() => setAdding(true)}>
            <Plus size={14} />
          </ToolButton>
        </div>
      )}
    </div>
  );
}

function Fields({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (d: CharacterDraft) => void;
}) {
  const set = (patch: Partial<CharacterDraft>) => onChange({ ...draft, ...patch });
  const picked = emblemOf(draft.avatarUrl);
  return (
    <>
      <div className="vtt-form-row">
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 120 }}
          aria-label="Name"
          placeholder="Name"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
        <TextField.Root
          size="1"
          style={{ width: 60 }}
          aria-label="Level"
          placeholder="Lvl"
          inputMode="numeric"
          value={draft.level}
          onChange={(e) => set({ level: e.target.value })}
        />
      </div>
      <div className="vtt-form-row">
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 90 }}
          aria-label="Race"
          placeholder="Race"
          value={draft.race}
          onChange={(e) => set({ race: e.target.value })}
        />
        <TextField.Root
          size="1"
          style={{ flex: 1, minWidth: 90 }}
          aria-label="Class"
          placeholder="Class"
          value={draft.className}
          onChange={(e) => set({ className: e.target.value })}
        />
      </div>
      <div className="vtt-form-row">
        <PictureButton onPicked={(id) => set({ avatarUrl: avatarValue(id) })} />
        <span className="vtt-muted">or choose an emblem:</span>
      </div>
      <div className="vtt-form-row" role="radiogroup" aria-label="Emblem">
        {EMBLEMS.map((name) => {
          const Icon = EmblemIcon[name];
          return (
            <ToolButton
              key={name}
              label={name}
              square
              pressed={picked === name}
              onClick={() => set({ avatarUrl: picked === name ? null : emblemValue(name) })}
            >
              <Icon size={14} />
            </ToolButton>
          );
        })}
      </div>
    </>
  );
}

function CharacterCard({
  record,
  playerName,
  playing,
  canPlay,
  onSave,
  onPlay,
  onLinkChanged,
}: {
  record: CharacterRecord;
  playerName: string;
  playing: boolean;
  canPlay: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onPlay: () => Promise<void>;
  onLinkChanged: () => void;
}) {
  const [draft, setDraft] = useState(draftOf(record));
  const [open, setOpen] = useState(false);
  useEffect(() => setDraft(draftOf(record)), [record]);
  const patch = characterPatch(record, draft);
  const dirty = Object.keys(patch).length > 0;
  return (
    <section className={playing ? 'vtt-session vtt-loot-taken' : 'vtt-session'}>
      <button
        type="button"
        className="vtt-char-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="vtt-av vtt-char-av">
          <Portrait avatarUrl={record.avatarUrl} fallback={record.name.slice(0, 2).toUpperCase()} />
        </span>
        <span className="vtt-char-text">
          <b>{record.name}</b>
          <span className="vtt-muted">
            {[record.race, record.className, record.level ? `level ${record.level}` : null]
              .filter(Boolean)
              .join(' · ') || 'No details yet'}
          </span>
          <span className="vtt-muted">Played by {playerName || 'you'}</span>
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && vitalsLine(record.sheet) && (
        <span
          className="vtt-muted"
          title="Worked out from your D&D Beyond sheet; check it there for unusual builds"
        >
          {vitalsLine(record.sheet)}
          <br />
          {abilityLine(record.sheet)}
        </span>
      )}
      {open && <Fields draft={draft} onChange={setDraft} />}
      {open && (
        <DdbLink
          characterId={record.id}
          sourceUrl={record.sourceUrl}
          syncedAt={record.syncedAt}
          onChanged={onLinkChanged}
        />
      )}
      <div className="vtt-form-row">
        {open && (
          <ToolButton
            label="Save changes"
            disabled={!dirty || draft.name.trim() === ''}
            onClick={() => void onSave(patch)}
          >
            <Save size={14} />
          </ToolButton>
        )}
        {canPlay && (
          <ToolButton
            label={playing ? 'You are playing this character' : 'Play this character at the table'}
            pressed={playing}
            disabled={playing}
            onClick={() => void onPlay()}
          >
            {playing ? <Check size={14} /> : <UserRound size={14} />}
          </ToolButton>
        )}
      </div>
    </section>
  );
}

function NewCharacter({
  onCreate,
  onCancel,
}: {
  onCreate: (d: CharacterDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(blankDraft());
  return (
    <section className="vtt-session">
      <Fields draft={draft} onChange={setDraft} />
      <div className="vtt-form-row">
        <ToolButton
          label="Create the character"
          disabled={draft.name.trim() === ''}
          onClick={() => void onCreate(draft)}
        >
          <Check size={14} />
        </ToolButton>
        <ToolButton label="Cancel" onClick={onCancel}>
          ×
        </ToolButton>
      </div>
    </section>
  );
}
