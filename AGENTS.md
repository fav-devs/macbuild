# macbuild for agents

macbuild builds Expo iOS and Android apps on this Mac with `eas build --local`. Use these steps to set it up or run a build for the user.

## Set up

1. Confirm this is a Mac. macbuild doesn't run anywhere else.
2. Install it:
   ```sh
   curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash
   ```
   Add `-s -- --ui` for the web UI. Add `--guard` only if the user asks to block EAS cloud builds, because it wraps their `eas` command.
3. Run `macbuild doctor` and fix each `MISS` line. It prints the command for each one. Installing Xcode, signing in to Expo (`eas login`) and Apple prompts need the user, so ask them. Don't request or store their passwords in chat.
4. Run `macbuild list`. If an app is missing, run `macbuild add <name> <path>` with the folder holding `eas.json`. In a monorepo that's the app folder.
5. Optional: fill in `~/.config/macbuild/env`. Never commit this file.
6. Confirm with a dev build: `macbuild <name>`. The first build asks EAS for signing setup and can take 15 minutes or more.

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

Rules:

- For TestFlight or Google Play, use `--ref` with a pushed branch, so uncommitted or out-of-date local code doesn't ship.
- Android needs Android Studio's SDK and Java 17. `macbuild doctor` shows whether they're found.
- Don't run `eas build` without `--local`. Cloud builds cost money, and using macbuild means the user chose local.
- Each build logs to `~/Library/Logs/<name>-<platform>-build-<profile>.log`. Read it when a build fails. A failed build also prints a `likely cause` and its fix when it recognises the error.
- Report what happened, with the build's path or the error. A finished `--submit` run still has to be processed by Apple or Google.

To make a project's agents build locally, add this to its `AGENTS.md`:

```md
## Builds are local only

Never run an EAS cloud build. Build on the Mac with `macbuild <project>`.
```

## Work on macbuild

- `bin/macbuild`: the CLI. Must run on macOS's bash 3.2.
- `lib/eas_pty.py`: runs `eas` in a terminal so prompts can be answered. New prompts go in `SPECS` in `bin/macbuild`.
- `lib/profile.mjs` reads `eas.json` profiles (simulator, APK or AAB), `lib/fingerprint.mjs` computes the native fingerprint with the project's own `@expo/fingerprint`, and `lib/diagnose.mjs` lists known failures with their fixes. Add a newly seen failure there, most specific first.
- `ui/server.mjs` and `ui/public/`: the dashboard. Keep it on `127.0.0.1`; POST requests need the `x-macbuild` header, and every request's Host must be loopback, the tailnet name or one in `MACBUILD_UI_HOSTS`.
- `node ui/demo/demo.mjs` serves the dashboard at http://localhost:4181 with sample projects, a build history and a build running, using stand-ins for eas, gh and git's network calls. Use it to work on the UI and to retake the README screenshots in `docs/`. It never touches real projects.
- Tests: `npm ci --prefix ui`, then `node --test test/*.test.mjs`. They run `bin/macbuild` with a fake `eas` and the dashboard against throwaway projects, on Linux or macOS. CI also runs `shellcheck -S warning` on the shell scripts.
