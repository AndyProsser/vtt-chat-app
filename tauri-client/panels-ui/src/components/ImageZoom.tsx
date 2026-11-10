import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useRef, useState } from 'react';

import { clampZoom, stepZoom, zoomLabel } from '../lib/zoom.js';
import { ToolButton } from './ToolButton.js';

/**
 * A picture with zoom controls: buttons, the mouse wheel with Ctrl held, and drag to move around once it
 * is larger than the window. View mode only; the handouts list keeps its plain picture.
 */
export function ImageZoom({ src, alt }: { src: string; alt: string }) {
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

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
        <ToolButton label="Fit to the window" onClick={() => setZoom(1)}>
          <Maximize size={14} />
        </ToolButton>
      </div>
      <div
        ref={frame}
        className="vtt-zoom-frame"
        data-zoomed={zoom > 1}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom((z) => clampZoom(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        }}
        onPointerDown={(e) => {
          const el = frame.current;
          if (!el || zoom <= 1) return;
          el.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        }}
        onPointerMove={(e) => {
          const el = frame.current;
          const d = drag.current;
          if (!el || !d) return;
          el.scrollLeft = d.left - (e.clientX - d.x);
          el.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img src={src} alt={alt} style={{ width: `${zoom * 100}%` }} draggable={false} />
      </div>
    </div>
  );
}
