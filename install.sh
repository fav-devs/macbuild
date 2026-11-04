#!/bin/bash
# macbuild installer. Safe to run again.
#   curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash
#   ... | bash -s -- --ui --guard
#   --ui         run the web UI at login, and publish it on your tailnet if Tailscale is installed
#   --guard      refuse EAS cloud builds on this Mac (wraps the global eas command)
#   --unguard    remove that wrapper
#   --uninstall  remove macbuild, the wrapper, the web UI service and the build cache (keeps settings and build history)
set -e
UI=0; GUARD=0; UNGUARD=0; UNINSTALL=0
for arg in "$@"; do case "$arg" in --ui) UI=1;; --guard) GUARD=1;; --unguard) UNGUARD=1;; --uninstall) UNINSTALL=1; UNGUARD=1;; *) echo "unknown option $arg"; exit 2;; esac; done
[ "$(uname)" = Darwin ] || { echo "macbuild needs macOS"; exit 1; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)
if [ ! -f "$HERE/bin/macbuild" ]; then
  HERE="$HOME/.macbuild"
  if [ -d "$HERE/.git" ]; then git -C "$HERE" pull -q --ff-only; else git clone -q https://github.com/fav-devs/macbuild.git "$HERE"; fi
fi
eas_paths() { for e in "$HOME"/.nvm/versions/node/*/bin/eas "$(command -v eas 2>/dev/null)"; do [ -e "$e" ] && echo "$e"; done | sort -u; }
if [ "$UNGUARD" = 1 ]; then
  eas_paths | while read -r e; do d=$(dirname "$e"); if [ -e "$d/eas.real" ]; then real=$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$d/eas.real"); rm -f "$e" "$d/eas.real"; ln -s "$real" "$e"; echo "restored $e"; fi; done
fi
if [ "$UNINSTALL" = 1 ]; then
  PLIST="$HOME/Library/LaunchAgents/local.macbuild.ui.plist"
  # The tailnet port install-ui.sh published, read back before the plist goes.
  HTTPS=$(/usr/libexec/PlistBuddy -c 'Print :EnvironmentVariables:MACBUILD_UI_HTTPS_PORT' "$PLIST" 2>/dev/null || echo "${MACBUILD_UI_HTTPS_PORT:-8443}")
  launchctl bootout "gui/$(id -u)/local.macbuild.ui" 2>/dev/null || true
  rm -f "$PLIST" "$HOME/.local/bin/macbuild"
  TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale; [ -x "$TS" ] || TS=$(command -v tailscale || true)
  [ -n "$TS" ] && "$TS" serve --https="$HTTPS" off 2>/dev/null || true
  # Work directories, checkouts and temporary IPAs: often the largest thing macbuild leaves.
  rm -rf "$HOME/.cache/macbuild"
  echo "removed. To clear everything, also delete $HERE, ~/.config/macbuild (settings and projects) and ~/.local/share/macbuild (build history and IPAs)."; exit 0
fi
[ "$UNGUARD" = 1 ] && exit 0
mkdir -p "$HOME/.local/bin" "$HOME/.config/macbuild"
ln -sf "$HERE/bin/macbuild" "$HOME/.local/bin/macbuild"
[ -f "$HOME/.config/macbuild/env" ] || cp "$HERE/env.example" "$HOME/.config/macbuild/env"
chmod 600 "$HOME/.config/macbuild/env"
"$HERE/bin/macbuild" scan || true
if [ "$GUARD" = 1 ]; then
  eas_paths | while read -r e; do
    d=$(dirname "$e")
    if ! grep -q 'no EAS cloud builds' "$e" 2>/dev/null; then ln -sf "$(python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" "$e")" "$d/eas.real"; rm "$e"; fi
    cp "$HERE/bin/eas-guard" "$e"; chmod +x "$e"; echo "guarded $e"
  done
fi
[ "$UI" = 1 ] && "$HERE/install-ui.sh"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'Add to your shell profile: export PATH="$HOME/.local/bin:$PATH"';; esac
echo; "$HERE/bin/macbuild" doctor || echo; echo "Next: macbuild <project>   (macbuild list shows your projects)"
