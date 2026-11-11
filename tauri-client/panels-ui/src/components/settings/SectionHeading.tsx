import { Text } from '@radix-ui/themes';

/** A section title with an optional muted description under it; the same shape on every Settings tab. */
export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="vtt-section-head">
      <Text size="3" weight="bold">
        {title}
      </Text>
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </div>
  );
}
