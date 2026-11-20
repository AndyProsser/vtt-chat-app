import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDragPan } from '../hooks/useDragPan.js';
import { useFillHeight } from '../hooks/useFillHeight.js';
import { clampZoom, stepZoom, zoomLabel } from '../lib/zoom.js';
import { ToolButton } from './ToolButton.js';

/**
 * A picture with zoom controls: buttons, the mouse wheel with Ctrl held, and drag to move around once it is larger
 * than the window. It opens fitted (all of it visible, centred) and the Fit button returns to that. The zoom is a
 * multiple of the fitted size. View mode only; the handouts list keeps its plain picture.
 */
export function ImageZoom({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const height = useFillHeight(frame);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const [box, setBox] = useState<{ width: number; height: number }>();
  const pan = useDragPan(frame, true);

  // The frame's size, kept up to date, so "fitted" means fitted to what is on screen now.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const read = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitScale =
    natural && box
      ? Math.min(1, (box.width - 4) / natural.width, (box.height - 4) / natural.height)
      : 1;
  const width = natural ? Math.round(natural.width * fitScale * zoom) : undefined;

  return (
    <div className="vtt-zoom">
      <div className="vtt-zoom-bar">
        <ToolButton label="Zoom out" onClick={() => setZoom((z) => stepZoom(z, -1))}>
          <ZoomOut size={14} />
        </ToolButton>
        <span className="vtt-zoom-level" aria-live="polite">
          {zoomLabel(zoom)}
        </span>
        <ToolButton label="Zoom in" onClick={() => setZoom((z) => stepZoom(z, 1))}>
          <ZoomIn size={14} />
        </ToolButton>
        <ToolButton label="Fit the picture to the window" onClick={() => setZoom(1)}>
          <Maximize size={14} />
        </ToolButton>
      </div>
      <div
        ref={frame}
        className="vtt-zoom-frame vtt-zoom-pannable"
        style={height === undefined ? undefined : { height }}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        }}
        {...pan}
      >
        <img
          src={src}
          alt={alt}
          style={width === undefined ? { maxWidth: '100%' } : { width }}
          draggable={false}
          onLoad={(e) =>
            setNatural({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
        />
      </div>
    </div>
  );
}
