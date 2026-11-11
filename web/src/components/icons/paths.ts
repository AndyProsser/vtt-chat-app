/**
 * Path data copied from lucide (ISC licence) so the web app uses the same shapes as the desktop app's
 * panels-ui. Rects and circles are written as paths so one renderer covers every icon.
 * Desktop mapping: Handouts = FileText, History = ScrollText, Sessions = CalendarClock, copy = Copy, tick = Check.
 * The desktop has no chat tab (chat is its main window), so Chat uses lucide's MessageSquare.
 */
export const ICON_PATHS = {
  chat: [
    'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
  ],
  sessions: [
    'M16 14v2.2l1.6 1',
    'M16 2v3',
    'M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338',
    'M3 9h5.859',
    'M8 2v3',
    'M10 16a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  ],
  handouts: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M10 9H8',
    'M16 13H8',
    'M16 17H8',
  ],
  history: [
    'M15 12h-5',
    'M15 8h-5',
    'M19 17V5a2 2 0 0 0-2-2H4',
    'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
  ],
  copy: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ],
  check: ['M20 6 9 17l-5-5'],
} as const;

export type IconName = keyof typeof ICON_PATHS;
