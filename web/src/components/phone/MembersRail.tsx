import { Popover, Text } from '@radix-ui/themes';
import { useId, useMemo, useRef } from 'react';

import { usePopout } from '../../hooks/usePopout.js';
import {
  initials,
  memberCard,
  portraitUrl,
  PRESENCE_LABEL,
  presenceOf,
  railOrder,
} from '../../lib/phone/rail.js';
import type { Member } from '../../types/phone.js';

/**
 * Who is at the table and how they show, as a slim version of the desktop app's avatar rail: a horizontal
 * strip on a phone, a vertical rail beside the chat on a wide screen. No voice or speaking state here.
 * Each avatar is a button; hovering (mouse) or clicking/tapping opens a details popout.
 */
export function MembersRail({ members }: { members: Member[] }) {
  const ordered = useMemo(() => railOrder(members), [members]);
  const [state, send] = usePopout();
  if (ordered.length === 0) return null;
  return (
    <nav className="phone-rail" aria-label="People at this table">
      <ul className="phone-rail-list">
        {ordered.map((m) => (
          <li key={m.userId} className="phone-rail-item">
            <RailMember
              member={m}
              open={state.open === m.userId}
              onEnter={() => send({ type: 'enter', id: m.userId })}
              onLeave={() => send({ type: 'leave', id: m.userId })}
              onClick={() => send({ type: 'click', id: m.userId })}
              onDismiss={() => send({ type: 'dismiss' })}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

const mouseOnly = (fn: () => void) => (e: React.PointerEvent) => {
  if (e.pointerType === 'mouse') fn();
};

function RailMember({
  member,
  open,
  onEnter,
  onLeave,
  onClick,
  onDismiss,
}: {
  member: Member;
  open: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  onDismiss: () => void;
}) {
  const card = memberCard(member);
  const picture = portraitUrl(member);
  const id = useId();
  // Hover closing must not pull focus to the avatar; Escape and outside presses may.
  const closedByHover = useRef(false);
  const dm = member.role === 'dm';
  const classes = `phone-av phone-av-${card.presence}${dm ? ' phone-av-dm' : ''}`;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closedByHover.current = false;
          onDismiss();
        }
      }}
    >
      <Popover.Trigger>
        <button
          type="button"
          className={classes}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={`${card.title}${dm ? ', DM' : ''}, ${PRESENCE_LABEL[card.presence]}`}
          onPointerEnter={mouseOnly(onEnter)}
          onPointerLeave={mouseOnly(() => {
            closedByHover.current = true;
            onLeave();
          })}
          onClick={(e) => {
            // Our own state machine decides open/close; stop Radix toggling it a second time.
            e.preventDefault();
            closedByHover.current = false;
            onClick();
          }}
        >
          {picture ? (
            <img className="phone-av-img" src={picture} alt="" draggable={false} />
          ) : (
            <span aria-hidden="true">{initials(card.title)}</span>
          )}
          {dm && (
            <span className="phone-av-dmtag" aria-hidden="true">
              DM
            </span>
          )}
          <span className={`phone-av-dot phone-av-dot-${presenceOf(member)}`} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        id={id}
        role="dialog"
        aria-label={card.title}
        size="1"
        maxWidth="240px"
        className="phone-rail-card"
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          if (closedByHover.current) e.preventDefault();
        }}
        onPointerEnter={mouseOnly(onEnter)}
        onPointerLeave={mouseOnly(() => {
          closedByHover.current = true;
          onLeave();
        })}
      >
        <Text as="div" weight="bold" size="2">
          {card.title}
        </Text>
        {card.lines.map((line) => (
          <Text as="div" size="1" key={line}>
            {line}
          </Text>
        ))}
        <Text as="div" size="1" color="gray" className="phone-rail-status">
          <span
            className={`phone-av-dot phone-av-dot-${card.presence} phone-av-dot-inline`}
            aria-hidden="true"
          />
          {PRESENCE_LABEL[card.presence]}
        </Text>
      </Popover.Content>
    </Popover.Root>
  );
}
