import { Button, Dialog, Flex } from '@radix-ui/themes';

import type { UpdateInfo } from '../lib/updateInfo.js';
import { hasNotes } from '../lib/updateInfo.js';
import { MarkdownView } from './MarkdownView.js';

/**
 * "More info" beside an update notice: the release notes in a dialog, for the few who want them. The
 * notice itself stays one short line (Andy, 2026-11-17: "most won't care"). Renders nothing when the
 * server sent no notes.
 */
export function UpdateNotes({ info }: { info: UpdateInfo }) {
  if (!hasNotes(info)) return null;
  return (
    <Dialog.Root>
      <Dialog.Trigger>
        <button type="button" className="vtt-more">
          More info
        </button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="480px" aria-describedby={undefined}>
        <Dialog.Title size="3">What is new in {info.version}</Dialog.Title>
        <div className="vtt-update-notes">
          <MarkdownView text={info.notes ?? ''} />
        </div>
        <Flex justify="end" mt="3">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
