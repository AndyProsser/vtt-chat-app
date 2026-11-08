export type VoiceAction = 'connect' | 'disconnect' | 'wait';

/** What pressing the Connect/Disconnect button does right now. */
export function nextVoiceAction(connected: boolean, busy: boolean): VoiceAction {
  if (busy) return 'wait';
  return connected ? 'disconnect' : 'connect';
}
