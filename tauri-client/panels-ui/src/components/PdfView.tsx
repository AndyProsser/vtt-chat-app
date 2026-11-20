import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useDragPan } from '../hooks/useDragPan.js';
import { useFillHeight } from '../hooks/useFillHeight.js';
import { bytesFromDataUrl } from '../lib/dataUrl.js';
import { clampZoom, stepZoom, zoomLabel } from '../lib/zoom.js';
import { ToolButton } from './ToolButton.js';

/**
 * A PDF drawn page by page inside the window, with the fewest controls that work: previous and next page,
 * and zoom. The reader (pdf.js) is loaded only when a PDF is opened, so it costs nothing otherwise.
 */
/** pdf.js draws at 1.4 times the page's own size at zoom 1 (a letter page is then about 860 pixels wide). */
const BASE_SCALE = 1.4;

export function PdfView({ dataUrl }: { dataUrl: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const pan = useDragPan(frame, true);
  const [pdf, setPdf] = useState<{ numPages: number; getPage: (n: number) => Promise<unknown> }>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string>();
  // The page's size at zoom 1 (the PDF's own units), for "fit to the window"; the first page is fitted before it is drawn.
  const [dims, setDims] = useState<{ width: number; height: number }>();
  const [fitted, setFitted] = useState(false);
  const height = useFillHeight(frame, Boolean(pdf));

  /** Zoom so the whole page is visible in the frame. */
  const fit = () => {
    const el = frame.current;
    if (!el || !dims) return;
    const scale = Math.min((el.clientWidth - 4) / dims.width, (el.clientHeight - 4) / dims.height);
    setZoom(clampZoom(scale / BASE_SCALE));
  };
  // Once the frame has its height and the page its size, fit it, then draw.
  useEffect(() => {
    if (fitted || !dims || height === undefined) return;
    fit();
    setFitted(true);
  }, [dims, height, fitted]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | undefined;
    (async () => {
      const bytes = bytesFromDataUrl(dataUrl);
      if (!bytes) throw new Error('The PDF could not be read.');
      const pdfjs = await import('pdfjs-dist');
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      const task = pdfjs.getDocument({ data: bytes });
      destroy = () => void task.destroy();
      const doc = await task.promise;
      if (!cancelled) {
        setPdf(doc as unknown as typeof pdf);
        setPage(1);
        setFitted(false);
        setDims(undefined);
      }
    })().catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [dataUrl]);

  useEffect(() => {
    const el = canvas.current;
    if (!pdf || !el) return;
    let cancelled = false;
    (async () => {
      const p = (await pdf.getPage(page)) as {
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: unknown) => { promise: Promise<void> };
      };
      const ratio = window.devicePixelRatio || 1;
      const unit = p.getViewport({ scale: 1 });
      if (!cancelled) setDims((d) => d ?? { width: unit.width, height: unit.height });
      if (!fitted) return;
      const viewport = p.getViewport({ scale: BASE_SCALE * zoom * ratio });
      if (cancelled) return;
      el.width = Math.floor(viewport.width);
      el.height = Math.floor(viewport.height);
      el.style.width = `${Math.floor(viewport.width / ratio)}px`;
      el.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const context = el.getContext('2d');
      if (!context) return;
      await p.render({ canvas: el, canvasContext: context, viewport }).promise;
    })().catch((e: unknown) => {
      // A render replaced by the next page is cancelled on purpose; anything else is shown.
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, page, zoom, fitted]);

  if (error) return <span className="vtt-muted">Could not show the PDF: {error}</span>;
  if (!pdf) return <span className="vtt-muted">Loading the PDF…</span>;
  return (
    <div className="vtt-zoom">
      <div className="vtt-zoom-bar">
        <ToolButton
          label="Previous page"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          <ChevronLeft size={14} />
        </ToolButton>
        <span className="vtt-zoom-level">
          {page} / {pdf.numPages}
        </span>
        <ToolButton
          label="Next page"
          disabled={page >= pdf.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight size={14} />
        </ToolButton>
        <ToolButton label="Zoom out" onClick={() => setZoom((z) => stepZoom(z, -1))}>
          <ZoomOut size={14} />
        </ToolButton>
        <span className="vtt-zoom-level">{zoomLabel(zoom)}</span>
        <ToolButton label="Zoom in" onClick={() => setZoom((z) => clampZoom(stepZoom(z, 1)))}>
          <ZoomIn size={14} />
        </ToolButton>
        <ToolButton label="Fit the page to the window" onClick={fit}>
          <Maximize size={14} />
        </ToolButton>
      </div>
      <div
        ref={frame}
        className="vtt-zoom-frame vtt-zoom-pannable"
        style={height === undefined ? undefined : { height }}
        {...pan}
      >
        <canvas ref={canvas} />
      </div>
    </div>
  );
}
