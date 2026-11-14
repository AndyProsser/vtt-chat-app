# Status: Online, Away, Offline

Decided 2026-11-10 (Andy). One switch for "am I at the table?", shown to everyone.

| Status      | Voice                           | Microphone                                       | Chat |
| ----------- | ------------------------------- | ------------------------------------------------ | ---- |
| **Online**  | Joined                          | As the player left it                            | On   |
| **Away**    | Joined                          | Closed; reopened on return if it was open before | On   |
| **Offline** | Left (mute control is disabled) | n/a                                              | On   |

- **Every launch starts Offline.** The app never joins voice by itself (it used to, straight after
  sign-in). Online is a deliberate choice.
- **Where to change it:** the tray menu (a Status submenu), the colour-coded pill above the mute button (ONLINE, AWAY, OFFLINE; click for a menu), and
  Settings → Profile. They all call one Rust command, so they cannot disagree.
- **Unmuting while not in voice** asks "Connect to Voice Channel?" (the mute button, and the unmute
  hotkey, which brings the window forward). The tray's Mute item is disabled while Offline.
- **Unmuting by hand while Away** means the player is back: the status becomes Online.
- **A failed voice join** puts the status back to Offline and shows the error.
- **Four things show on the rail**, as a dot on the person's hover card and a dimmed avatar:
  **Online** (green; outlined until they are in voice), **Away** (amber), **Offline** (grey: they
  chose it, chat still works) and **Disconnected** (hollow grey ring, most dimmed: the app is closed
  or they are signed out, so nothing they last chose applies). The dot does not show call quality; the
  DM's connection screen does.

## Away detection

Away is set by hand, or by the app when the player has walked off:

1. **Screen lock or screensaver** starts it. Linux reads GNOME's screensaver signal over D-Bus (at once).
   **Windows** asks, on each 15-second check, whether the lock screen's desktop is up (`OpenInputDesktop`
   fails while it is). **macOS** asks the session dictionary (`ioreg`). The Windows and macOS paths were
   written 2026-11-10 and **have not been run on those systems**: the Windows call compiles against its
   API, the macOS parser is unit-tested on sample text. A Windows UAC prompt also counts as locked for a
   moment; it ends as soon as the prompt closes.
2. **No keyboard or mouse use** for a chosen time (default 10 minutes; 5 to 60, or never; Settings →
   Profile). Linux reads Mutter's idle monitor over D-Bus; Windows and macOS read the system idle time.
3. **Coming back** (unlock, or input within 10 seconds) ends an Away the app set by itself. An Away the
   player chose stays until they change it.

The watcher sleeps while Offline and checks every 15 seconds otherwise, so it costs nothing at idle.

**Not done:** KDE and other Linux desktops without GNOME's D-Bus names (no automatic Away; the manual
status works).

## How it is built

- `status.rs` is the pure rule set (a state machine returning effects: connect, disconnect, set mute),
  fully unit tested. `status_commands.rs` carries the effects out. `away_watch.rs` is the detector.
- The status travels to the server on the existing `audio.state` frame as an optional `status` field.
  The server relays it in `audio.update` and in the roster. A client that sends none is treated as
  online when in voice and offline otherwise, so older clients keep working.
