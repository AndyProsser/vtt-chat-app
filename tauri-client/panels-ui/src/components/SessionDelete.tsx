import { Popover } from '@radix-ui/themes';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import { ToolButton } from './ToolButton.js';

/**
 * Deletes a short test session, for the Game Master, with dev builds on (the panel decides when to show it; the
 * server refuses anything of 30 minutes or more). It removes the recording, its audio, transcript and summaries,
 * for everyone, and asks once. Cleaning up real sessions and their audio is the server operator's job.
 */
export function SessionDelete({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();

  const close = () => {
    setOpen(false);
    setError(undefined);
  };

  async function run() {
    try {
      setError(undefined);
      await campaignApi('DELETE', `recordings/${id}`);
      onRemoved();
      close();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Popover.Trigger>
        <ToolButton label="Delete this test session…" danger>
          <Trash2 size={14} />
        </ToolButton>
      </Popover.Trigger>
      <Popover.Content
        size="1"
        width="260px"
        align="end"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="vtt-del">
          <span role="alert">
            Delete this short test session, with its audio, transcript and summaries, for everyone?
            This cannot be undone.
          </span>
          <span className="vtt-form-row">
            <ToolButton
              label="Yes, delete the session"
              danger
              text="Delete"
              onClick={() => void run()}
            >
              <Trash2 size={14} />
            </ToolButton>
            <ToolButton label="Keep it" text="Keep" onClick={close}>
              <ArrowLeft size={14} />
            </ToolButton>
          </span>
          {error && (
            <span className="vtt-composer-error" role="alert" style={{ position: 'static' }}>
              {error}
            </span>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
