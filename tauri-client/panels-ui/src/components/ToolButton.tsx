import { Tooltip } from '@radix-ui/themes';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /** What it does: the tooltip text and the accessible name. */
  label: string;
  children: ReactNode;
  pressed?: boolean;
  square?: boolean;
  danger?: boolean;
  /** Submits the surrounding form instead of just calling `onClick`. */
  submit?: boolean;
  /** An optional count or short text shown beside the icon. */
  text?: string;
}

/**
 * An icon-only button with a text tip: the app's default control (icons over words). It forwards
 * its ref and extra props, so it can be the trigger of a popover.
 */
export const ToolButton = forwardRef<HTMLButtonElement, Props>(function ToolButton(
  { label, children, pressed, square, danger, submit, text, className, ...rest },
  ref,
) {
  const classes = [
    'vtt-tool',
    square ? 'vtt-tool-square' : '',
    pressed ? 'vtt-tool-on' : '',
    danger ? 'vtt-tool-danger' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <Tooltip content={label}>
      <button
        {...rest}
        ref={ref}
        type={submit ? 'submit' : 'button'}
        className={classes}
        aria-label={label}
        aria-pressed={pressed}
      >
        {children}
        {text !== undefined && <span className="vtt-tool-text">{text}</span>}
      </button>
    </Tooltip>
  );
});
