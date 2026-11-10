import { Select } from '@radix-ui/themes';

export interface DropdownOption {
  value: string;
  label: string;
}

/** Radix Select cannot hold an empty string, so "no choice" is stored under this and mapped back. */
const EMPTY = '__empty__';

/**
 * The one dropdown for the whole app. It is always the styled Radix list, never the operating system's
 * native select popup (which looks out of place and stretches to the full screen height in a small
 * window). The list opens directly under the control and is capped to the room the window has left.
 */
export function Dropdown({
  value,
  options,
  onChange,
  label,
  width,
  disabled,
  placeholder,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  label: string;
  /** Minimum width of the control in px; it grows to fit its longest choice. */
  width?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const key = (v: string) => (v === '' ? EMPTY : v);
  return (
    <Select.Root
      size="1"
      value={key(value)}
      disabled={disabled}
      onValueChange={(v) => onChange(v === EMPTY ? '' : v)}
    >
      <Select.Trigger
        aria-label={label}
        {...(placeholder ? { placeholder } : {})}
        style={{ minWidth: width ?? 90 }}
      />
      <Select.Content position="popper" sideOffset={4} className="vtt-dropdown">
        {options.map((o) => (
          <Select.Item key={key(o.value)} value={key(o.value)}>
            {o.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
