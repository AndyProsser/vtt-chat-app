import { Box, Button, Card, Flex, Heading, Link, Text } from '@radix-ui/themes';
import { useEffect, useState } from 'react';

import heroVideo from '../assets/hero.mp4';
import hero1100 from '../assets/hero-1100.webp';
import hero600 from '../assets/hero-600.webp';
import { useSession } from '../hooks/useSession.js';
import { useHeroMotion } from '../hooks/useHeroMotion.js';
import { signupRequestsAvailable } from '../lib/api.js';
import { Banner } from './Banner.js';
import { CodeEntry } from './CodeEntry.js';
import { GetTheApp } from './GetTheApp.js';
import { LoginForm } from './LoginForm.js';
import { RequestAccount } from './RequestAccount.js';

type View = 'home' | 'signin';

/**
 * What the server at this address is, and the three things a visitor can do: join with an invite code,
 * sign in (with a password, an emailed code, or a code the operator handed over), or get the app.
 */
export function LandingPage() {
  const [view, setView] = useState<View>('home');
  const { signedIn, checked, onSignedIn } = useSession();
  const [canRequest, setCanRequest] = useState(false);
  const motion = useHeroMotion();

  useEffect(() => {
    void signupRequestsAvailable().then(setCanRequest);
  }, []);

  return (
    <Flex className="join-shell" direction="column" gap="4">
      <Banner
        size="hero"
        src={hero1100}
        srcSet={`${hero600} 600w, ${hero1100} 1100w`}
        video={motion ? heroVideo : undefined}
      >
        <Heading size="6">Your table, in one place.</Heading>
        <Text size="2">Voice, chat and a record of every session.</Text>
      </Banner>
      <Card className="join-card" size="4">
        <Flex direction="column" gap="4">
          {!checked ? null : signedIn ? (
            <GetTheApp />
          ) : view === 'signin' ? (
            <Flex direction="column" gap="3">
              <Heading size="3">Sign in</Heading>
              <LoginForm onSignedIn={onSignedIn} />
              <Button variant="ghost" onClick={() => setView('home')}>
                Back
              </Button>
            </Flex>
          ) : (
            <>
              <Text color="gray">
                Voice chat for your tabletop group, with a searchable record of every session. It
                lives in your system tray, stays quiet until you need it, and runs on a server your
                group controls.
              </Text>
              <Flex direction="column" gap="2">
                <Heading size="3">Joining a table?</Heading>
                <CodeEntry
                  onSubmit={(code) => window.location.assign(`/join/${encodeURIComponent(code)}`)}
                />
              </Flex>
              <Flex direction="column" gap="2">
                <Heading size="3">Already have an account?</Heading>
                <Button variant="soft" size="3" onClick={() => setView('signin')}>
                  Sign in
                </Button>
              </Flex>
              {canRequest && (
                <Flex direction="column" gap="2">
                  <Heading size="3">Request an account</Heading>
                  <RequestAccount />
                </Flex>
              )}
              <Box>
                <Text size="1" color="gray">
                  New here? Ask your DM for an invite code.{' '}
                  <Link href="/status">Server status</Link>
                </Text>
              </Box>
            </>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}
