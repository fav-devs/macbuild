# macbuild for agents

macbuild builds Expo iOS and Android apps on this Mac with `eas build --local`. Use these steps to set it up or run a build for the user.

## Set up

1. Confirm this is a Mac. macbuild doesn't run anywhere else.
2. Install it:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash
   ```
   Add `-s -- --ui` for the web UI. Add `--guard` only if the user asks to block EAS cloud builds, because it wraps their `eas` command.
3. Run `macbuild setup --status` (or `macbuild doctor`) and fix each `MISS` line. Plain `macbuild setup` in a terminal is the guided setup for a person (it asks questions); without a terminal it prints the same status. If the user would rather click through it, tell them to run `macbuild setup` themselves. It prints the command for each one. Installing Xcode, signing in to Expo (`eas login`) and Apple prompts need the user, so ask them. Don't request or store their passwords in chat.
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
| The app running against their code, with Metro | `macbuild dev <name>` (starts the dashboard's dev server, waits until it's ready, prints the link and command) |
| To see whether a code change bundles | `macbuild dev wait <name> --since <last line number>`: exit 0 bundled, 1 failed or errored, 124 timed out |
| To read or follow the dev server | `macbuild dev log <name>` (`--follow`, `--since N`, `--json`), `macbuild dev status <name>` |
| To press an Expo key or answer Expo | `macbuild dev key <name> r` (m, j, i, a, w, s, ?, enter, up, down, ctrl-c), `macbuild dev answer <name> yes\|no\|N` |
| An OTA JavaScript/assets update | `macbuild update <name> --profile production --channel production --environment production --platform ios --ref main --message "Describe the change"` |

Rules:

- For TestFlight or Google Play, use `--ref` with a pushed branch, so uncommitted or out-of-date local code doesn't ship.
- OTA also requires a pushed `--ref`, channel and message. `macbuild ota` is an alias. Select the build profile whose channel and app-variant env match the installed app. OTA cannot ship native code and reaches only compatible runtimes. Publishing affects installed apps, so only run it when the user requests a release; do not publish merely to test this feature. Inspect OTA jobs with the same builds/show/log/wait commands as builds.
- Android needs Android Studio's SDK and Java 17. `macbuild doctor` shows whether they're found.
- Don't run `eas build` without `--local`. Cloud builds cost money, and using macbuild means the user chose local.
- Dashboard jobs write `~/.local/share/macbuild/builds/<id>/build.log` and `meta.json`. A CLI `macbuild <name>` writes the same history, so it shows up in the web UI. It also keeps `~/Library/Logs/<name>-<platform>-build-<profile>.log` (a symlink to that job log). Read those when a build fails. A failed build also prints a `likely cause` and its fix when it recognises the error.
- Pull history without opening the dashboard: `macbuild builds`, `macbuild log` (latest, or an id / project name), `macbuild show` (JSON). `macbuild builds --json` dumps every job.
- After a dashboard or background job, run `macbuild wait` (optionally with the id or project). It exits when the job finishes: 0 on success or skipped, 1 on failed or cancelled, 2 if no job, 124 on `--timeout`. Do not poll `macbuild show` in a loop. `macbuild <name>` already blocks for a CLI build.
- `macbuild mcp` is a stdio MCP server with wait, show, builds and log, plus the dev server tools (`dev_servers`, `dev_status`, `dev_start`, `dev_stop`, `dev_log`, `dev_wait`, `dev_send`). Point an MCP client at that command.
- The dashboard runs dev servers (`npx expo start` in a terminal it holds), one per project, each on its own port from 8081. Use `macbuild dev`, not your own background `npx expo start`, so the user sees it on the dashboard and the port isn't taken twice. If the dashboard isn't running, `macbuild dev <name> --here` runs Expo in your terminal instead.
- Watching a change: note `next` from `macbuild dev log <name> --json` (or `dev_log`), edit, then `macbuild dev wait <name> --since <next>` (or `dev_wait`). Don't poll the log in a loop: `wait` holds the request on the server. When Expo asks a question, `wait` returns at once with the prompt; answer with `macbuild dev answer`.
- Stop only a dev server you started, or when the user asks. Others may have it open on their phones.
- A dev server the user started in a terminal (`npx expo start` in a project's folder) shows as `terminal` when the app's `metro.config.js` has macbuild's line (`macbuild dev hook <name>`): then it works like macbuild's own, keys and answers included, except restart. Without the line it shows as `external`: the dashboard follows its bundles and app logs and can reload or open the dev menu, but its own output and other keys stay in that terminal. Add the line only when the user agrees: it edits a file in their app. Don't take one over (`macbuild dev takeover`, `dev_start` with `takeOver`) unless the user asks: it stops their terminal's server.
- Report what happened, with the build's path or the error. A finished `--submit` run still has to be processed by Apple or Google.

To make a project's agents build locally, add this to its `AGENTS.md`:

```md
## Builds are local only

