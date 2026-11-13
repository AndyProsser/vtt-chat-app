import { Button, Flex, Heading, Text } from '@radix-ui/themes';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { Icon } from '../icons/index.js';

/**
 * A full-screen page over the tab it was opened from: Back, a title, the actions, the form. Escape and Back
 * close it; when `dirty`, they first ask whether to throw the changes away. Focus goes to the first field
 * (`data-autofocus`) when it opens; the caller gives it back to the opener with `useReturnFocus`.
 */
export function Sheet({
  title,
  dirty,
  onClose,
  actions,
  children,
}: {
  title: string;
  dirty: boolean;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const heading = useId();
  const root = useRef<HTMLElement>(null);
  const [asking, setAsking] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);

  const leave = useCallback(() => {
    if (dirty) setAsking(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const first = root.current?.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? root.current?.querySelector<HTMLElement>('h2'))?.focus();
  }, []);

  useEffect(() => {
    if (asking) keep.current?.focus();
  }, [asking]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (asking) setAsking(false);
      else leave();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asking, leave]);

  return (
    <section ref={root} className="phone-sheet" aria-labelledby={heading}>
      <header className="phone-sheet-head">
        <Button variant="ghost" color="gray" size="3" onClick={leave} aria-label="Back">
          <Icon name="arrowLeft" size={18} />
          Back
        </Button>
        <Heading size="4" as="h2" id={heading} tabIndex={-1} className="phone-sheet-title">
          {title}
        </Heading>
        <div className="phone-sheet-actions">{actions}</div>
      </header>
      {asking && (
        <div className="phone-sheet-ask" role="alertdialog" aria-label="Discard your changes?">
          <Text size="2" weight="medium">
            Discard your changes?
          </Text>
          <Flex gap="2">
            <Button ref={keep} size="2" variant="soft" onClick={() => setAsking(false)}>
              Keep editing
            </Button>
            <Button size="2" color="red" onClick={onClose}>
              Discard
            </Button>
          </Flex>
        </div>
      )}
      <div className="phone-sheet-body">{children}</div>
    </section>
  );
}
