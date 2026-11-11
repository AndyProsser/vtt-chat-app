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
generic icon in the dock and the app is missing from the application menu. There are two ways to fix that, and
you only need one. Or skip all of this and use the `.deb` or `.rpm`.

**1. A helper app (works for every AppImage, not just this one).** Either one adds the entry and icon when you
open the file. **AppImageLauncher is the one to try first**: you install it once and every AppImage you open
after that is handled the same way.

|                  | AppImageLauncher                                                                                                                                                                 | Gear Lever                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| What it is       | A small system service. Opening any AppImage asks "Integrate and run" or "Run once"; integrating moves the file to `~/Applications` and adds the entry and icon.                 | A window that lists your AppImages and manages each one (integrate, update, remove).           |
| Install          | Download the `.deb` (Ubuntu, Debian) or `.rpm` (Fedora) from the [releases page](https://github.com/TheAssassin/AppImageLauncher/releases) and install it as in the table above. | `flatpak install flathub it.mijorus.gearlever`, or search "Gear Lever" in the App Center.      |
| After installing | Double-click the VTT Chat AppImage and choose **Integrate and run**.                                                                                                             | Open Gear Lever, drop the AppImage on it, and click **Unlock**, then **Move to the app menu**. |
| Good to know     | Its newest builds are labelled beta (3.0), but they are what the project publishes for current Ubuntu and Fedora. Log out and in once after installing.                          | Comes from Flathub, so it updates with your system and needs no `sudo`.                        |

**2. A script (no extra software).** Do not combine this with AppImageLauncher: it watches `~/Applications` and
adds its own entry for every AppImage it finds there, so you would get two icons. This script keeps the file in
`~/.local/opt` instead and writes only inside your home folder (no `sudo`).

```bash
curl -fsSL https://raw.githubusercontent.com/AndyProsser/vtt-chat-app/main/tauri-client/scripts/install-appimage.sh -o install-appimage.sh
less install-appimage.sh          # read it first if you like
bash install-appimage.sh          # uses the newest VTT.Chat*.AppImage in ~/Downloads, or pass its path
```

It copies the AppImage to `~/.local/opt/VTT.Chat.AppImage`, pulls the real icon out of it, and writes
`~/.local/share/applications/vtt-chat-app.desktop` with the icon given by full path (so no icon cache can hide it).
Log out and back in once, then open **VTT Chat** from the menu. To update by hand, run the script again with the
new file. (The app's own updater replaces the file in place and the entry keeps working.)

**Undo it:** `bash install-appimage.sh --remove`.

**Two icons, or no icon?** Look at what is in your own applications folder:

```bash
ls ~/.local/share/applications | grep -i -E 'vtt|appimagekit'
```

- Entries starting `appimagekit_` were made by AppImageLauncher; `vtt-chat-app.desktop` is the manual one.
  `vtt-chat-app-handler.desktop` is the app's own link handler and is hidden; leave it. Keep one of the other
  two and delete the rest. With AppImageLauncher, remove its entry properly with `ail-cli unintegrate <the AppImage>`
  (or its settings window), not by deleting files.
- If an icon still shows as a generic gear after you fixed the files, the desktop is showing an old cached
  picture. Run `gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor` (ignore an error if that folder does
  not exist), then log out and back in. A running GNOME session on Wayland cannot reload its icons any other way.

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

## Updates

After the first install the app updates itself (a banner offers "Restart to update"). Updates are signed with
the project's own key, and the app checks that signature, so the warnings above only appear on the first
install. See [CLIENT-UPDATES.md](../architecture/CLIENT-UPDATES.md) for how that works.
