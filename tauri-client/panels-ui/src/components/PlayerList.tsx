import { Check } from 'lucide-react';

import { avatarColor } from '../lib/avatarColor.js';
import { PICKER_ROWS, playerLines } from '../lib/players.js';
import { initials, memberAvatar } from '../lib/rail.js';
import type { Member } from '../types/index.js';
import { Portrait } from './Portrait.js';

interface Common {
  players: Member[];
  /** Extra words on a row (for instance "offline"), shown after the name. */
  hint?: (m: Member) => string | undefined;
  /** The accessible name of the list. */
  label: string;
}

type Props =
  | (Common & { mode: 'pick'; onPick: (userId: string) => void })
  | (Common & { mode: 'multi'; selected: string[]; onChange: (selected: string[]) => void });

/**
 * The one way to choose players or characters: a row for each, with the portrait, the character's name
 * and the person's own name. The list is as tall as the number of players and scrolls after six. `pick`
 * acts on one click; `multi` is a set of checkable rows. Use this wherever a player has to be chosen.
 */
export function PlayerList(props: Props) {
  const { players, hint, label } = props;
  if (players.length === 0) return <span className="vtt-muted">No players yet.</span>;
  return (
    <ul
      className="vtt-pick"
      role={props.mode === 'pick' ? 'menu' : 'group'}
      aria-label={label}
      style={{ ['--pick-rows' as string]: PICKER_ROWS }}
    >
      {players.map((m) => {
        const { primary, secondary } = playerLines(m);
        const on = props.mode === 'multi' && props.selected.includes(m.userId);
        const extra = hint?.(m);
        const toggle = () =>
          props.mode === 'pick'
            ? props.onPick(m.userId)
            : props.onChange(
                on ? props.selected.filter((id) => id !== m.userId) : [...props.selected, m.userId],
              );
        return (
          <li key={m.userId}>
            <button
              type="button"
              className="vtt-pick-row"
              role={props.mode === 'pick' ? 'menuitem' : 'checkbox'}
              aria-checked={props.mode === 'multi' ? on : undefined}
              onClick={toggle}
            >
              <span className="vtt-av vtt-av-sm" style={{ background: avatarColor(m.userId) }}>
                <Portrait avatarUrl={memberAvatar(m)} fallback={initials(primary)} size={13} />
              </span>
              <span className="vtt-pick-names">
                <b>{primary}</b>
                {(secondary || extra) && (
                  <span className="vtt-muted">
                    {[secondary, extra].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {props.mode === 'multi' && (
                <span className="vtt-pick-check" data-on={on} aria-hidden>
                  {on && <Check size={13} />}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
