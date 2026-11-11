# Installing the app

For players. The app is not signed with a paid Windows or Apple certificate, because those cost money every
year and this project is run by a group of friends, not a company. Your computer therefore warns you the first
time. The warning is about who published the app, not about anything found inside it. Only install it from
the link your DM or server operator gave you.

## Windows

1. Download the `.exe` installer (the `.msi` does the same job and suits managed PCs) and run it.
2. If a blue **"Windows protected your PC"** window appears, click **More info**, then **Run anyway**.
3. If your browser says the file is "not commonly downloaded", keep it: in Edge choose **Keep**, then
   **Keep anyway**; in Chrome choose **Keep**.

4. The installer asks whether to install for **just you** (no administrator rights needed) or for **all users**
   of the PC (asks for administrator permission). If you are not sure, choose just you. The `.msi` always installs for all users.

The warning goes away on its own as more people install the same file.

## macOS (Apple silicon: M1 and later)

1. Open the `.dmg` and drag the app into **Applications**.
2. Try to open it. macOS says it **cannot be opened** or **is damaged**. It is not damaged; this is the
   unsigned-app block.
3. Open **System Settings → Privacy & Security**, scroll to the message about the app, and click
   **Open Anyway**. Confirm with your password. (On macOS 14 and older you can instead right-click the app
   and choose **Open**.)
4. If **Open Anyway** never appears, run this once in Terminal, then open the app again:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/VTT Chat.app"
   ```

Intel Macs are not supported yet.

## Linux

Pick the one that suits your system. All three are the same app. **If you can, use the `.deb` or `.rpm`**: they
add the menu entry, the icon and the tray library for you. The AppImage runs anywhere, but you have to give it
its menu entry and icon yourself (see [below](#appimage-menu-entry-and-icon)).

| File        | Use it on                                                             | How                                                                                                           |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.AppImage` | Any distribution. Updates itself. Needs its menu entry added by hand. | `chmod +x *.AppImage`, then run it. If it will not start, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04). |
| `.deb`      | Debian, Ubuntu, Mint, Pop!_OS                                         | `sudo apt install ./VTT.Chat_*.deb`                                                                           |
| `.rpm`      | Fedora, RHEL, openSUSE                                                | `sudo dnf install ./VTT.Chat-*.rpm` (`sudo zypper install` on openSUSE)                                       |

