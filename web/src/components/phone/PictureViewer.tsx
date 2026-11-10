import { Button, Flex, IconButton, Text, Theme } from '@radix-ui/themes';
import { useEffect, useRef, useState } from 'react';

import { flip, swipeOf } from '../../lib/phone/gallery.js';

/**
 * A handout's pictures full screen: flip between them with the buttons or a sideways swipe, and zoom
 * in to pan around a map. A swipe only flips while the picture fits the screen; zoomed in, a drag pans.
 */
export function PictureViewer({
  urls,
  title,
  start,
  onClose,
}: {
  urls: string[];
  title: string;
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const down = useRef<{ x: number; y: number } | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function go(direction: 1 | -1) {
    setIndex((i) => flip(i, urls.length, direction));
    setZoomed(false);
  }

  // Always the dark theme inside, whatever the phone is set to: a map reads the same either way.
  return (
    <Theme appearance="dark" hasBackground={false}>
      <div className="phone-viewer" role="dialog" aria-modal="true" aria-label={title}>
        <Flex align="center" justify="between" gap="3" className="phone-viewer-bar">
          <Text size="2" className="phone-viewer-title">
            {title}
            {urls.length > 1 ? ` · ${index + 1} of ${urls.length}` : ''}
          </Text>
          <Flex gap="2">
            <Button variant="soft" onClick={() => setZoomed((z) => !z)} aria-pressed={zoomed}>
              {zoomed ? 'Fit' : 'Zoom'}
            </Button>
            <Button onClick={onClose}>Close</Button>
          </Flex>
        </Flex>
        <div
          className={zoomed ? 'phone-viewer-stage is-zoomed' : 'phone-viewer-stage'}
          onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
          onPointerUp={(e) => {
            const from = down.current;
            down.current = undefined;
            if (!from || zoomed) return;
            const direction = swipeOf(e.clientX - from.x, e.clientY - from.y);
            if (direction !== 0) go(direction);
          }}
        >
          <img src={urls[index]} alt={`${title}, picture ${index + 1}`} draggable={false} />
        </div>
        {urls.length > 1 && (
          <Flex justify="center" gap="3" className="phone-viewer-nav">
            <IconButton
              size="3"
              variant="soft"
              aria-label="Previous picture"
              onClick={() => go(-1)}
            >
              ‹
            </IconButton>
            <IconButton size="3" variant="soft" aria-label="Next picture" onClick={() => go(1)}>
              ›
            </IconButton>
          </Flex>
        )}
      </div>
    </Theme>
  );
}
