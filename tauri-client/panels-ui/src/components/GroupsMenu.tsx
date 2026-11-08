import { Popover } from '@radix-ui/themes';
import { Trash2, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { avatarColor } from '../lib/avatarColor.js';
import { groupDrop, lanes } from '../lib/groups.js';
import { pickGroupName } from '../lib/groupNames.js';
import { laneAt } from '../lib/laneAt.js';
import { initials } from '../lib/rail.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { Member } from '../types/index.js';
import { Portrait } from './Portrait.js';
import { ToolButton } from './ToolButton.js';

interface Drag {
  member: Member;
  x: number;
  y: number;
  over: string | undefined;
}

const labelOf = (m: Member) => m.character?.name ?? m.displayName;

/**
 * DM-only. The groups are stacked lanes; drag a player's avatar between them, or onto the dashed zone
 * to start a new group with a made-up name (click a group's name to change it). Everyone stays in the
 * one voice room; the server decides who hears whom, so moving a player never disconnects anyone.
 *
 * Dragging is pointer-driven (not the browser's drag-and-drop) so the avatar following the cursor is
 * drawn in a layer above the popover and never clips or vanishes behind it.
 */
export function GroupsMenu() {
  const members = useTableStore((s) => s.members);
  const view = useTableStore((s) => s.parties);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  dragRef.current = drag;
  const columns = useMemo(() => lanes(members, view), [members, view]);

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) =>
      setDrag(
        (d) =>
          d && {
            ...d,
            x: e.clientX,
            y: e.clientY,
            over: laneAt(document.elementsFromPoint(e.clientX, e.clientY)),
          },
      );
    const up = (e: PointerEvent) => {
      const current = dragRef.current;
      setDrag(undefined);
      if (!current) return;
      const drop = groupDrop(
        view,
        current.member.userId,
        laneAt(document.elementsFromPoint(e.clientX, e.clientY)),
        () => pickGroupName(view.parties.map((p) => p.name)),
      );
      if (drop?.kind === 'move') void send('party.move', drop.move);
      if (drop?.kind === 'create')
        void send('party.create', { name: drop.name, members: [drop.userId] });
    };
    const cancel = () => setDrag(undefined);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    // `view` only matters at the moment of dropping.
  }, [drag !== undefined, view]);

  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="Voice groups: drag players between them" pressed={view.split}>
          <Users size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="300px" align="end">
        <div className="vtt-groups">
          {error && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {error}
            </div>
          )}
          {columns.map((lane) => (
            <section
              key={lane.id ?? 'main'}
              data-lane={lane.id ?? 'main'}
              className={drag?.over === (lane.id ?? 'main') ? 'vtt-lane vtt-lane-over' : 'vtt-lane'}
              aria-label={lane.name}
            >
              <header className="vtt-lane-head">
                {lane.id === null ? (
                  <b>{lane.name}</b>
                ) : (
                  <GroupName
                    name={lane.name}
                    onRename={(name) => void send('party.rename', { partyId: lane.id, name })}
                  />
                )}
                {lane.id !== null && (
                  <ToolButton
                    label={`Remove ${lane.name} (its players go back to the Main Party)`}
                    danger
                    onClick={() => void send('party.delete', { partyId: lane.id })}
                  >
                    <Trash2 size={13} />
                  </ToolButton>
                )}
              </header>
              <ul className="vtt-lane-list">
                {lane.members.length === 0 && <li className="vtt-muted">Empty</li>}
                {lane.members.map((m) => (
                  <li
                    key={m.userId}
                    className={
                      drag?.member.userId === m.userId
                        ? 'vtt-person vtt-person-lifted'
                        : 'vtt-person'
                    }
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      setDrag({ member: m, x: e.clientX, y: e.clientY, over: undefined });
                    }}
                  >
                    <Avatar member={m} />
                    <span>{labelOf(m)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section
            data-lane="new"
            className={
              drag?.over === 'new' ? 'vtt-lane vtt-lane-new vtt-lane-over' : 'vtt-lane vtt-lane-new'
            }
            aria-label="Start a new group"
          >
            <span className="vtt-muted">Drop a player here to start a new group</span>
          </section>
          <div className="vtt-form-row">
            <ToolButton
              label="Bring everyone back to the Main Party"
              disabled={!view.split}
              onClick={() => void send('party.reset', {})}
            >
              <Users size={14} />
            </ToolButton>
          </div>
        </div>
        {drag &&
          createPortal(
            <div className="vtt-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden>
              <Avatar member={drag.member} />
              <span>{labelOf(drag.member)}</span>
            </div>,
            document.body,
          )}
      </Popover.Content>
    </Popover.Root>
  );
}

function Avatar({ member }: { member: Member }) {
  return (
    <i className="vtt-chip-av" style={{ background: avatarColor(member.userId) }}>
      <Portrait
        avatarUrl={member.character?.avatarUrl}
        fallback={initials(labelOf(member))}
        size={12}
      />
    </i>
  );
}

/** A group's name; click to edit, Enter or leaving the box saves, Escape cancels. */
function GroupName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  if (!editing) {
    return (
      <button
        type="button"
        className="vtt-lane-name"
        title="Click to rename"
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = text.trim().slice(0, 60);
    if (next && next !== name) onRename(next);
    else setText(name);
  };
  return (
    <input
      className="vtt-input vtt-lane-edit"
      aria-label="Group name"
      autoFocus
      maxLength={60}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setText(name);
          setEditing(false);
        }
      }}
    />
  );
}
