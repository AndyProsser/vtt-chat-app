import { Popover } from '@radix-ui/themes';
import { Plus, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { lanes, moveCommand } from '../lib/groups.js';
import { initials } from '../lib/rail.js';
import { useTableStore } from '../lib/tableStore.js';
import { avatarColor } from '../lib/avatarColor.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import { ToolButton } from './ToolButton.js';

/**
 * DM-only. Drag a player's avatar into a group (or back to the main table). Everyone stays in the
 * one voice room; the server decides who hears whom, so moving a player never disconnects anyone
 * (docs/architecture/TABLE-FEATURES.md "Party split").
 */
export function GroupsMenu() {
  const members = useTableStore((s) => s.members);
  const view = useTableStore((s) => s.parties);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [over, setOver] = useState<string | null | undefined>(undefined);
  const columns = useMemo(() => lanes(members, view), [members, view]);

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <Popover.Root>
      <Popover.Trigger>
        <ToolButton label="Voice groups: drag players between them" pressed={view.split}>
          <Users size={15} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content size="1" width="340px" align="end">
        <div className="vtt-groups">
          {error && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {error}
            </div>
          )}
          {columns.map((lane) => (
            <section
              key={lane.id ?? 'main'}
              className={over === lane.id ? 'vtt-lane vtt-lane-over' : 'vtt-lane'}
              aria-label={lane.name}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(lane.id);
              }}
              onDragLeave={() => setOver(undefined)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(undefined);
                const userId = e.dataTransfer.getData('text/plain');
                const move = moveCommand(view, userId, lane.id);
                if (move) void send('party.move', move);
              }}
            >
              <header className="vtt-lane-head">
                <b>{lane.name}</b>
                {lane.id !== null && (
                  <ToolButton
                    label={`Remove ${lane.name} (its players go back to the main table)`}
                    danger
                    onClick={() => void send('party.delete', { partyId: lane.id })}
                  >
                    <Trash2 size={13} />
                  </ToolButton>
                )}
              </header>
              <div className="vtt-lane-body">
                {lane.members.length === 0 && <span className="vtt-muted">Drop players here</span>}
                {lane.members.map((m) => {
                  const label = m.character?.name ?? m.displayName;
                  return (
                    <span
                      key={m.userId}
                      className="vtt-chip"
                      draggable
                      title={label}
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', m.userId);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                    >
                      <i className="vtt-chip-av" style={{ background: avatarColor(m.userId) }}>
                        {initials(label)}
                      </i>
                      {label}
                    </span>
                  );
                })}
              </div>
            </section>
          ))}
          <form
            className="vtt-form-row"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (n) void send('party.create', { name: n }).then(() => setName(''));
            }}
          >
            <input
              className="vtt-input"
              style={{ flex: 1 }}
              aria-label="New group"
              placeholder="New group…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <ToolButton label="Add the group" submit disabled={name.trim() === ''}>
              <Plus size={14} />
            </ToolButton>
            <ToolButton
              label="Bring everyone together"
              disabled={!view.split}
              onClick={() => void send('party.reset', {})}
            >
              <Users size={14} />
            </ToolButton>
          </form>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
