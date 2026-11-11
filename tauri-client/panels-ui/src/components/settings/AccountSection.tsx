import { Badge, Button, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { Check, LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useConnectLink } from '../../hooks/useConnectLink.js';
import { avatarValue } from '../../lib/avatars.js';
import { initials } from '../../lib/rail.js';
import { accountErrorMessage, accountRename, accountSetAvatar } from '../../lib/tauriBridge.js';
import { PictureButton } from '../PictureButton.js';
import { Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';
import { ConnectScreen } from './ConnectScreen.js';
import { DevSignIn } from './DevSignIn.js';

/**
 * Connect (device approval in a browser, docs/architecture/APP-SIGN-IN.md), then the signed-in views.
 * Accounts are created on the browser join page from an invite; the app never needs a sign-up flow.
 * The password/code/SSO forms live in `DevSignIn`, shown only in dev mode.
 */
export function AccountSection() {
  const account = useAccount();
  const { status } = account;
  const [server, setServer] = useState<string>();
  const [code, setCode] = useState('');
  const link = useConnectLink();
  const address = server ?? status?.server ?? '';

  if (!status) return null;

  const errorBox = account.error && (
    <Callout.Root color="red" role="alert" size="1">
      <Callout.Text>{account.error}</Callout.Text>
    </Callout.Root>
  );

  if (status.signedIn && status.campaignId === null && status.campaigns.length > 0) {
    return (
      <Flex direction="column" gap="3">
        <Heading size="4">Choose a campaign</Heading>
        {status.campaigns.map((c) => (
          <Button
            key={c.id}
            variant="soft"
            size="3"
            disabled={account.busy}
            onClick={() => void account.selectCampaign(c.id)}
          >
            {c.name} {c.role === 'dm' && <Badge color="violet">DM</Badge>}
          </Button>
        ))}
        {errorBox}
      </Flex>
    );
  }

  if (status.signedIn) {
    const campaign = status.campaigns.find((c) => c.id === status.campaignId);
    return (
      <Flex direction="column" gap="3">
        <Flex align="start" gap="4">
          <span className="vtt-av vtt-profile-av">
            <Portrait avatarUrl={status.avatarUrl} fallback={initials(status.displayName ?? '?')} />
          </span>
          <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 0 }}>
            <PlayerName name={status.displayName ?? 'Signed in'} />
            <Flex align="center" gap="2">
              <PictureButton
                onPicked={(id) => void accountSetAvatar(avatarValue(id)).catch(console.error)}
              />
              {status.avatarUrl && (
                <ToolButton
                  label="Remove your picture"
                  onClick={() => void accountSetAvatar(null).catch(console.error)}
                >
                  <X size={14} />
                </ToolButton>
              )}
            </Flex>
          </Flex>
          <ToolButton
            label="Sign out"
            disabled={account.busy}
            onClick={() => void account.signOut()}
          >
            <LogOut size={16} />
          </ToolButton>
        </Flex>
        <Text color="gray" size="2">
          {campaign
            ? `In ${campaign.name}`
            : 'Not in a campaign yet — join one from your invite link.'}
          <br />
          {status.server}
        </Text>
        {errorBox}
      </Flex>
    );
  }

  return (
    <>
      <ConnectScreen
        link={link}
        busy={account.busy}
        error={account.error}
        onStatus={account.applyStatus}
        onConnectWithCode={account.connectWithCode}
        server={address}
        onServer={setServer}
        code={code}
        onCode={setCode}
      />
      <DevSignIn account={account} server={address} onServer={setServer} onCode={setCode} />
    </>
  );
}

/** Your player name, as the table sees it. Click the name (dotted underline) to change it; Enter saves, Escape cancels. */
function PlayerName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const [error, setError] = useState<string>();
  useEffect(() => setText(name), [name]);
  async function save() {
    try {
      setError(undefined);
      await accountRename(text.trim());
      setEditing(false);
    } catch (e) {
      setError(accountErrorMessage(e));
    }
  }
  if (!editing) {
    return (
      <button
        type="button"
        className="vtt-name-edit"
        title="Click to edit"
        aria-label={`Player name: ${name}. Click to edit`}
        onClick={() => setEditing(true)}
      >
        <Text size="5" weight="bold">
          {name}
        </Text>
      </button>
    );
  }
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <TextField.Root
          size="1"
          aria-label="Player name"
          autoFocus
          maxLength={80}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') {
              setText(name);
              setEditing(false);
            }
          }}
        />
        <ToolButton label="Save the name" disabled={text.trim() === ''} onClick={() => void save()}>
          <Check size={14} />
        </ToolButton>
        <ToolButton label="Cancel" onClick={() => setEditing(false)}>
          <X size={14} />
        </ToolButton>
      </Flex>
      {error && (
        <Text size="1" color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
