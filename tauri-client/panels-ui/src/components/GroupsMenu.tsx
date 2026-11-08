import { PersonIcon } from '@radix-ui/react-icons';
import { Popover, Select } from '@radix-ui/themes';
import { useState } from 'react';

import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';

const NONE = '__none__';

/**
 * DM-only. Everyone stays in the one voice room; the server decides who hears whom, so moving a
 * player never disconnects anyone (docs/architecture/TABLE-FEATURES.md "Party split").
 */
export function GroupsMenu() {
  const members = useTableStore((s) => s.members);
  const view = useTableStore((s) => s.parties);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();

  async function send(t: string, d: Record<string, unknown>) {
    try {
      setError(undefined);
      await syncCommand(t, d);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  const players = members.filter((m) => m.role !== 'dm');

  return (
    <Popover.Root>
      <Popover.Trigger>
        <button type="button" className="vtt-pill">
          <PersonIcon /> {view.split ? 'Split' : 'Groups'}
        </button>
      </Popover.Trigger>
      <Popover.Content size="1" width="300px" align="end">
        <div className="vtt-groups">
          {error && (
            <div className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {error}
            </div>
          )}
          {players.map((m) => (
            <div key={m.userId} className="vtt-groups-row">
              <span>{m.character?.name ?? m.displayName}</span>
              <Select.Root
                size="1"
                value={view.assignments[m.userId] ?? NONE}
                onValueChange={(v) =>
                  void send('party.move', { userId: m.userId, partyId: v === NONE ? null : v })
                }
              >
                <Select.Trigger />
                <Select.Content>
                  <Select.Item value={NONE}>Main table</Select.Item>
                  {view.parties.map((p) => (
                    <Select.Item key={p.id} value={p.id}>
                      {p.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </div>
          ))}
          <form
            className="vtt-groups-row"
            onSubmit={(e) => {
              e.preventDefault();
              const n = name.trim();
              if (n) void send('party.create', { name: n }).then(() => setName(''));
            }}
          >
            <input
              className="vtt-input"
              aria-label="New group"
              placeholder="New group…"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="vtt-pill">
              Add
            </button>
          </form>
          <div className="vtt-drawer-row">
            {view.parties.map((p) => (
              <button
                key={p.id}
                type="button"
                className="vtt-pill"
                onClick={() => void send('party.delete', { partyId: p.id })}
              >
                Remove {p.name}
              </button>
            ))}
            <button type="button" className="vtt-pill" onClick={() => void send('party.reset', {})}>
              Bring everyone together
            </button>
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
