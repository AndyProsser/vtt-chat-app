import { Badge, Button, Callout, Flex, Heading, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

import { useAccount } from '../hooks/useAccount.js';

/**
 * Sign-in only. Accounts are created on the browser join page from an invite
 * (docs/architecture/JOIN-FLOW.md); the app never needs a sign-up flow.
 */
export function AccountPanel() {
  const account = useAccount();
  const { status } = account;
  const [server, setServer] = useState<string>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

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
        <Heading size="4">{status.displayName ?? 'Signed in'}</Heading>
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
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void account.signIn(address, email, password);
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
          placeholder="Server (e.g. play.example.com)"
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
        <TextField.Root
          type="password"
          aria-label="Password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {errorBox}
        <Button
          type="submit"
          size="3"
          loading={account.busy}
          disabled={address.trim() === '' || email === '' || password === ''}
        >
          Sign in
        </Button>
      </Flex>
    </form>
  );
}
