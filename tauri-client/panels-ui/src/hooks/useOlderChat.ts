import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

import { fetchOlder } from '../lib/chatHistory.js';
import { useTableStore } from '../lib/tableStore.js';

export interface OlderChat {
  loading: boolean;
  done: boolean;
  failed: boolean;
  /** Ask again after a failure. */
  retry: () => void;
}

/**
 * Loads older chat when the top of the conversation scrolls into view (`sentinel`, inside `scroller`),
 * one page at a time, and keeps the line being read where it was while the older ones are added above.
 * Nothing runs until the sentinel is seen, so an idle panel makes no requests.
 */
export function useOlderChat(
  scroller: RefObject<HTMLElement | null>,
  sentinel: RefObject<HTMLElement | null>,
): OlderChat {
  const done = useTableStore((s) => s.historyDone);
  const firstId = useTableStore((s) => s.chat[0]?.id);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const heightBefore = useRef<number | null>(null);

  const load = useCallback(async () => {
    const { chat, members, historyDone, addOlder } = useTableStore.getState();
    const oldest = chat[0];
    if (busy.current || historyDone || !oldest) return;
    busy.current = true;
    setLoading(true);
    setFailed(false);
    try {
      heightBefore.current = scroller.current?.scrollHeight ?? null;
      const page = await fetchOlder(oldest.at, chat.length, members);
      addOlder(page.lines, page.done);
    } catch {
      heightBefore.current = null;
      setFailed(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [scroller]);

  // Older lines were added above: move down by what was added, so the view does not jump.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && heightBefore.current !== null) {
      el.scrollTop += el.scrollHeight - heightBefore.current;
      heightBefore.current = null;
    }
  }, [firstId, scroller]);

  useEffect(() => {
    const target = sentinel.current;
    if (!target || done || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void load();
      },
      { root: scroller.current },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [sentinel, scroller, done, failed, load, firstId]);

  return { loading, done, failed, retry: () => void load() };
}
