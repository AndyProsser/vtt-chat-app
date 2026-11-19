import { TextField } from '@radix-ui/themes';
import { Camera, Check, Link2, Pencil, Play, RefreshCw, Save, Unlink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useCampaignQuery } from '../../hooks/useCampaignQuery.js';
import { useDdbEnabled } from '../../hooks/useDdbEnabled.js';
import { EMBLEMS, avatarValue, emblemOf, emblemValue } from '../../lib/avatars.js';
import {
  characterDetails,
  characterPatch,
  draftOf,
  syncedLabel,
  type CharacterDraft,
  type CharacterRecord,
} from '@vtt-chat-app/shared';
import { isDm } from '../../lib/tableModel.js';
import { useTableStore } from '../../lib/tableStore.js';
import { accountErrorMessage, campaignApi, ddbAction } from '../../lib/tauriBridge.js';
import { PictureButton } from '../PictureButton.js';
import { EmblemIcon, Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';
import { CharacterStats } from './CharacterStats.js';
import { CharacterSwitcher } from './CharacterSwitcher.js';
import { DdbLinkField } from './DdbLinkField.js';
import { NewCharacter } from './NewCharacter.js';

/**
 * Your characters in THIS campaign. Every campaign keeps its own profile, so being Aria in one table and Corwin in
 * another is just two profiles (and the same D&D Beyond sheet can be added in each). A row of portraits switches
 * between them (click one to look at it); Activate, after a confirmation, makes it the one the table sees. The table sees the one marked as playing.
 */
export function CharacterSection() {
  const { status } = useAccount();
  const members = useTableStore((s) => s.members);
  const dm = isDm(members, status?.userId ?? null);
  const me = members.find((m) => m.userId === status?.userId);
  const ddbOn = useDdbEnabled();
  const { data, error, reload } = useCampaignQuery<{ characters: CharacterRecord[] }>(
    'characters',
    [],
  );
  const [actionError, setActionError] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<string>();

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
  const playingId = dm ? undefined : characters.find((c) => c.name === me?.character?.name)?.id;
  const shown = characters.find((c) => c.id === (picked ?? playingId)) ?? characters[0];

  // A click only shows a character; switching who you play is the card's own Activate button, after a confirmation.
  const choose = (c: CharacterRecord) => {
    setPicked(c.id);
    setAdding(false);
  };

  return (
    <div className="vtt-sessions">
      <span className="vtt-muted">
        Your characters in <b>{campaign.name}</b>. Other campaigns have their own.
        {dm && ' As the DM you do not play a character here; yours are kept for if you swap back.'}
      </span>
      {(error ?? actionError) && (
        <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
          {error ?? actionError}
        </div>
      )}
      {data && (
        <CharacterSwitcher
          characters={characters}
          shownId={adding ? undefined : shown?.id}
          playingId={playingId}
          adding={adding}
          onChoose={choose}
          onAdd={() => setAdding(true)}
        />
      )}
      {data && (adding || characters.length === 0) ? (
        <NewCharacter
          ddbOn={ddbOn}
          onDone={(id) => {
            setAdding(false);
            if (id) setPicked(id);
            reload();
          }}
          onCancel={characters.length ? () => setAdding(false) : undefined}
        />
      ) : (
        shown && (
          <CharacterCard
            key={shown.id}
            record={shown}
            playing={!dm && shown.id === playingId}
            canPlay={!dm}
            ddbOn={ddbOn}
            run={run}
            onPlay={() =>
              run(() => campaignApi('PUT', 'active-character', { characterId: shown.id }))
            }
          />
        )
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
      <span className="vtt-muted">Or choose an emblem for the picture:</span>
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

/**
 * One character. A linked D&D Beyond character shows its numbers as tiles and has no text boxes and no picture to
 * change (the sheet owns both); a hand-made one has the form behind the pencil, a picture you choose the way you do on
 * your profile, and a way to link a sheet.
 */
function CharacterCard({
  record,
  playing,
  canPlay,
  ddbOn,
  run,
  onPlay,
}: {
  record: CharacterRecord;
  playing: boolean;
  canPlay: boolean;
  ddbOn: boolean | undefined;
  run: (call: () => Promise<unknown>) => Promise<void>;
  onPlay: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(draftOf(record));
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setDraft(draftOf(record)), [record]);
  const linked = Boolean(record.sourceUrl);
  const patch = characterPatch(record, draft);
  const dirty = Object.keys(patch).length > 0;
  const setPicture = (value: string | null) =>
    run(() => campaignApi('PATCH', `characters/${record.id}`, { avatarUrl: value }));
  const portrait = (
    <span className="vtt-av vtt-profile-av">
      <Portrait avatarUrl={record.avatarUrl} fallback={record.name.slice(0, 2).toUpperCase()} />
    </span>
  );
  return (
    <section className={playing ? 'vtt-session vtt-loot-taken' : 'vtt-session'}>
      <div className="vtt-char-hero">
        {linked ? (
          <div className="vtt-profile-pic">{portrait}</div>
        ) : (
          <div className="vtt-profile-pic">
            <PictureButton
              label="Change the picture"
              className="vtt-profile-av-btn"
              onPicked={(id) => void setPicture(avatarValue(id))}
            >
              {portrait}
              <span className="vtt-profile-av-over" aria-hidden>
                <Camera size={22} />
              </span>
            </PictureButton>
            {record.avatarUrl && (
              <ToolButton
                label="Remove the picture"
                className="vtt-profile-pic-x"
                onClick={() => void setPicture(null)}
              >
                <X size={12} />
              </ToolButton>
            )}
          </div>
        )}
        <div className="vtt-char-text">
          <b className="vtt-char-title">{record.name}</b>
          <span className="vtt-muted">{characterDetails(record) || 'No details yet'}</span>
          {linked && (
            <span className="vtt-muted vtt-char-synced">
              <Link2 size={11} aria-hidden /> D&amp;D Beyond ·{' '}
              {syncedLabel(record.syncedAt ?? null, Date.now())}
            </span>
          )}
        </div>
        {playing && <span className="vtt-char-playing">Playing</span>}
        {canPlay && !playing && !confirming && (
          <ToolButton
            label="Play this character at the table"
            text="Activate"
            onClick={() => setConfirming(true)}
          >
            <Play size={14} />
          </ToolButton>
        )}
      </div>
      {confirming && (
        <div className="vtt-form-row" role="alertdialog" aria-label="Switch character">
          <span className="vtt-muted" style={{ flex: 1 }}>
            Are you sure? This will change your name and avatar for everyone at the table.
          </span>
          <ToolButton
            label="Yes, switch character"
            text="Switch"
            onClick={() => {
              setConfirming(false);
              void onPlay();
            }}
          >
            <Check size={14} />
          </ToolButton>
          <ToolButton label="Cancel" text="Cancel" onClick={() => setConfirming(false)}>
            <X size={14} />
          </ToolButton>
        </div>
      )}

      {record.sheet && <CharacterStats sheet={record.sheet} />}

      <div className="vtt-form-row">
        {linked ? (
          <>
            <ToolButton
              label="Sync now from D&D Beyond"
              text="Sync"
              onClick={() => void run(() => ddbAction('sync', record.id))}
            >
              <RefreshCw size={14} />
            </ToolButton>
            <ToolButton
              label="Unlink from D&D Beyond (keeps the character as it is)"
              onClick={() => void run(() => ddbAction('unlink', record.id))}
            >
              <Unlink size={14} />
            </ToolButton>
          </>
        ) : (
          <>
            <ToolButton
              label={editing ? 'Close the editor' : 'Edit this character'}
              pressed={editing}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? <X size={14} /> : <Pencil size={14} />}
            </ToolButton>
            {ddbOn && (
              <ToolButton
                label="Link a D&D Beyond sheet"
                pressed={linking}
                onClick={() => setLinking((v) => !v)}
              >
                <Link2 size={14} />
              </ToolButton>
            )}
          </>
        )}
      </div>

      {!linked && ddbOn === false && editing && (
        <span className="vtt-muted">
          Linking a D&amp;D Beyond sheet is switched off on this server (<code>DDB_SYNC=1</code>{' '}
          turns it on).
        </span>
      )}
      {!linked && linking && (
        <DdbLinkField
          busy={false}
          onLink={(url) =>
            run(async () => {
              await ddbAction('link', record.id, url);
              setLinking(false);
              setEditing(false);
            })
          }
        />
      )}
      {!linked && editing && (
        <>
          <Fields draft={draft} onChange={setDraft} />
          <div className="vtt-form-row">
            <ToolButton
              label="Save changes"
              text="Save"
              disabled={!dirty || draft.name.trim() === ''}
              onClick={() => void run(() => campaignApi('PATCH', `characters/${record.id}`, patch))}
            >
              <Save size={14} />
            </ToolButton>
          </div>
        </>
      )}
    </section>
  );
}
