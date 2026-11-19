import { Button } from '@radix-ui/themes';

/** The one Back button, so every screen that goes back looks and reads the same. */
export function BackButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="soft" onClick={onClick} {...(disabled ? { disabled } : {})}>
      Back
    </Button>
  );
}
