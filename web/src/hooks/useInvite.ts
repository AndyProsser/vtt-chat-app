import { useEffect, useState } from 'react';

import { previewInvite } from '../lib/api.js';
import type { InvitePreview } from '../types/index.js';

export type InviteState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error'; message: string }
  | { status: 'ready'; invite: InvitePreview };

/** Looks the invite up once per code. Any failure to read it is "invalid" — the server says no more. */
export function useInvite(code: string | undefined): InviteState {
  const [state, setState] = useState<InviteState>({ status: 'loading' });
  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    setState({ status: 'loading' });
    previewInvite(code).then(
      (invite) => !cancelled && setState({ status: 'ready', invite }),
      (error: unknown) =>
        !cancelled &&
        setState(
          (error as { code?: string }).code === 'invite_invalid'
            ? { status: 'invalid' }
            : { status: 'error', message: 'Could not reach the server. Try again in a moment.' },
        ),
    );
    return () => {
      cancelled = true;
    };
  }, [code]);
  return state;
}
