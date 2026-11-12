import { Button, Flex, Text, TextField } from '@radix-ui/themes';
import { useState } from 'react';

export function CodeEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <Flex direction="column" gap="3">
        <Text color="gray">Enter the invite code your DM sent you.</Text>
        <TextField.Root
          size="3"
          aria-label="Invite code"
          placeholder="ABCD-EFGH"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" size="3">
          Continue
        </Button>
      </Flex>
    </form>
  );
}
