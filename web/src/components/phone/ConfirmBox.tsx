import { Checkbox, Flex, Text } from '@radix-ui/themes';

/** "Added to my sheet": the player's own tick that an item is on their real game sheet (a reminder, nothing more). */
export function ConfirmBox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Text as="label" size="1" color="gray">
      <Flex gap="2" align="center">
        <Checkbox size="1" checked={checked} onCheckedChange={(c) => onChange(c === true)} />
        Added to my sheet
      </Flex>
    </Text>
  );
}
