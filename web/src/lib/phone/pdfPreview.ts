/**
 * Draws page 1 of a PDF onto a canvas, scaled to `cssWidth` CSS pixels wide, and returns the canvas height in CSS
 * pixels. The reader (pdf.js) is loaded only when a PDF handout is opened, so the chat does not carry it. Throws if
 * the file cannot be read; the caller then shows only the "Open the PDF" button.
 */
export async function renderFirstPage(
  blob: Blob,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const ratio = window.devicePixelRatio || 1;
    const unit = page.getViewport({ scale: 1 });
    const scale = cssWidth / unit.width;
    const viewport = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    return Math.floor(unit.height * scale);
  } finally {
    void task.destroy();
  }
}
