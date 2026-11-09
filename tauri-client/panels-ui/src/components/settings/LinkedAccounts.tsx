import { Link2 } from 'lucide-react';

/**
 * Where outside systems will be linked. Nothing is connected yet: D&D Beyond character import is
 * planned (public character URL only; CLAUDE.md 8.7) and is not built.
 */
export function LinkedAccounts() {
  return (
    <div className="vtt-sessions" style={{ padding: '0 16px 16px' }}>
      <b>
        <Link2 size={14} style={{ verticalAlign: '-2px' }} /> Linked accounts
      </b>
      <span className="vtt-muted">
        D&amp;D Beyond: character import is coming. Nothing is linked yet.
      </span>
    </div>
  );
}
