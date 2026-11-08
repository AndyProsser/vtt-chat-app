const KEY = 'vtt.monitorEffects';

/** Whether the DM hears sound effects on their own speakers too. On unless they turned it off. */
export function readMonitorPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeMonitorPref(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* kept for this session only */
  }
}
