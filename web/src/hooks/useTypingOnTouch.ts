import { useEffect, useRef, useState } from 'react';

/** Fields that bring up the on-screen keyboard or a picker (not checkboxes, buttons and the like). */
const TYPED =
  'textarea, input:not([type=checkbox],[type=radio],[type=button],[type=submit],[type=range],[type=file])';

function isTyping(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.matches(TYPED) || el.isContentEditable);
}

/** Keeps the password helpers away from ordinary fields; sign-in fields name their own `autocomplete` and are left. */
function patch(el: HTMLElement) {
  if (el.hasAttribute('autocomplete')) return;
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('data-1p-ignore', 'true');
  el.setAttribute('data-lpignore', 'true');
  el.setAttribute('data-bwignore', 'true');
  el.setAttribute('data-form-type', 'other');
}

function patchAll(root: HTMLElement) {
  if (root.matches(TYPED)) patch(root);
  root.querySelectorAll<HTMLElement>(TYPED).forEach(patch);
}

/**
 * True while a field has focus on a touch screen, i.e. while the on-screen keyboard is up. The phone app uses it
 * to hide the tab bar, which would otherwise take a strip of the little space the keyboard leaves. It is always
 * false with a mouse, so a desktop browser keeps its tabs. The attributes below also stop the phone's password
 * helper (the "Passwords" / verification-code bar above the keyboard) from offering itself on ordinary fields.
 */
export function useTypingOnTouch(): boolean {
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  typingRef.current = typing;
  useEffect(() => {
    const touch = window.matchMedia('(pointer: coarse)');
    let timer: number | undefined;
    const onIn = (e: FocusEvent) => {
      window.clearTimeout(timer);
      if (touch.matches && isTyping(e.target)) setTyping(true);
    };
    // Focus moves from one field to the next through a blur: wait a beat before deciding the keyboard is gone.
    const onOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setTyping(isTyping(document.activeElement) && touch.matches),
        120,
      );
    };
    // Patch fields as they appear, before anyone taps one: the phone reads these when the field takes focus.
    patchAll(document.body);
    const watch = new MutationObserver((records) => {
      // A field that was removed while focused (a form closing) fires no blur: look again.
      if (typingRef.current && !isTyping(document.activeElement)) setTyping(false);
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && patchAll(n));
    });
    watch.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      window.clearTimeout(timer);
      watch.disconnect();
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return typing;
}
