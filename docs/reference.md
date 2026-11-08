# Files and uninstall

[← README](../README.md)

## Files

| Path | What's there |
|---|---|
| `~/.config/macbuild/projects.conf` | Your projects, one `name\|path` per line |
| `~/.config/macbuild/env` | The settings above |
| `~/.config/macbuild/ui.json` | Web UI automatic-build rules, notification keys, webhook and `appleTeam` |
| `~/.config/macbuild/setup.json` | How far setup got, what it found, and which signing commands finished |
| `~/.local/share/macbuild/fingerprints` | The native fingerprint of each build, for `--skip-unchanged` |
| `~/.local/share/macbuild/builds` | Web UI build history: the last 200 builds, with IPAs for the last 10 |
| `~/.local/share/macbuild/dev` | Dev server logs: the last 20 sessions of each app, and how each was started |
| `~/.local/share/macbuild/dev.sock` | Where the `metro.config.js` line reaches the dashboard. Only you can open it. |
| `~/.node_modules/@fav-devs/macbuild` | A link to macbuild, so that line finds it without a dependency in the app |
| `~/.cache/macbuild` | Work folders and checkouts. Safe to delete between builds. |
| `~/Library/Logs/<name>-<platform>-build-<profile>.log` | The log of the last terminal build of each app, platform and profile |
| `~/Library/Logs/macbuild-ui.log` | The web UI's own log |
| `~/Library/Logs/macbuild-menubar.log` | The menu bar extra |
| `~/.local/share/macbuild/macbuild-menubar.app` | Menu bar extra (compiled on this Mac) |
| `~/.local/bin/macbuild-menubar` | Symlink to that app’s binary |

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash -s -- --uninstall
```

This removes the command, the `eas` wrapper, the web UI service, `~/.cache/macbuild` and the `~/.node_modules` link (a `metro.config.js` line left in an app then does nothing). It keeps your settings and build history; delete `~/.macbuild`, `~/.config/macbuild` and `~/.local/share/macbuild` to clear everything.
