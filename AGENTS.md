# macbuild for agents

macbuild builds Expo iOS and Android apps on this Mac with `eas build --local`. Use these steps to set it up or run a build for the user.

## Set up

1. Confirm this is a Mac. macbuild doesn't run anywhere else.
2. Install it:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash
   ```
   Add `-s -- --ui` for the web UI. Add `--guard` only if the user asks to block EAS cloud builds, because it wraps their `eas` command.
3. Run `macbuild setup` (or `macbuild doctor`) and fix each `MISS` line. It prints the command for each one. Installing Xcode, signing in to Expo (`eas login`) and Apple prompts need the user, so ask them. Don't request or store their passwords in chat.
4. For the dashboard and menu bar: `macbuild setup --ui`. That starts Tailscale if it is signed in and publishes the dashboard on the tailnet (`https://<this-mac>.*.ts.net:8443`). `macbuild setup --tailscale` does only that, without restarting the UI. `macbuild setup --login` / `--nologin` and `--menubar` / `--no-menubar` toggle those without restarting a running build. The in-app guide is `#/setup`.
5. Run `macbuild list`. If an app is missing, run `macbuild add <name> <path>` with the folder holding `eas.json`. In a monorepo that's the app folder.
6. Optional: fill in `~/.config/macbuild/env`. Never commit this file.
7. Confirm with a dev build: `macbuild <name>`. The first build asks EAS for signing setup and can take 15 minutes or more.

The first build for a new app can stop on signing prompts macbuild doesn't know. If the log stalls, tell the user to run `eas credentials` once in a terminal, then retry.

## Build

| The user wants | Command |
|---|---|
| A dev build of their current code | `macbuild <name>` |
| What's pushed to GitHub | `macbuild <name> --ref main` |
| It on their phone | `macbuild <name> --install` |
| It on TestFlight | `macbuild <name> --submit --ref main` |
| It in the iOS Simulator | `macbuild <name> --profile <simulator profile> --install` |
| To see the running app | add `--screenshot shot.png` to the simulator command, then look at the file |
| An Android build | `macbuild <name> --android`, with `--install` for a phone on adb or `--submit` for Google Play |
| Only rebuild if native code changed | add `--skip-unchanged` (development and simulator builds) |
| Local files that a GitHub `--ref` build would skip | `macbuild commit <name> --push` (T3 CLI splits related files; never `git add .`) |
| To wait for a dashboard job | `macbuild wait` (or `macbuild wait <id\|project>`). Add `--json` for one object, `--follow` to stream the log. |
| A failed build sent to T3 Code in the project folder | `macbuild ask` (or `macbuild ask <id\|project>`). Uses the dashboard default model from T3’s signed-in agents, or `--codex` / `--model`. |

Rules:

- For TestFlight or Google Play, use `--ref` with a pushed branch, so uncommitted or out-of-date local code doesn't ship.
- Android needs Android Studio's SDK and Java 17. `macbuild doctor` shows whether they're found.
- Don't run `eas build` without `--local`. Cloud builds cost money, and using macbuild means the user chose local.
- Dashboard jobs write `~/.local/share/macbuild/builds/<id>/build.log` and `meta.json`. A CLI `macbuild <name>` writes the same history, so it shows up in the web UI. It also keeps `~/Library/Logs/<name>-<platform>-build-<profile>.log` (a symlink to that job log). Read those when a build fails. A failed build also prints a `likely cause` and its fix when it recognises the error.
- Pull history without opening the dashboard: `macbuild builds`, `macbuild log` (latest, or an id / project name), `macbuild show` (JSON). `macbuild builds --json` dumps every job.
- After a dashboard or background job, run `macbuild wait` (optionally with the id or project). It exits when the job finishes: 0 on success or skipped, 1 on failed or cancelled, 2 if no job, 124 on `--timeout`. Do not poll `macbuild show` in a loop. `macbuild <name>` already blocks for a CLI build.
- `macbuild mcp` is a stdio MCP server with wait, show, builds and log. Point an MCP client at that command.
- Report what happened, with the build's path or the error. A finished `--submit` run still has to be processed by Apple or Google.

To make a project's agents build locally, add this to its `AGENTS.md`:

```md
## Builds are local only

Never run an EAS cloud build. Build on the Mac with `macbuild <project>`.
Wait for a dashboard job with `macbuild wait`. Inspect with `macbuild builds`, `macbuild log` and `macbuild show`. Do not poll show in a loop.
```

## Work on macbuild

- `bin/macbuild`: the CLI. Must run on macOS's bash 3.2.
- `lib/eas_pty.py`: runs `eas` in a terminal so prompts can be answered. New prompts go in `SPECS` in `bin/macbuild`.
- `lib/profile.mjs` reads `eas.json` profiles (simulator, APK or AAB), `lib/fingerprint.mjs` computes the native fingerprint with the project's own `@expo/fingerprint`, `lib/diagnose.mjs` lists known failures with their fixes (most specific first), `lib/commit.mjs` starts a T3 thread to split, commit and push a dirty working copy, `lib/ask.mjs` starts a T3 Code or Codex thread in the project folder with a failed build’s log, `lib/device.mjs` lists paired iPhones and installs an IPA with `xcrun devicectl`, `lib/history.mjs` records a CLI build in dashboard history, `lib/wait.mjs` blocks until a dashboard job finishes, `lib/mcp.mjs` is a stdio MCP server over wait/show/builds/log, and `lib/tailscale.sh` starts Tailscale and `tailscale serve` so the dashboard is on the tailnet. Dashboard setting `autoInstall` is `off`, `wifi` or `always`; a failed install does not fail the build.
- `ui/server.mjs` and `ui/public/`: the dashboard. Keep it on `127.0.0.1`; POST requests need the `x-macbuild` header, and every request's Host must be loopback, the tailnet name or one in `MACBUILD_UI_HOSTS`. `ui/public/` is served from disk, so copy and CSS changes are live without a restart. Restart `local.macbuild.ui` only when `server.mjs` changed, and only if nothing is building: a restart used to mark the running job failed even though `eas` keeps going. `followCli` must not mark a CLI job failed while its pid is alive: a quiet xcodebuild is not a stopped CLI. The menu bar extra is `macos/menubar.swift`, compiled by `install-ui.sh` into `~/.local/share/macbuild/macbuild-menubar.app` (LaunchAgent `local.macbuild.menubar` runs the inner binary so `UNUserNotificationCenter` has a bundle id). A symlink stays at `~/.local/bin/macbuild-menubar`.
- `node ui/demo/demo.mjs` serves the dashboard at http://localhost:4181 with sample projects, a build history and a build running, using stand-ins for eas, gh and git's network calls. Use it to work on the UI and to retake the README screenshots in `docs/`. It never touches real projects.
- Tests: `npm ci --prefix ui`, then `node --test test/*.test.mjs`. They run `bin/macbuild` with a fake `eas` and the dashboard against throwaway projects, on Linux or macOS. CI also runs `shellcheck -S warning` on the shell scripts.
