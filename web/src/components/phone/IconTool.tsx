import { Tooltip } from '@radix-ui/themes';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

import { Icon } from '../icons/index.js';
import type { IconName } from '../icons/paths.js';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  /** What it does: the tooltip and the accessible name. */
  label: string;
  icon: IconName;
  /** Shown beside the icon (for the actions on a card, where a bare icon would be a guess). */
  text?: string;
  danger?: boolean;
  submit?: boolean;
}

/** An icon button with a tip: the same gold-outline control the desktop app uses (its ToolButton). */
export const IconTool = forwardRef<HTMLButtonElement, Props>(function IconTool(
  { label, icon, text, danger, submit, className, ...rest },
  ref,
) {
  return (
    <Tooltip content={label}>
      <button
        {...rest}
        ref={ref}
        type={submit ? 'submit' : 'button'}
        aria-label={label}
        className={['phone-tool', danger ? 'phone-tool-danger' : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
      >
        <Icon name={icon} size={18} />
        {text !== undefined && <span className="phone-tool-text">{text}</span>}
      </button>
    </Tooltip>
  );
});
