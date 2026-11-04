#!/bin/bash
# Runs the UI at login. With Tailscale it is published on your tailnet only: https://<this-mac>:8443
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
PORT=${MACBUILD_UI_PORT:-4180}; HTTPS=${MACBUILD_UI_HTTPS_PORT:-8443}
[ -x "$TS" ] || TS=$(command -v tailscale || true)
HOST=""; [ -n "$TS" ] && HOST=$("$TS" status --json 2>/dev/null | python3 -c "import json,sys;print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || true)
URL=${HOST:+https://$HOST:$HTTPS}; URL=${URL:-http://localhost:$PORT}
(cd "$HERE/ui" && npm install --omit=dev --no-audit --no-fund >/dev/null)
NODE=$(command -v node); PLIST="$HOME/Library/LaunchAgents/local.macbuild.ui.plist"; mkdir -p "$HOME/Library/Logs" "$(dirname "$PLIST")"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>local.macbuild.ui</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$HERE/ui/server.mjs</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>$(dirname "$NODE"):$HOME/.local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>MACBUILD_UI_PORT</key><string>$PORT</string>
<key>MACBUILD_UI_HTTPS_PORT</key><string>$HTTPS</string>
<key>MACBUILD_UI_URL</key><string>$URL</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$HOME/Library/Logs/macbuild-ui.log</string>
<key>StandardErrorPath</key><string>$HOME/Library/Logs/macbuild-ui.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/local.macbuild.ui" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
[ -n "$HOST" ] && "$TS" serve --bg --https="$HTTPS" "http://127.0.0.1:$PORT" >/dev/null
[ -n "$HOST" ] || echo "Tailscale not running: the UI is on this Mac only, and installing on a phone needs HTTPS."
echo "$URL"
