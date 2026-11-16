import type { ModelView, Pipeline, StatusSnapshot } from '../types/index.js';

/** The one line at the top: what a player wants to know first. */
export function headline(s: StatusSnapshot): { tone: 'ok' | 'warn' | 'down'; text: string } {
  const down = s.services.filter((x) => !x.ok);
  if (down.length === 0) return { tone: 'ok', text: 'Everything is running' };
  const voiceDown = down.some((x) => x.name === 'livekit');
  const appDown = down.some((x) => x.name === 'database' || x.name === 'backend');
  if (appDown) return { tone: 'down', text: 'The server has a problem' };
  if (voiceDown) return { tone: 'warn', text: 'Voice is not working right now' };
  return { tone: 'warn', text: 'Something is degraded' };
}

/** "Idle", "2 waiting", "1 processing", with failures called out. */
export function pipelineLine(p: Pipeline | null): string {
  if (!p) return 'Not reported';
  const parts: string[] = [];
  if (p.running > 0) parts.push(`${p.running} processing`);
  if (p.queued > 0) parts.push(`${p.queued} waiting`);
  if (p.failed > 0) parts.push(`${p.failed} failed`);
  return parts.length > 0 ? parts.join(', ') : 'Idle';
}

/**
 * A model that is not simply ready: "Downloading (43%)", "Download failed", "Download has stalled at 43%".
 * Null when there is nothing worth a row (ready, not reported, or a local AI that is not running by design).
 */
export function modelLine(m: ModelView | null | undefined): string | null {
  switch (m?.state) {
    case 'downloading':
      return `Downloading (${m.percent ?? 0}%)`;
    case 'stalled':
      return `Download has stalled at ${m.percent ?? 0}%`;
    case 'failed':
      return 'Download failed';
    default:
      return null;
  }
}

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** "0.5.0 (protocol 3)"; a dev build keeps its suffix ("0.5.1-dev.1"). */
export function versionLine(v: { version: string; protocol: number }): string {
  return `${v.version} (protocol ${v.protocol})`;
}
