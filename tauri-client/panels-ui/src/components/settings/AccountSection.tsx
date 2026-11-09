import { Badge, Button, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { Check, Pencil, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useAccount } from '../../hooks/useAccount.js';
import { useLinkedServer } from '../../hooks/useLinkedServer.js';
import { avatarValue } from '../../lib/avatars.js';
import { initials } from '../../lib/rail.js';
import {
  accountErrorMessage,
  accountOpenSso,
  accountRename,
  accountRequestCode,
  accountSetAvatar,
  authProviders,
} from '../../lib/tauriBridge.js';
import { PictureButton } from '../PictureButton.js';
import { Portrait } from '../Portrait.js';
import { ToolButton } from '../ToolButton.js';

/**
 * Sign-in only. Accounts are created on the browser join page from an invite
 * (docs/architecture/JOIN-FLOW.md); the app never needs a sign-up flow.
 */
export function AccountSection() {
  const account = useAccount();
  const { status } = account;
  const [server, setServer] = useState<string>();
  const linked = useLinkedServer();
  useEffect(() => {
    if (linked) setServer(linked);
  }, [linked]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeNote, setCodeNote] = useState<string>();
  const [providers, setProviders] = useState<{ oidc: boolean; mail: boolean }>();
  const typedServer = server ?? status?.server ?? '';
  useEffect(() => {
    if (!useCode || typedServer.trim() === '') return;
    let cancelled = false;
    authProviders(typedServer)
      .then((p) => !cancelled && setProviders(p))
      .catch(() => !cancelled && setProviders(undefined));
    return () => {
      cancelled = true;
    };
  }, [useCode, typedServer]);

  if (!status) return null;

  const errorBox = account.error && (
    <Callout.Root color="red" role="alert" size="1">
      <Callout.Text>{account.error}</Callout.Text>
    </Callout.Root>
  );

  if (status.signedIn && status.campaignId === null && status.campaigns.length > 0) {
    return (
      <Flex direction="column" gap="3" p="4">
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
      <Flex direction="column" gap="3" p="4">
        <Flex align="center" gap="3">
          <span className="vtt-av vtt-char-av">
            <Portrait avatarUrl={status.avatarUrl} fallback={initials(status.displayName ?? '?')} />
          </span>
          <Flex direction="column" gap="2">
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
        </Flex>
        <Text color="gray" size="2">
          {campaign
            ? `In ${campaign.name}`
            : 'Not in a campaign yet — join one from your invite link.'}
          <br />
          {status.server}
        </Text>
        {errorBox}
        <Button
          variant="outline"
          color="gray"
          loading={account.busy}
          onClick={() => void account.signOut()}
        >
          Sign out
        </Button>
      </Flex>
    );
  }

  const address = server ?? status.server ?? '';

  async function sendCode() {
    try {
      await accountRequestCode(address, email);
      setCodeNote('If that address has an account, a code is on its way. Paste it below.');
    } catch (e) {
      setCodeNote(accountErrorMessage(e));
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (useCode) void account.signInWithCode(address, code);
        else void account.signIn(address, email, password);
      }}
    >
      <Flex direction="column" gap="3" p="4">
        <Heading size="4">Sign in</Heading>
        <Text size="2" color="gray">
          Use the email and password from your invite link. No account yet? Open the invite link in
          a browser first.
        </Text>
        <TextField.Root
          aria-label="Server"
          placeholder="Server (play.example.com, or http://localhost:3000)"
          value={address}
          onChange={(e) => setServer(e.target.value)}
        />
        <TextField.Root
          type="email"
          aria-label="Email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {useCode ? (
          <>
            <Flex gap="2" wrap="wrap">
              {providers?.oidc && (
                <Button type="button" variant="soft" onClick={() => void accountOpenSso(address)}>
                  Sign in with single sign-on
                </Button>
              )}
              {providers?.mail !== false && (
                <Button
                  type="button"
                  variant="soft"
                  disabled={address.trim() === '' || email === ''}
                  onClick={() => void sendCode()}
                >
                  Email me a code
                </Button>
              )}
            </Flex>
            {codeNote && (
              <Text size="2" color="gray">
                {codeNote}
              </Text>
            )}
            <TextField.Root
              aria-label="Sign-in code"
              placeholder="Code (from email, single sign-on, or your DM)"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </>
        ) : (
          <TextField.Root
            type="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {errorBox}
        <Button
          type="submit"
          size="3"
          loading={account.busy}
          disabled={
            address.trim() === '' ||
            (useCode ? code.trim() === '' : email === '' || password === '')
          }
        >
          Sign in
        </Button>
        <Button type="button" variant="ghost" size="1" onClick={() => setUseCode((v) => !v)}>
          {useCode ? 'Use a password instead' : 'Use a code instead (no password)'}
        </Button>
      </Flex>
    </form>
  );
}

/** Your player name, as the table sees it. Click the pencil to change it; Enter saves, Escape cancels. */
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
      <Flex align="center" gap="2">
        <Heading size="4">{name}</Heading>
        <ToolButton label="Change your player name" onClick={() => setEditing(true)}>
          <Pencil size={14} />
        </ToolButton>
      </Flex>
    );
  }
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <input
          className="vtt-input"
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
