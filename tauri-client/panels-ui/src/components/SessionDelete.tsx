import { Popover } from '@radix-ui/themes';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { accountErrorMessage, campaignApi } from '../lib/tauriBridge.js';
import { ToolButton } from './ToolButton.js';

type Step = 'choose' | 'audio' | 'all';

/**
 * The DM's one delete button for a recorded session, in the card's top right corner. It opens a small panel that says what each choice
 * removes before anything happens: the raw audio only (the text stays) or the whole session. Either one asks once more.
 */
export function SessionDelete({
  id,
  canDeleteAudio,
  onAudioDeleted,
  onRemoved,
}: {
  id: string;
  /** The raw audio is still there to delete (it may already be gone, or the recording may still be processing). */
  canDeleteAudio: boolean;
  onAudioDeleted: () => void;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string>();

  const close = () => {
    setOpen(false);
    setStep('choose');
    setError(undefined);
  };

  async function run(step: 'audio' | 'all') {
    try {
      setError(undefined);
      if (step === 'audio') {
        await campaignApi('POST', `recordings/${id}/audio/delete`);
        onAudioDeleted();
      } else {
        await campaignApi('DELETE', `recordings/${id}`);
        onRemoved();
      }
      close();
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <Popover.Trigger>
        <ToolButton label="Delete…" danger>
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
          {step === 'choose' && (
            <>
              <button
                type="button"
                className="vtt-del-choice"
                disabled={!canDeleteAudio}
                onClick={() => setStep('audio')}
              >
                <b>Delete the audio only</b>
                <span className="vtt-muted">
                  {canDeleteAudio
                    ? 'Frees disk space. The transcript and summaries stay. The audio cannot be transcribed again.'
                    : 'The audio is already gone, or still being processed.'}
                </span>
              </button>
              <button
                type="button"
                className="vtt-del-choice vtt-del-danger"
                onClick={() => setStep('all')}
              >
                <b>Delete the whole session</b>
                <span className="vtt-muted">
                  Removes the recording, its transcript and its summaries, for everyone.
                </span>
              </button>
            </>
          )}
          {step !== 'choose' && (
            <>
              <button type="button" className="vtt-menu-back" onClick={() => setStep('choose')}>
                <ArrowLeft size={12} aria-hidden /> Back
              </button>
              <span role="alert">
                {step === 'audio'
                  ? 'Delete the raw audio of this session? The transcript and summaries stay. This cannot be undone.'
                  : 'Delete this recording, its transcript and its summaries for everyone? This cannot be undone.'}
              </span>
              <span className="vtt-form-row">
                <ToolButton
                  label={step === 'audio' ? 'Yes, delete the audio' : 'Yes, delete the session'}
                  danger
                  text="Delete"
                  onClick={() => void run(step)}
                >
                  <Trash2 size={14} />
                </ToolButton>
                <ToolButton label="Keep it" text="Keep" onClick={close}>
                  <ArrowLeft size={14} />
                </ToolButton>
              </span>
            </>
          )}
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
