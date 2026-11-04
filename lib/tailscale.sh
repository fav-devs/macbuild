# Tailscale CLI and dashboard Serve. Sourced by bin/macbuild and install-ui.sh.
# MACBUILD_TAILSCALE overrides the binary; empty means “no Tailscale” (tests).
ts_bin() {
  if [ -n "${MACBUILD_TAILSCALE+x}" ]; then
    [ -x "${MACBUILD_TAILSCALE:-}" ] && printf '%s\n' "$MACBUILD_TAILSCALE"
    return 0
  fi
  if [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then
    printf '%s\n' /Applications/Tailscale.app/Contents/MacOS/Tailscale
  else
    command -v tailscale
  fi
}

ts_json() {
  local ts
  ts=$(ts_bin) || return 1
  [ -n "$ts" ] || return 1
  "$ts" status --json 2>/dev/null
}

ts_host() {
  ts_json | python3 -c '
import json, sys
try: data = json.load(sys.stdin)
except Exception: raise SystemExit(0)
print(((data.get("Self") or {}).get("DNSName") or "").rstrip("."))
' 2>/dev/null || true
}

ts_online() {
  ts_json | python3 -c '
import json, sys
try: data = json.load(sys.stdin)
except Exception: raise SystemExit(1)
self = data.get("Self") or {}
raise SystemExit(0 if data.get("BackendState") == "Running" and self.get("Online") else 1)
' 2>/dev/null
}

ts_serve_ok() {
  local ts port
  ts=$(ts_bin) || return 1
  [ -n "$ts" ] || return 1
  port=${MACBUILD_UI_PORT:-4180}
  "$ts" serve status 2>/dev/null | grep -q "127.0.0.1:$port"
}

ts_url() {
  local host https
  host=$(ts_host)
  https=${MACBUILD_UI_HTTPS_PORT:-8443}
  [ -n "$host" ] && printf 'https://%s:%s\n' "$host" "$https"
}

# Start Tailscale if it is signed in, then publish the dashboard on the tailnet (HTTPS, tailnet only).
ts_ensure() {
  local ts port https i
  ts=$(ts_bin) || return 1
  [ -n "$ts" ] || return 1
  port=${MACBUILD_UI_PORT:-4180}
  https=${MACBUILD_UI_HTTPS_PORT:-8443}
  if ! ts_online; then
    [ -z "${MACBUILD_TAILSCALE:-}" ] && [ "$(uname)" = Darwin ] && open -a Tailscale >/dev/null 2>&1 || true
    "$ts" up --timeout 20s >/dev/null 2>&1 || true
    i=0
    while [ $i -lt 15 ]; do
      ts_online && break
      i=$((i + 1))
      sleep 1
    done
  fi
  ts_online || return 1
  "$ts" serve --bg --https="$https" "http://127.0.0.1:$port" >/dev/null 2>&1 || true
  ts_serve_ok || return 1
  ts_url
}