Never run an EAS cloud build. Build on the Mac with `macbuild <project>`.
Publish an authorized OTA release with `macbuild update <project> --channel production --profile production --environment production --platform ios --ref main --message "Release message"`. OTA only reaches compatible installed runtimes; native changes need a build.
Wait for a dashboard job with `macbuild wait`. Inspect with `macbuild builds`, `macbuild log` and `macbuild show`. Do not poll show in a loop.
Run the dev server with `macbuild dev <project>`, not your own `npx expo start`. After a change, `macbuild dev wait <project> --since <line>` reports whether it bundled.
```

## Work on macbuild

### Remote workers

- Node 22+ clients on Windows/Linux/macOS use `bin/macbuild.mjs` (npm bin). Existing shell installations dispatch remote commands there. Native builds still require this Mac; never fall back to cloud builds or to local execution when a remote fails.
- The `dev` scope lets a remote client start, stop and press keys in the Mac's dev servers (`macbuild dev ...` and the `dev_*` MCP tools, through `/api/remote/v1/dev`); `read` is enough to follow their logs. They serve the Mac's working copy, not the client's. Paths and pids on the Mac are not sent.
- Personal devices: on the Mac use `macbuild server device create --name NAME` for a revocable connection without scheduled expiry; by default it permits development builds for all registered projects, including future ones. Restrict with `--projects` or `--expires-days` when appropriate. On the client use `macbuild connect NAME URL --token-stdin`, then `macbuild link PROJECT [LOCAL_FOLDER]`; `macbuild` in that folder builds the linked project. Links validate matching origins and do not synchronize dirty files. Credentials stay private; never print them. Existing scoped CI tokens keep their expiry.
- Connect with `macbuild remote add NAME URL --token-stdin`. Configure tokens only on the Mac with `macbuild server token create --name NAME --projects PROJECT --profiles development --scopes read,build,cancel`. Never put tokens in chat, source files, or command-line arguments. The server stores hashes; clients store private credentials.
- Run remote builds from the client's project checkout. Inspect with `macbuild source`; commit explicitly selected paths with Git. `macbuild push --confirm-push` pushes the clean current branch, never forces or stages. Remote builds require matching origin, pushed pinned commits, allowed profiles/scopes, and any configured required CI checks. `--ref BRANCH --allow-dirty` explicitly excludes dirty changes; do not use it to silently bypass the user's intended source.
- Remote OTA/submission requires a user-authorized release, token scope, and `--confirm-release` (MCP `confirmRelease: true`). Test only with fake workers, never publish to test functionality. Queue with `macbuild PROJECT`, monitor using `macbuild wait ID --json`, download with `macbuild download ID --output FILE`.
- Remote MCP runs with `macbuild --remote NAME mcp` in the client's project checkout. Local administration uses `macbuild --local ...`. New modules: `lib/remote-access.mjs` (token policy), `lib/remote-api.mjs` (versioned restricted API), `lib/remote-client.mjs` (HTTPS/source gates), `lib/remote-mcp.mjs` (stdio tools). Keep the dashboard loopback-only. This is trusted-tailnet execution, not a multi-user code sandbox; remote scopes do not replace dashboard network ACLs.
- Validate package contents with `npm pack --dry-run`. Do not publish npm packages without an explicit user request. Cross-platform client tests: `node --test test/remote.test.mjs`; full worker tests still use the UI dependencies and macOS/Linux.

### First-time setup

- `lib/setup.mjs` is the guided setup: eight steps, each a screen of fields, commands and buttons, saved in `~/.config/macbuild/setup.json`. `lib/setup-cli.mjs` draws the screens in the terminal with `lib/tui.mjs` (no dependencies); the dashboard's `#/setup` draws the same screens from `/api/setup/flow`. Change a step in `lib/setup.mjs` and both follow.
- The agent (Claude Code or Codex, `lib/setup-agent.mjs`) is read-only: Claude Code with only Read, Glob and Grep, Codex with `--sandbox read-only`. Its instructions are `skills/macbuild-setup/SKILL.md`, and every answer is checked against `SCHEMA` and `sanitizeReview` before the user sees it. macbuild applies a fix only from `applyAction`'s list, after the user ticks it. A new kind of fix needs all three: the skill's table, `ACTION_TYPES`/`sanitizeReview`, and `applyAction`.
- The Phone step reads Tailscale the way `lib/tailscale.sh` does (`MACBUILD_TAILSCALE` names the binary, empty means none) and only ever offers commands for the person to run: install, sign in, `tailscale serve`. Serve stays tailnet-only, never Funnel.
- Signing is never automated: it's `eas credentials:configure-build` in a terminal, where the user signs in to Apple. The dashboard's Open Terminal runs only commands the current screen lists, and `MACBUILD_NO_TERMINAL=1` (the demo and tests) turns it off.
- `ui/demo/fake-agent.mjs` stands in for both agents in the demo and the tests. `test/drive-tty.py` types into the terminal UI through a pseudo-terminal. The demo also serves the real terminal setup in a browser on its port + 1 (`ui/demo/terminal.mjs`, with `lib/pty-bridge.py`); `MACBUILD_SETUP_DEMO=1` there means nothing gets installed for real.

