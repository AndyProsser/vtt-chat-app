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
   xattr -dr com.apple.quarantine "/Applications/VTT Chat App.app"
   ```

Intel Macs are not supported yet.

## Linux

Pick the one that suits your system. All three are the same app.

| File        | Use it on                         | How                                                                                                           |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `.AppImage` | Any distribution. Updates itself. | `chmod +x *.AppImage`, then run it. If it will not start, install `libfuse2` (`libfuse2t64` on Ubuntu 24.04). |
| `.deb`      | Debian, Ubuntu, Mint, Pop!_OS     | `sudo apt install ./VTT.Chat.App_*.deb`                                                                       |
| `.rpm`      | Fedora, RHEL, openSUSE            | `sudo dnf install ./VTT.Chat.App-*.rpm` (`sudo zypper install` on openSUSE)                                   |

The `.deb` and `.rpm` do not update themselves; install the newer file when a new version is announced.

The app lives in the system tray. GNOME needs the **AppIndicator** extension to show a tray icon, and on Wayland
the global hotkeys may not work; the app tells you when that is the case.

## Updates

After the first install the app updates itself (a banner offers "Restart to update"). Updates are signed with
the project's own key, and the app checks that signature, so the warnings above only appear on the first
install. See [CLIENT-UPDATES.md](../architecture/CLIENT-UPDATES.md) for how that works.
