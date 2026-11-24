import { Card, Flex, Heading, Switch, Text } from '@radix-ui/themes';
import { READING_SWITCHES, useReadingPrefs } from '@vtt-chat-app/ui-kit';

/** How text is drawn on this device: the language and handout fonts, and a way to turn them all off. */
export function ReadingCard() {
  const prefs = useReadingPrefs();
  return (
    <Card size="3" aria-labelledby="account-reading">
      <Flex direction="column" gap="3">
        <Heading size="4" as="h2" id="account-reading">
          Reading
        </Heading>
        {READING_SWITCHES.map((s) => (
          <Flex key={s.key} align="center" justify="between" gap="4">
            <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
              <Text size="2">{s.label}</Text>
              <Text size="1" color="gray">
                {s.hint}
              </Text>
            </Flex>
            <Switch
              checked={prefs[s.key]}
              onCheckedChange={(on) => prefs.set({ [s.key]: on })}
              aria-label={s.label}
            />
          </Flex>
        ))}
        <Text size="1" color="gray">
          Kept on this device only.
        </Text>
      </Flex>
    </Card>
  );
}
