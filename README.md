# macbuild

Build your Expo iOS apps on your own Mac, with an EAS-style dashboard you can use from your phone.

macbuild wraps `eas build --local`: it answers the signing prompts, builds any branch or commit from GitHub in a clean checkout, and uploads to TestFlight. No build credits, no queue.

<p>
  <img src="docs/builds.png" width="250" alt="Build list">
  <img src="docs/build.png" width="250" alt="Build page with source, details and phase logs">
  <img src="docs/insights.png" width="250" alt="Insights with build charts">
</p>

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash
```

With the web UI, and a block on EAS cloud builds:

```sh
curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash -s -- --ui --guard
```

The installer finds Expo apps in your usual project folders, then runs `macbuild doctor` to show anything missing.

You need a Mac with Xcode, Node.js, CocoaPods, fastlane, `eas-cli` (signed in with `eas login`) and an Apple Developer account. GitHub CLI and Tailscale are optional.

### Using an AI agent

Point your agent at this repo:

> Set up macbuild on this Mac by following https://github.com/fav-devs/macbuild/blob/main/AGENTS.md

## Use

```sh
macbuild myapp                          # dev build from your working copy
macbuild myapp --ref main               # build what's pushed to GitHub, in a clean checkout
macbuild myapp --install                # build, then install on the paired iPhone
macbuild myapp --testflight --ref main  # production build, uploaded to TestFlight
macbuild myapp --profile preview --fast # any eas.json profile, reusing compiled output
```

Managing projects:

```sh
macbuild list
macbuild add myapp ~/code/myapp/apps/mobile
macbuild scan
macbuild doctor
```

The IPA lands on your Desktop. Projects are in `~/.config/macbuild/projects.conf`, settings in `~/.config/macbuild/env`. Project names use letters, digits, `.`, `_` and `-`.

`--testflight` submits with the `eas.json` submit profile named like the build profile, or `production` if there isn't one.

## Web UI

Install with `--ui` to run the dashboard at login. With Tailscale it's published on your tailnet only, at `https://<your-mac>:8443`. Open it in Safari on your iPhone and add it to your Home Screen.

- Start builds from any branch, commit and `eas.json` profile
- See commit, author, PR, GitHub checks, version, channel and signing expiry for each build
- Live logs grouped by phase, with timings
- Install dev builds on your phone over the air, or scan a QR code
- Rebuild, cancel, download the IPA
- Build a branch automatically on every push
- Charts for build activity, speed and success rate
- Read-only Expo data: submissions, channels, environment variable names, devices
- Push notifications when a build finishes

Installing from the page needs HTTPS, which Tailscale provides, and a device in the app's provisioning profile.

## Security

**The web UI has no login.** Anyone who can reach it can start builds and download your IPAs. It listens on `127.0.0.1` and is meant to be shared only through your private tailnet. Never put it on the public internet, and don't turn on Tailscale Funnel for it. It answers only requests addressed to `localhost`, `127.0.0.1` or a `*.ts.net` name, which stops other websites from reaching it through DNS rebinding. To use another name, list it in `MACBUILD_UI_HOSTS` (comma-separated) in `~/Library/LaunchAgents/local.macbuild.ui.plist`.

Signing credentials stay with EAS and your Mac. Your Apple password, if you set one, is read from a file you choose. Environment variable values never reach the UI.

## Good to know

- Builds run one at a time and use your whole Mac. A build started while another is running, from the terminal, an agent or the web UI, waits for it.
- `--testflight` uses `eas submit`, so Expo's servers do the upload to Apple. The build itself is local.
- macbuild still uses your Expo account for credentials and project settings. It replaces EAS's build machines, not the rest of EAS.
- iOS only for now.
- `--guard` wraps the global `eas` command so `eas build` needs `--local`, and `eas build:dev`, `build:resign` and `workflow:run` are refused. It doesn't stop `npx eas-cli`. Remove it with `install.sh --unguard`, and run `--guard` again after updating `eas-cli`.

## Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash -s -- --uninstall
```

## License

MIT. Not affiliated with Expo or Apple.
