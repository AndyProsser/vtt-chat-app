#!/usr/bin/env bash
# Adds the VTT Chat AppImage to your application menu and dock, with its icon. An AppImage is a single file the
# desktop knows nothing about; this gives it a home, a menu entry and an icon, all inside your own home folder
# (no sudo, nothing system-wide).
#
#   install-appimage.sh [path/to/VTT.Chat_x.y.z_amd64.AppImage]   (default: the newest one in ~/Downloads)
#   install-appimage.sh --remove                                  (undo everything this script did)
#
# One line, from anywhere:  curl -fsSL <raw URL of this file> | bash          (add  -s -- --remove  to undo)
set -euo pipefail

data="${XDG_DATA_HOME:-$HOME/.local/share}"
app_dir="$HOME/.local/opt"
target="$app_dir/VTT.Chat.AppImage"
entry="$data/applications/vtt-chat-app.desktop"
icon="$data/icons/vtt-chat-app.png"

if [ "${1:-}" = "--remove" ]; then
  rm -f "$entry" "$icon" "$target"
  command -v update-desktop-database >/dev/null && update-desktop-database "$data/applications" || true
  echo "Removed the VTT Chat menu entry, icon and AppImage. Log out and back in to clear the menu."
  exit 0
fi

src="${1:-}"
if [ -z "$src" ]; then
  # shellcheck disable=SC2012
  src="$(ls -t "$HOME"/Downloads/VTT.Chat*.AppImage 2>/dev/null | head -1 || true)"
fi
[ -n "$src" ] && [ -f "$src" ] || { echo "Give the path to the VTT Chat .AppImage you downloaded." >&2; exit 1; }

mkdir -p "$app_dir" "$data/applications" "$data/icons"
if [ "$(readlink -f "$src")" != "$(readlink -f "$target")" ]; then
  cp -f "$src" "$target"
fi
chmod +x "$target"

# The icon: a real 256 px PNG from inside the AppImage (the file at its top level is only a shortcut).
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
(cd "$work" && "$target" --appimage-extract 'usr/share/icons/hicolor/256x256/apps/vtt-chat-app.png' >/dev/null)
cp -f "$work/squashfs-root/usr/share/icons/hicolor/256x256/apps/vtt-chat-app.png" "$icon"
file "$icon" | grep -q "PNG image data" || { echo "could not extract the icon" >&2; exit 1; }

# The menu entry. The icon is a full path, so no icon cache can hide it. StartupWMClass is what lets the dock
# match the running window to this entry.
cat > "$entry" <<EOF
[Desktop Entry]
Type=Application
Name=VTT Chat
Comment=Voice, chat and session records for tabletop groups
Exec=$target %u
Icon=$icon
Terminal=false
Categories=Network;Chat;
StartupWMClass=vtt-chat-app
MimeType=x-scheme-handler/vtt-chat;
EOF

command -v desktop-file-validate >/dev/null && desktop-file-validate "$entry"
command -v update-desktop-database >/dev/null && update-desktop-database "$data/applications" || true

echo "Done. VTT Chat is installed at $target"
echo "Log out and back in once so the menu and dock pick up the new entry, then open VTT Chat from the menu."
