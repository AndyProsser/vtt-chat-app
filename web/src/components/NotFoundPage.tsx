import { Button, Card, Flex, Heading, Text } from '@radix-ui/themes';

import { useSession } from '../hooks/useSession.js';

/** Shown inside the site frame for a path that is not a page (the server sends it with HTTP 404). */
export function NotFoundPage() {
  const { signedIn } = useSession();
  return (
    <Flex className="join-shell" direction="column" gap="4">
      <Card className="join-card" size="4">
        <Flex direction="column" gap="3" align="start">
          <Heading size="6" as="h1">
            Page not found
          </Heading>
          <Text color="gray">
            There is nothing at this address. It may have moved, or the link may be mistyped.
          </Text>
          <Flex gap="3" wrap="wrap">
            <Button asChild>
              <a href="/">Home</a>
            </Button>
            {signedIn && (
              <Button asChild variant="soft">
                <a href="/app">Open chat</a>
              </Button>
            )}
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
