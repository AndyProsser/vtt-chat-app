/** What the desktop app has that the web version does not. */
export const FULL_APP_FEATURES = [
  {
    title: 'Voice',
    text: 'Open-mic group voice with echo cancellation and noise filtering, so a quiet table stays quiet.',
  },
  {
    title: 'Recording consent cue',
    text: 'Everyone hears a clear cue when a session recording starts or stops.',
  },
  {
    title: 'DM soundboard and audio controls',
    text: 'Sound effects, and the DM can adjust their own and each player’s audio.',
  },
  {
    title: 'Tray quick-mute and hotkeys',
    text: 'Mute from the system tray or a hotkey while you play. The app stays out of the way.',
  },
] as const;
