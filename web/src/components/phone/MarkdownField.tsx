import { SegmentedControl, Text, TextArea } from '@radix-ui/themes';
import { useState } from 'react';

import { previewOf } from '../../lib/phone/markdownPreview.js';
import { counter, nearLimit } from '../../lib/phone/noteForm.js';
import { LazyMarkdown } from './LazyMarkdown.js';

/** A Markdown text box with a Write / Preview switch (the preview is what players will read) and a length counter. */
export function MarkdownField({
  id,
  label,
  value,
  onChange,
  max,
  rows,
  placeholder,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (text: string) => void;
  max: number;
  rows: number;
  placeholder: string;
  error?: string | undefined;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const preview = previewOf(value);
  return (
    <div className="phone-field">
      <div className="phone-field-row">
        <label htmlFor={id} className="phone-label">
          {label}
        </label>
        <SegmentedControl.Root
          size="1"
          value={mode}
          onValueChange={(v) => setMode(v as 'write' | 'preview')}
          aria-label={`${label}: write or preview`}
        >
          <SegmentedControl.Item value="write">Write</SegmentedControl.Item>
          <SegmentedControl.Item value="preview">Preview</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>
      {mode === 'write' ? (
        <TextArea
          id={id}
          size="3"
          rows={rows}
          resize="vertical"
          value={value}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="phone-preview" aria-label={`${label}, preview`}>
          {preview.kind === 'empty' ? (
            <Text color="gray">Nothing to preview yet.</Text>
          ) : (
            <LazyMarkdown text={preview.text} />
          )}
        </div>
      )}
      <div id={`${id}-help`} className="phone-field-foot">
        {error ? (
          <Text size="1" color="red" role="alert">
            {error}
          </Text>
        ) : (
          <Text size="1" color="gray">
            Markdown: **bold**, *italic*, # heading, - list, &gt; quote
          </Text>
        )}
        <Text
          size="1"
          color={value.length > max ? 'red' : nearLimit(value.length, max) ? 'amber' : 'gray'}
          className="phone-count"
        >
          {counter(value.length, max)}
        </Text>
      </div>
    </div>
  );
}
