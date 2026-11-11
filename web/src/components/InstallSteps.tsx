import { Button, Code, Flex, Text, VisuallyHidden } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';

import { copyText } from '../lib/clipboard.js';
import type { InstallGuide } from '../types/index.js';

const COPIED_MS = 2000;

/** One command (or any short text, such as an address)  in a block that scrolls sideways, with a Copy button (selects the text if copying is blocked). */
export function Command({ command }: { command: string }) {
  const block = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (await copyText(command, navigator.clipboard)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } else if (block.current) {
      const range = document.createRange();
      range.selectNodeContents(block.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  return (
    <div className="install-command-row">
      <div className="install-command" ref={block}>
        <Code size="2" variant="ghost">
          {command}
        </Code>
      </div>
      <Button type="button" size="1" variant="soft" aria-label="Copy" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <VisuallyHidden>
        <span role="status" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </VisuallyHidden>
    </div>
  );
}

/** The numbered instructions for one platform or package format; commands sit in a scrollable block. */
export function InstallSteps({ guide }: { guide: InstallGuide }) {
  return (
    <ol className="install-steps">
      {guide.steps.map((step, i) => (
        <li key={i}>
          <Flex direction="column" gap="2" className="fit">
            <Text size="2">{step.text}</Text>
            {step.command && <Command command={step.command} />}
          </Flex>
        </li>
      ))}
    </ol>
  );
}
