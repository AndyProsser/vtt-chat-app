import type { ReactNode } from 'react';

import picture from '../assets/empty-state.webp';

/** A short note with a small picture above it, for a list that has nothing in it yet. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="vtt-empty">
      <img src={picture} alt="" />
      <span className="vtt-muted">{children}</span>
    </div>
  );
}
