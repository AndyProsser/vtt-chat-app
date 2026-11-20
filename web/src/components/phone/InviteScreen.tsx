import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { inviteLink, inviteMessage } from '@vtt-chat-app/shared';
import { useEffect, useState } from 'react';

import { ApiError } from '../../lib/api.js';
import { createInvite, resetInvites } from '../../lib/phone/phoneApi.js';
import { usePhoneStore } from '../../lib/phone/phoneStore.js';
import { qrDataUrl } from '../../lib/phone/qr.js';
import { IconTool } from './IconTool.js';

/**
 * The DM's invite page: one link for the whole group (it works until it expires), as text to paste, a message to
 * copy and a QR code another phone can scan. Stopping every link is here too.
 */
export function InviteScreen({ campaignId }: { campaignId: string }) {
  const campaign = usePhoneStore((s) => s.campaigns.find((c) => c.id === campaignId));
  const selfId = usePhoneStore((s) => s.userId);
  const dmName = usePhoneStore((s) => s.members.find((m) => m.userId === selfId)?.displayName);
  const [link, setLink] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let live = true;
    if (!link) return setQr(undefined);
    qrDataUrl(link)
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(undefined));
    return () => {
      live = false;
    };
  }, [link]);

  async function make() {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const { code } = await createInvite(campaignId);
      setLink(inviteLink(window.location.origin, code));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make an invite. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied.`);
    } catch {
      setNote('Could not copy here. Press and hold the link to copy it.');
    }
  }

  async function stopAll() {
    setBusy(true);
    setError(undefined);
    try {
      await resetInvites(campaignId);
      setLink(undefined);
      setConfirmReset(false);
      setNote('Every invite link has stopped working. People already in stay in.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not stop the links. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        One link works for the whole group until it expires. Paste it into your group chat, or let
        someone scan the code.
      </Text>
      {error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {!link && (
        <Button size="3" loading={busy} onClick={() => void make()}>
          Make an invite link
        </Button>
      )}
      {link && (
        <section className="phone-info-card" aria-label="Invite link">
          <code className="phone-invite-link">{link}</code>
          <Flex gap="2" wrap="wrap">
            <Button size="2" onClick={() => void copy(link, 'The link')}>
              Copy link
            </Button>
            <Button
              size="2"
              variant="soft"
              onClick={() =>
                void copy(
                  inviteMessage({ campaignName: campaign?.name ?? 'the table', dmName, link }),
                  'The invite message',
                )
              }
            >
              Copy invite message
            </Button>
          </Flex>
          {qr && (
            <img
              className="phone-qr"
              src={qr}
              width={240}
              height={240}
              alt="QR code for the invite link"
            />
          )}
        </section>
      )}
      {note && (
        <Text size="2" color="gray" role="status">
          {note}
        </Text>
      )}
      <section className="phone-info-card" aria-label="Stop invite links">
        {confirmReset ? (
          <Flex direction="column" gap="2">
            <Text size="2">Stop every invite link that is still in use?</Text>
            <Flex gap="2">
              <Button color="red" loading={busy} onClick={() => void stopAll()}>
                Yes, stop them all
              </Button>
              <Button variant="soft" color="gray" onClick={() => setConfirmReset(false)}>
                Cancel
              </Button>
            </Flex>
          </Flex>
        ) : (
          <Flex align="center" justify="between" gap="3">
            <Text size="2" color="gray">
              Stop every invite link that is still in use.
            </Text>
            <IconTool
              small
              danger
              label="Stop all invite links…"
              icon="trash"
              onClick={() => setConfirmReset(true)}
            />
          </Flex>
        )}
      </section>
    </Flex>
  );
}