### The rest

- `bin/macbuild`: the CLI. Must run on macOS's bash 3.2.
- Dev servers: `lib/devserver.mjs` (`DevServers`, held by `ui/server.mjs`) runs `npx expo start` through `lib/pty-bridge.py`, a pseudo-terminal that resizes on fd 3 and stops the whole process group when its stdin closes, so Metro never outlives the dashboard. It reads Expo's output into links, readiness, bundles per platform, the last error and the prompt on screen (confirm, select or text), keeps the raw bytes for the page's xterm.js view (served from `ui/node_modules` at `/vendor/`) and numbered clean lines for agents. Readiness reads only files, so the projects page can check every app. The command is fixed: `npx expo start --port N` plus one of `--localhost`/`--tunnel`, or `REACT_NATIVE_PACKAGER_HOSTNAME` for Tailscale. Input is keys from `KEYS`, one printable character, or text without other control characters. `lib/dev-cli.mjs` is `macbuild dev` and the `DEV_TOOLS` MCP tools, over a local or remote transport with the same `/dev/...` paths. `/api/dev/<project>/stream` is server-sent events; the service worker leaves `/api/dev/` alone. `ui/demo/fake-expo.mjs` stands in for Expo in the demo and `test/dev.test.mjs`. `watch()` scans every 4 s (`MACBUILD_DEV_SCAN=0` turns it off) for `expo start`/`react-native start` processes, innermost node process only, not under macbuild's own bridges, whose working folder is a project's; it claims only ports that process owns (lsof) or names (`--port`), follows Metro's `/events` (as Expo-style lines, through `eventText`), sends reload and devMenu through `/message`, and reads phones from `/json/list`. It never stops one on its own: stopping is SIGINT, and only on request. The hook: `lib/metro.cjs`, loaded by the line `lib/metro-hook.mjs` adds to an app's `metro.config.js` (`require('@fav-devs/macbuild/metro')`, resolved through the `~/.node_modules/@fav-devs/macbuild` link that install.sh and `addMetroHook` make; `package.json` exports `./metro`). Inside `expo start` it copies stdout and stderr writes to the dashboard and emits keys from it as stdin data events. It must never throw into Expo, never keep it running (unref'd socket and timers), and stays out of CI, of anything but start/run:ios/run:android, and of macbuild's own sessions (`MACBUILD_DEV_SESSION`). The dashboard listens on `~/.local/share/macbuild/dev.sock` (`MACBUILD_DEV_SOCKET`; mode 0600) and `adopt` checks each hello against `ps` and the process's real working folder before it becomes a session; a hook outside the projects gets `bye` and stops trying. Its output gets carriage returns added (`crlf`), since it skipped the terminal driver. setup offers the line as the optional fix `add_metro_hook`, always unticked.
- `lib/eas_pty.py`: runs `eas` in a terminal so prompts can be answered. New prompts go in `SPECS` in `bin/macbuild`.
- `lib/profile.mjs` reads `eas.json` profiles (simulator, APK or AAB), `lib/fingerprint.mjs` computes the native fingerprint with the project's own `@expo/fingerprint`, `lib/diagnose.mjs` lists known failures with their fixes (most specific first), `lib/commit.mjs` starts a T3 thread to split, commit and push a dirty working copy, `lib/ask.mjs` starts a T3 Code or Codex thread in the project folder with a failed build’s log, `lib/device.mjs` lists paired iPhones and installs an IPA with `xcrun devicectl`, `lib/history.mjs` records a CLI build in dashboard history, `lib/wait.mjs` blocks until a dashboard job finishes, `lib/mcp.mjs` is a stdio MCP server over wait/show/builds/log and the dev tools from `lib/dev-cli.mjs`, and `lib/tailscale.sh` starts Tailscale and `tailscale serve` so the dashboard is on the tailnet. Dashboard setting `autoInstall` is `off`, `wifi` or `always`; a failed install does not fail the build.
- `ui/server.mjs` and `ui/public/`: the dashboard. Keep it on `127.0.0.1`; POST requests need the `x-macbuild` header, and every request's Host must be loopback, the tailnet name or one in `MACBUILD_UI_HOSTS`. `ui/public/` is served from disk, so copy and CSS changes are live without a restart. Restart `local.macbuild.ui` only when `server.mjs` changed, and only if nothing is building: a restart used to mark the running job failed even though `eas` keeps going. A restart also stops every dev server, so check `macbuild dev` first and say so. `followCli` must not mark a CLI job failed while its pid is alive: a quiet xcodebuild is not a stopped CLI. Dashboard `holdTailscale` retries Serve in the background until it is up (5s while down, 15s once healthy, no give-up). HTTP handlers must not await it: `tailscale up` can sit 20s with no internet, and the menu bar’s poll times out in 2s. Skip `up` when Tailscale is already Running or Starting. A failed `tailscale serve` at login is not a healthy cooldown. The menu bar extra is `macos/menubar.swift`, compiled by `install-ui.sh` into `~/.local/share/macbuild/macbuild-menubar.app` (LaunchAgent `local.macbuild.menubar` runs the inner binary so `UNUserNotificationCenter` has a bundle id). Its plist uses `LimitLoadToSessionType Aqua` so it starts after WindowServer; if it still launches too early it exits 1 and KeepAlive restarts it. A symlink stays at `~/.local/bin/macbuild-menubar`.
- `node ui/demo/demo.mjs` serves the dashboard at http://localhost:4181 with sample projects, a build history and a build running, using stand-ins for eas, gh and git's network calls. Use it to work on the UI and to retake the README screenshots in `docs/`. It never touches real projects.
- Tests: `npm ci --prefix ui`, then `node --test test/*.test.mjs`. They run `bin/macbuild` with a fake `eas` and the dashboard against throwaway projects, on Linux or macOS. CI also runs `shellcheck -S warning` on the shell scripts.
