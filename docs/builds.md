# Builds and settings

[← README](../README.md)

## Building

```sh
macbuild myapp                                # dev build from your working copy
macbuild myapp --ref main                     # build what's pushed to GitHub, in a clean checkout
macbuild myapp --install                      # build, then install on the paired iPhone
macbuild myapp --skip-unchanged --install     # rebuild only if native code changed, then install
macbuild myapp --profile simulator --install  # a simulator profile, opened in the iOS Simulator
macbuild myapp --submit --ref main            # production build, uploaded to TestFlight
macbuild myapp --android --install            # Android APK, installed on the phone on adb
macbuild myapp --android --submit --ref main  # Android App Bundle, uploaded to Google Play
macbuild myapp --profile preview --fast       # any eas.json profile, reusing compiled output
```

| Option | What it does |
|---|---|
| `--platform ios\|android` | Which app to build. Default `ios`; `--android` is short for `--platform android`. |
| `--profile NAME` | The `eas.json` build profile. Default `development`, or `production` with `--submit`. A profile with `ios.simulator` builds for the Simulator; on Android, `buildType` or the distribution picks an APK or an AAB. |
| `--ref REF` | Build a pushed branch, tag or commit in a clean checkout. Uncommitted files never go in. |
| `--install` | Install the build: on the iPhone set in `MACBUILD_DEVICE`, in the iOS Simulator for a simulator profile, or on the Android phone connected with USB debugging. |
| `--screenshot PATH` | With `--install` on the Simulator, save a screenshot of the app once it's open. |
| `--skip-unchanged` | Reuse the last build of this profile when the native code hasn't changed. macbuild compares fingerprints from the project's own `@expo/fingerprint`. Meant for development and simulator builds, which load JavaScript from Metro. |
| `--submit` | Upload to TestFlight or Google Play after the build, with the `eas.json` submit profile named like the build profile, or `production`. `--testflight` still works. |
| `--submit-only PATH` | Upload an existing store IPA or AAB without rebuilding. Uses configured submission credentials noninteractively. |
| `--send` | Send the build to the device set in `MACBUILD_TAILDROP_TARGET` with Taildrop. |
| `--fast` | Keep one work folder per app and profile and turn on Xcode's compilation cache, so later builds reuse compiled output. |
| `--output PATH` | Where the build goes. Default: your Desktop. |

Completed store builds have a **Submit to TestFlight** or **Submit to Google Play** action on their dashboard build page. Confirming uploads the retained artifact without rebuilding, with a separate job for logs and status. Uploads run alongside local builds without taking the build lock; submissions use their own single-job queue. Development, internal, simulator, expired, and APK builds are not eligible. Configure submission credentials once in a terminal if the upload reports missing credentials. Stopping the local submission job does not retract an upload already scheduled with Expo.

When a build fails, macbuild prints the likely cause and how to fix it if it recognises the error: a device missing from the provisioning profile, a CocoaPods conflict, an expired certificate, the wrong Java for Gradle, and more. Send that log to T3 Code in the project folder with `macbuild ask`. The dashboard Settings page lists T3’s signed-in agents; `--codex` or `--model` override the default.

Managing projects:

```sh
macbuild list                                # your projects
macbuild add myapp ~/code/myapp/apps/mobile  # the folder with eas.json; in a monorepo, the app's folder
macbuild scan                                # find Expo apps in ~/Documents, ~/Developer, ~/Projects, ~/code and ~/src
macbuild commit myapp --push                 # split local git changes with T3, then push
macbuild wait                                # block until the latest dashboard job finishes
macbuild wait myapp --json                   # same, as one JSON object
macbuild mcp                                 # stdio MCP: wait, show, builds, log, and the dev server tools
macbuild dev                                 # each app: can it run a dev server, is one running, its link
macbuild dev myapp                           # start its dev server (npx expo start), wait until Metro is ready
macbuild doctor                              # check the tools and logins builds need
macbuild setup                               # the guided setup; --status for what's set up and missing
```

Project names use letters, digits, `.`, `_` and `-`.

## Settings

Optional, in `~/.config/macbuild/env`. The file stays on your Mac; never commit it.

| Setting | What it's for |
|---|---|
| `MACBUILD_APPLE_ID` | Your Apple ID, so builds don't stop to ask for it. |
| `MACBUILD_APPLE_PASSWORD_FILE` | A file holding that Apple ID's password. Leave both empty to use EAS's saved session. |
| `MACBUILD_DEVICE` | The iPhone for `--install`, from `xcrun devicectl list devices`. |
| `MACBUILD_TAILDROP_TARGET` | The Tailscale device name for `--send`. |
| `MACBUILD_NODE` | The nvm Node version to build with, such as `v22.17.0`. Default: the `node` on your PATH. |
| `MACBUILD_SIMULATOR` | The simulator for `--install`, by name or UDID. Default: the booted one, or the first iPhone. |
| `MACBUILD_ANDROID_DEVICE` | The Android phone for `--install` when several are connected, from `adb devices`. |
| `ANDROID_HOME`, `JAVA_HOME` | The Android SDK and Java 17, only if they aren't where Android Studio puts them. |

## Good to know

- Builds run one at a time and use your whole Mac. A build started while another is running, from the terminal, an agent or the web UI, waits for it.
- The first build of a new app can stop at a signing question macbuild doesn't answer. If its log stops moving, run `eas credentials` once in a terminal, then build again.
- `--submit` uses `eas submit`, so Expo's servers do the upload to Apple or Google. The build itself is local, and the store still has to process the build before testers get it.
- macbuild still uses your Expo account for credentials and project settings. It replaces EAS's build machines, not the rest of EAS.
- `--guard` wraps the global `eas` command so `eas build` needs `--local`, and `eas build:dev`, `build:resign` and `workflow:run` are refused. It doesn't stop `npx eas-cli`. Remove it with `install.sh --unguard`, and run `--guard` again after updating `eas-cli`.
