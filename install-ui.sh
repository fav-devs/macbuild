#!/bin/bash
# Runs the UI at login, and a menu bar extra. With Tailscale the dashboard is on your tailnet only: https://<this-mac>:8443
#   --menubar-only  compile and start the menu bar extra without restarting the dashboard
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/lib/agents.sh"
. "$HERE/lib/tailscale.sh"
MENUBAR_ONLY=0
for arg in "$@"; do case "$arg" in --menubar-only) MENUBAR_ONLY=1;; --no-restart) ;; *) echo "unknown option $arg"; exit 2;; esac; done
PORT=${MACBUILD_UI_PORT:-4180}; HTTPS=${MACBUILD_UI_HTTPS_PORT:-8443}
URL=$(ts_ensure) || true
URL=${URL:-http://localhost:$PORT}
NODE=$(command -v node)
LOGIN=$(saved_login)
PATH_ENV="$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$HOME/Library/Logs" "$AGENTS_DIR" "$(dirname "$BAR_BIN")" "$HOME/.local/bin"

write_ui_plist() {
  cat > "$UI_PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$UI_LABEL</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/ui/server.mjs</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$PATH_ENV</string>
<key>MACBUILD_UI_PORT</key><string>$PORT</string>
<key>MACBUILD_UI_HTTPS_PORT</key><string>$HTTPS</string>
<key>MACBUILD_UI_URL</key><string>$URL</string>
</dict>
<key>RunAtLoad</key><$LOGIN/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME/Library/Logs/macbuild-ui.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/macbuild-ui.log</string>
</dict></plist>
PL
}

write_bar_plist() {
  cat > "$BAR_PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$BAR_LABEL</string>
<key>ProgramArguments</key><array><string>$BAR_BIN</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$PATH_ENV</string>
<key>MACBUILD_UI_PORT</key><string>$PORT</string>
</dict>
<key>RunAtLoad</key><$LOGIN/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>StandardOutPath</key><string>$HOME/Library/Logs/macbuild-menubar.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/macbuild-menubar.log</string>
</dict></plist>
PL
}

compile_menubar() {
  command -v swiftc >/dev/null || { echo "menu bar skipped: install Xcode for swiftc"; return 1; }
  mkdir -p "$(dirname "$BAR_BIN")"
  cp "$HERE/macos/Info.plist" "$BAR_APP/Contents/Info.plist"
  swiftc -O -o "$BAR_BIN" "$HERE/macos/menubar.swift"
  ln -sfn "$BAR_BIN" "$BAR_LINK"
  if command -v codesign >/dev/null; then
    codesign -s - --force --identifier dev.fav.macbuild.menubar "$BAR_BIN" >/dev/null 2>&1 || true
  fi
}

install_menubar() {
  compile_menubar || return 0
  write_bar_plist
  save_login_pref "$LOGIN" true
  bootout_agent "$BAR_LABEL"
  bootstrap_agent "$BAR_PLIST"
}

if [ "$MENUBAR_ONLY" = 1 ]; then
  install_menubar
  echo "menu bar: $BAR_BIN"
  exit 0
fi

building() {
  python3 -c '
import json, os, sys
root = os.path.join(os.environ["HOME"], ".local/share/macbuild/builds")
if not os.path.isdir(root): sys.exit(1)
for name in os.listdir(root):
    path = os.path.join(root, name, "meta.json")
    try: status = json.load(open(path)).get("status")
    except Exception: continue
    if status in ("queued", "running", "cancelling"): sys.exit(0)
sys.exit(1)
'
}

(cd "$HERE/ui" && npm install --omit=dev --no-audit --no-fund >/dev/null)
write_ui_plist
if building; then
  echo "dashboard left running: a build is in progress"
elif agent_loaded "$UI_LABEL"; then
  bootout_agent "$UI_LABEL"
  bootstrap_agent "$UI_PLIST"
else
  bootstrap_agent "$UI_PLIST"
fi
install_menubar
case "$URL" in https://*) ;; *) echo "Tailscale not running: the UI is on this Mac only, and installing on a phone needs HTTPS.";; esac
echo "$URL"
