export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 6;
const STEP = 1.25;

/** Keeps a zoom factor inside the range the viewer allows. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** One step in (`1`) or out (`-1`), rounded so repeated steps return to exactly 1. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = direction === 1 ? zoom * STEP : zoom / STEP;
  return clampZoom(Math.round(next * 1000) / 1000);
}

export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}
