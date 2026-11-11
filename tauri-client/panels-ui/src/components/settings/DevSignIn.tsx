import { Button, Callout, Flex, Text, TextField } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import type { AccountApi } from '../../hooks/useAccount.js';
import { parseConnectLink } from '../../lib/connectLink.js';
import {
  accountErrorMessage,
  accountOpenSso,
  accountRequestCode,
  authProviders,
  devSigninEnabled,
} from '../../lib/tauriBridge.js';

interface Props {
  account: AccountApi;
  server: string;
  onServer: (server: string) => void;
  onCode: (code: string) => void;
}

/**
 * Developer sign-in: the old email/password, emailed-code and single sign-on forms, plus pasting a
 * connect link. Rust only honours these commands when started with VTT_DEV_SIGNIN, so this block
 * renders only when `dev_signin_enabled` says so.
 */
export function DevSignIn(props: Props) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    devSigninEnabled()
      .then((on) => !cancelled && setEnabled(on))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, []);
  if (!enabled) return null;
  return <DevForms {...props} />;
}

function DevForms({ account, server, onServer, onCode }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeNote, setCodeNote] = useState<string>();
  const [pasted, setPasted] = useState('');
  const [pasteNote, setPasteNote] = useState<string>();
  const [providers, setProviders] = useState<{ oidc: boolean; mail: boolean }>();
  const address = server.trim();

  useEffect(() => {
    if (address === '') return;
    let cancelled = false;
    authProviders(address)
      .then((p) => !cancelled && setProviders(p))
      .catch(() => !cancelled && setProviders(undefined));
    return () => {
      cancelled = true;
    };
  }, [address]);

  async function sendCode() {
    try {
      await accountRequestCode(address, email);
      setCodeNote('If that address has an account, a code is on its way. Paste it below.');
    } catch (e) {
      setCodeNote(accountErrorMessage(e));
    }
  }

  function usePasted(text: string) {
    setPasted(text);
    if (text.trim() === '') return setPasteNote(undefined);
    const link = parseConnectLink(text);
    if (!link) return setPasteNote('That is not a vtt-chat://connect link.');
    onServer(link.server);
    if (link.code) onCode(link.code);
    setPasteNote(
      `Filled in ${link.server}${link.code ? ' and the code' : ''}. Press Connect above.`,
    );
  }

  return (
    <Flex direction="column" gap="3" pb="4">
      <details>
        <summary>
          <Text size="2" color="gray">
            Developer sign-in
          </Text>
        </summary>
        <Flex direction="column" gap="3" pt="3">
          <TextField.Root
            aria-label="Paste a connect link"
            placeholder="Paste a connect link (vtt-chat://connect?…)"
            value={pasted}
            onChange={(e) => usePasted(e.target.value)}
          />
          {pasteNote && (
            <Text size="2" color="gray">
              {pasteNote}
            </Text>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void account.signIn(address, email, password);
            }}
          >
            <Flex direction="column" gap="2">
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
              <Button
                type="submit"
                loading={account.busy}
                disabled={address === '' || email === '' || password === ''}
              >
                Sign in with password
              </Button>
            </Flex>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void account.signInWithCode(address, code);
            }}
          >
            <Flex direction="column" gap="2">
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
                    disabled={address === '' || email === ''}
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
              <Button
                type="submit"
                variant="soft"
                loading={account.busy}
                disabled={address === '' || code.trim() === ''}
              >
                Sign in with code
              </Button>
            </Flex>
          </form>
          {account.error && (
            <Callout.Root color="red" role="alert" size="1">
              <Callout.Text>{account.error}</Callout.Text>
            </Callout.Root>
          )}
        </Flex>
      </details>
    </Flex>
  );
}
