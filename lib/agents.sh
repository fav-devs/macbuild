# LaunchAgents for the dashboard and menu bar. Sourced by bin/macbuild and install-ui.sh.
UID_GUI="gui/$(id -u)"
UI_LABEL=local.macbuild.ui
BAR_LABEL=local.macbuild.menubar
AGENTS_DIR="$HOME/Library/LaunchAgents"
UI_PLIST="$AGENTS_DIR/$UI_LABEL.plist"
BAR_PLIST="$AGENTS_DIR/$BAR_LABEL.plist"
BAR_BIN="$HOME/.local/bin/macbuild-menubar"

agent_loaded() { launchctl print "$UID_GUI/$1" >/dev/null 2>&1; }

plist_login() {
  python3 -c '
import re, sys
try: text = open(sys.argv[1]).read()
except OSError: sys.exit(1)
sys.exit(0 if re.search(r"<key>RunAtLoad</key>\s*<true/>", text) else 1)
' "$1"
}

set_plist_login() {
  python3 -c '
import re, sys
path, val = sys.argv[1], sys.argv[2]
try: text = open(path).read()
except OSError: sys.exit(1)
next, n = re.subn(r"(<key>RunAtLoad</key>\s*)<(true|false)/>", r"\1<%s/>" % val, text, count=1)
if not n: sys.exit(1)
open(path, "w").write(next)
' "$1" "$2"
}

# ui.json: loginAtLogin defaults to on once the dashboard is installed.
saved_login() {
  python3 -c '
import json, os, sys
path = os.path.join(os.environ["HOME"], ".config/macbuild/ui.json")
try:
    data = json.load(open(path))
except (OSError, json.JSONDecodeError, TypeError):
    print("true"); sys.exit(0)
print("true" if data.get("loginAtLogin", True) else "false")
'
}

save_login_pref() {
  python3 -c '
import json, os, sys
path = os.path.join(os.environ["HOME"], ".config/macbuild/ui.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
try: data = json.load(open(path))
except (OSError, json.JSONDecodeError, TypeError): data = {}
if not isinstance(data, dict): data = {}
data["loginAtLogin"] = sys.argv[1] == "true"
if sys.argv[2] in ("true", "false"):
    data["menubar"] = sys.argv[2] == "true"
json.dump(data, open(path, "w"), indent=2)
open(path, "a").write("\n")
' "$1" "${2:-}"
}

set_login() {
  local on="$1" val
  if [ "$on" = 1 ]; then val=true; else val=false; fi
  save_login_pref "$val" ""
  [ -f "$UI_PLIST" ] && set_plist_login "$UI_PLIST" "$val" || true
  [ -f "$BAR_PLIST" ] && set_plist_login "$BAR_PLIST" "$val" || true
}

bootout_agent() { launchctl bootout "$UID_GUI/$1" 2>/dev/null || true; }
bootstrap_agent() { launchctl bootstrap "$UID_GUI" "$1" 2>/dev/null || launchctl load "$1" 2>/dev/null || true; }
