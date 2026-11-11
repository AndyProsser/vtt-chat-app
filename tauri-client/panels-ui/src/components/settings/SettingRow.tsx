import { Flex, Text } from '@radix-ui/themes';
import type { ReactNode } from 'react';

/** One setting: a label (and optional hint) on the left, its control on the right; the same shape everywhere in Settings. */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <Flex align="center" justify="between" gap="4" py="2" className="vtt-setting-row">
      <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
        <Text size="2">{label}</Text>
        {hint && (
          <Text size="1" color="gray">
            {hint}
          </Text>
        )}
      </Flex>
      <div style={{ flex: 'none' }}>{children}</div>
    </Flex>
  );
}
