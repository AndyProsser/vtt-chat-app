import type { InstallGuide } from '../types/index.js';

/**
 * The words on the download page, one set per platform. They mirror docs/guides/INSTALLING-THE-APP.md
 * (which has the long version and the troubleshooting): keep the two in step. The app is not signed with a
 * paid certificate, so Windows and macOS each need a different "yes, I trust this" step.
 */
export const INSTALL_GUIDE_URL =
  'https://github.com/AndyProsser/vtt-chat-app/blob/main/docs/guides/INSTALLING-THE-APP.md';

export const WINDOWS_GUIDE: InstallGuide = {
  id: 'windows',
  label: 'Windows',
  who: 'Windows 10 and 11, 64-bit.',
  steps: [
    {
      text: 'Download the installer and run it. If your browser says the file is “not commonly downloaded”, choose Keep (in Edge: Keep, then Keep anyway).',
    },
    {
      text: 'If a blue “Windows protected your PC” window appears, click More info, then Run anyway. The app is not signed with a paid certificate, so Windows warns the first time. The warning is about who published it, not about anything inside it.',
    },
    {
      text: 'Choose Just me (no administrator rights needed) or All users of this PC. If you are not sure, choose Just me.',
    },
    {
      text: 'Open VTT Chat from the Start menu. It lives in the system tray at the bottom right (click the ^ arrow if you do not see it).',
    },
  ],
};

export const MACOS_GUIDE: InstallGuide = {
  id: 'macos',
  label: 'macOS',
  who: 'Apple silicon Macs (M1 and later). Intel Macs are not supported yet.',
  steps: [
    { text: 'Open the downloaded .dmg and drag VTT Chat into Applications.' },
    {
      text: 'Open it. macOS says it cannot be opened, or is damaged. It is not damaged: this is the block on apps without a paid Apple certificate.',
    },
    {
      text: 'Open System Settings → Privacy & Security, scroll to the message about VTT Chat and click Open Anyway, then confirm with your password. (On macOS 14 and older you can right-click the app and choose Open instead.)',
    },
    {
      text: 'If Open Anyway never appears, run this once in Terminal and open the app again:',
      command: 'xattr -dr com.apple.quarantine "/Applications/VTT Chat.app"',
    },
    { text: 'VTT Chat lives in the menu bar at the top right of the screen.' },
  ],
};

export const LINUX_GUIDES: readonly InstallGuide[] = [
  {
    id: 'deb',
    label: '.deb',
    who: 'Debian, Ubuntu, Linux Mint, Pop!_OS. Recommended if you can use it.',
    steps: [
      {
        text: 'Download the file, then install it from the folder it landed in. This adds the menu entry, the icon and the tray library for you:',
        command: 'sudo apt install ./VTT.Chat_*.deb',
      },
      { text: 'Open VTT Chat from your application menu.' },
      {
        text: 'The .deb does not update itself: install the newer file when a new version is announced.',
      },
    ],
  },
  {
    id: 'rpm',
    label: '.rpm',
    who: 'Fedora, RHEL, openSUSE. Recommended if you can use it.',
    steps: [
      {
        text: 'Download the file, then install it from the folder it landed in:',
        command: 'sudo dnf install ./VTT.Chat-*.rpm',
      },
      { text: 'On openSUSE use zypper instead:', command: 'sudo zypper install ./VTT.Chat-*.rpm' },
      { text: 'Open VTT Chat from your application menu.' },
      {
        text: 'The .rpm does not update itself: install the newer file when a new version is announced.',
      },
    ],
  },
  {
    id: 'appimage',
    label: 'AppImage',
    who: 'Any distribution. Updates itself.',
    steps: [
      {
        text: 'Download the file and make it runnable:',
        command: 'chmod +x ~/Downloads/VTT.Chat_*.AppImage',
      },
      {
        text: 'Run it. If it will not start, install libfuse2 first (libfuse2t64 on Ubuntu 24.04).',
      },
      {
        text: 'An AppImage is a single file, so your desktop does not know it exists. To add the menu entry and icon (no sudo, all inside your home folder), run:',
        command:
          'curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/tauri-client/scripts/install-appimage.sh | bash',
      },
      {
        text: 'For the tray icon you also need the AppIndicator library: libayatana-appindicator3-1 (Ubuntu, Debian) or libappindicator-gtk3 (Fedora).',
      },
    ],
  },
];

/** Shown under every Linux option. */
export const LINUX_NOTES: readonly string[] = [
  'GNOME needs the AppIndicator extension to show the tray icon (Ubuntu has it on already). Without it the app still works: open it from the menu.',
  'On Wayland, global hotkeys may not work. The app tells you when that is the case.',
];
