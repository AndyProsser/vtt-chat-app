import { useEffect, useRef, useState } from 'react';

import { groupDrop } from '../lib/groups.js';
import { pickGroupName } from '../lib/groupNames.js';
import { laneAt } from '../lib/laneAt.js';
import { useTableStore } from '../lib/tableStore.js';
import { accountErrorMessage, syncCommand } from '../lib/tauriBridge.js';
import type { Member } from '../types/index.js';

export interface Drag {
  member: Member;
  x: number;
  y: number;
  over: string | undefined;
}

/**
 * Pointer-driven dragging of a person onto a group (`data-lane` elements: `main`, a party id, or `new`).
 * Not the browser's drag-and-drop, so the avatar following the cursor can be drawn in a layer above
 * everything and never clips. Shared by the rail and the groups menu; the DM's commands go through the
 * server, which decides who hears whom, so a move never disconnects anyone.
 */
export function useGroupDrag() {
  const view = useTableStore((s) => s.parties);
  const [error, setError] = useState<string>();
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  dragRef.current = drag;

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

  /** The same move a drop makes, chosen from a menu: for the keyboard, where there is no pointer. */
  function moveTo(member: Member, lane: string) {
    const drop = groupDrop(view, member.userId, lane, () =>
      pickGroupName(view.parties.map((p) => p.name)),
    );
    if (drop?.kind === 'move') void send('party.move', drop.move);
    if (drop?.kind === 'create')
      void send('party.create', { name: drop.name, members: [drop.userId] });
  }

  return {
    drag,
    error,
    send,
    moveTo,
    begin: (
      member: Member,
      e: { button: number; clientX: number; clientY: number; preventDefault: () => void },
    ) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setDrag({ member, x: e.clientX, y: e.clientY, over: undefined });
    },
  };
}
