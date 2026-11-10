import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { flip } from '../lib/flip.js';
import { ToolButton } from './ToolButton.js';

/**
 * One slide at a time with previous and next buttons and a "2 / 5" count; with a single slide it shows
 * the slide alone. The caller chooses the slide to show (`index`), so a chat card and the viewer window
 * can each keep their own place.
 */
export function FlipPanel({
  count,
  index,
  onIndex,
  children,
}: {
  count: number;
  index: number;
  onIndex: (next: number) => void;
  children: ReactNode;
}) {
  if (count <= 1) return <>{children}</>;
  return (
    <div className="vtt-flip">
      {children}
      <div className="vtt-flip-bar">
        <ToolButton label="Previous picture" onClick={() => onIndex(flip(index, count, -1))}>
          <ChevronLeft size={14} />
        </ToolButton>
        <span className="vtt-flip-count" aria-live="polite">
          {index + 1} / {count}
        </span>
        <ToolButton label="Next picture" onClick={() => onIndex(flip(index, count, 1))}>
          <ChevronRight size={14} />
        </ToolButton>
      </div>
    </div>
  );
}