The AppImage needs a menu entry and icon of its own: see [AppImage: menu entry and icon](#appimage-menu-entry-and-icon).

The `.deb` and `.rpm` do not update themselves; install the newer file when a new version is announced.

The app is called **VTT Chat** and has its icon in the application menu, the taskbar or dock, and the tray.

- **KDE Plasma:** the tray icon appears in the system tray by itself. The app is filed under Internet.
- **GNOME:** the tray icon needs the **AppIndicator** extension (Ubuntu ships it on; on Fedora install
  `gnome-shell-extension-appindicator` and enable it). Without it the app still runs and opens from the menu.
- On Wayland, global hotkeys may not work; the app tells you when that is the case.

### AppImage: menu entry and icon

An AppImage is a single file, so the desktop does not know it exists: with nothing else, GNOME and KDE show a
generic icon in the dock and the app is missing from the application menu. One command fixes that. Or skip all
of this and use the `.deb` or `.rpm`.

Download the AppImage (it lands in `~/Downloads`), then run:

```bash
curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/tauri-client/scripts/install-appimage.sh | bash
```

Then open **VTT Chat** from your application menu. If the icon looks generic, run the icon-cache command under
"No icon, or a generic one?" below, or log out and back in once.

> **"curl: command not found"?** Minimal installs of Ubuntu and Debian do not include `curl`. Install it with
> `sudo apt install curl` (Fedora: `sudo dnf install curl`), or use `wget`, which is often already there:
> `wget -qO- https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/tauri-client/scripts/install-appimage.sh | bash`

What it does, all inside your home folder (no `sudo`): copies the newest `VTT.Chat*.AppImage` in `~/Downloads` to
`~/.local/opt/VTT.Chat.AppImage`, pulls the real icon out of it, and writes
`~/.local/share/applications/vtt-chat-app.desktop` with the icon given by full path, so no icon cache can hide it.
The script is short and readable if you would rather check it first (download it with `curl -fsSL URL -o install-appimage.sh`,
look at it, then `bash install-appimage.sh`).

| To…                                 | Run                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Use an AppImage from somewhere else | add `-s -- /path/to/VTT.Chat.AppImage` after `bash` (so `… \| bash -s -- /path/to/file`) |
| Update to a newer AppImage by hand  | download it and run the same command again                                               |
| Remove it                           | add `-s -- --remove` after `bash`                                                        |

The app's own updater replaces the file in place, and the entry keeps working.

**No icon, or a generic one?** Check what is in your applications folder:

```bash
ls ~/.local/share/applications | grep -i vtt
```

`vtt-chat-app.desktop` is the entry the script made. `vtt-chat-app-handler.desktop` is the app's own hidden link
handler; leave it. If the icon looks generic, the desktop is showing an old cached picture. Run
`gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor` (ignore an error if that folder does not exist). On
Ubuntu 24.04 that was enough to show the icon straight away; the install script now runs it for you. If the icon is
still generic, log out and back in.

### Linux: I cannot see the tray icon

The app still works without it: open **VTT Chat** from your application menu. The tray icon is only a shortcut
that shows whether you are live, muted or being recorded, so it is worth fixing.

**Why it happens.** GNOME removed its built-in tray. A small extension, **AppIndicator and
KStatusNotifierItem Support**, brings tray icons back to the top bar. Ubuntu includes it and turns it on. Plain
GNOME, Fedora, Debian and minimal installs often do not. KDE Plasma and most other desktops show tray icons
without any extension.

**Fix it (GNOME, including Ubuntu):**

1. Check whether it is installed and on:

   ```bash
   gnome-extensions list | grep -i appindicator
   ```

2. If nothing is printed, install it, then **log out and back in** (GNOME only loads new extensions at login):

   | Your system   | Install with                                             |
   | ------------- | -------------------------------------------------------- |
   | Ubuntu        | `sudo apt install gnome-shell-ubuntu-extensions`         |
   | Debian        | `sudo apt install gnome-shell-extension-appindicator`    |
   | Fedora        | `sudo dnf install gnome-shell-extension-appindicator`    |
   | Arch, Manjaro | `sudo pacman -S gnome-shell-extension-appindicator`      |
   | openSUSE      | `sudo zypper install gnome-shell-extension-appindicator` |

3. Turn it on. Either open the **Extensions** app and switch on "AppIndicator and KStatusNotifierItem
   Support", or run one of these (the name differs by distribution; use whichever `list` showed):

   ```bash
   gnome-extensions enable ubuntu-appindicators@ubuntu.com        # Ubuntu
   gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com # Fedora, Debian, others
   ```

4. Quit VTT Chat (if it is running, use the tray menu or `pkill vtt-chat-app`) and start it again.

**Still nothing?**

- **AppImage only:** the tray also needs the AppIndicator library. Install `libayatana-appindicator3-1`
  (Ubuntu, Debian) or `libappindicator-gtk3` (Fedora). The `.deb` and `.rpm` bring it along.
- **KDE Plasma:** open **System Tray Settings** and make sure "vtt-chat" is set to **Always shown** (it can be
  hidden in the overflow arrow).
- **In a virtual machine** the top bar can be slow to show new icons. Log out and in, then try again.
- Still stuck? Tell your operator your distribution and desktop (`echo $XDG_CURRENT_DESKTOP`) and whether you
  used the AppImage, `.deb` or `.rpm`.

## First run: connect the app

The app has no sign-in form and never asks for your password. You create your account on the **join page** in a
browser (the link, code or QR your DM gave you), then connect the app from there:

1. On the join page, after you have joined the campaign, you reach the **Connect** step.
2. Install and open the app, then do **one** of these:
   - click **Open VTT Chat** on the page (the browser asks to open the app: allow it); or
   - scan the **QR code** with your phone and approve "Connect VTT Chat" there; or
   - type the short code (like `ABCD-2345`) into the app's Connect screen. Use this if the button does nothing,
     which can happen with the Linux AppImage.
3. Codes last 5 minutes. If one expires, the page shows a new one.

If the app shows a code of its own instead, open the address it shows (or scan its QR) in any browser where you
are signed in, and press **Approve**. If the app says the recording notice changed, accept it on the join page
first, then connect again.

## Updates

After the first install the app updates itself (a banner offers "Restart to update"). Updates are signed with
the project's own key, and the app checks that signature, so the warnings above only appear on the first
install. See [CLIENT-UPDATES.md](../architecture/CLIENT-UPDATES.md) for how that works.
