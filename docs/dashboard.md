# The dashboard

[← README](../README.md)

Install with `--ui` to run the dashboard at login, at `http://localhost:4180` on the Mac, with a menu bar extra for build status and a one-click build. Turn those off under Settings, or with `macbuild setup --nologin` and `--no-menubar`. With Tailscale the dashboard is also published on your tailnet only, at `https://<your-mac>.<tailnet>.ts.net:8443`. Open that in Safari on your iPhone and add it to your Home Screen. Setup's Phone step gets Tailscale ready and shows that link with a QR code.

- Start iOS, Simulator and Android builds from any branch, commit and `eas.json` profile, and reuse the last one when native code hasn't changed
- When the working copy has local git changes a GitHub build would skip, split them into commits and push through T3 Code so unrelated files stay apart
- Follow a build live: its current phase, the time left going by your usual build time, and logs grouped by phase on a timeline
- See commit, PR, GitHub checks, version, channel, app size and its change, signing expiry and who started it for each build
- When a build fails, the likely cause and how to fix it
- Install dev builds on an iPhone over the air or by QR code, put them on a paired iPhone from this Mac (Wi-Fi or always), download Android APKs, or open Simulator builds in the Simulator on the Mac
- Build automatically on every push, for each pull request, or every night; a newer push replaces a build that hasn't started
- Post each build's status to its commit on GitHub, and a message to Slack or Discord
- A page for each project's builds, branches, submissions, update channels, signing and devices, environment variable names, and build automation, with Expo's data read-only
- Run each app's Expo dev server: start and stop it, open it on your phone with a QR code or in a browser, follow Expo's terminal live, press its keys and answer its questions. One you start yourself with `npx expo start` shows up too
- Charts for build activity, speed, success rate, app size and where the time goes
- Disk cleanup for Xcode's build files, caches, old simulators and macbuild's own work folders
- Your app's icon from `app.json`, your Mac's status in the sidebar, and push notifications when a build finishes

Installing from the page needs HTTPS, which Tailscale provides, and a device in the app's provisioning profile.

A few things the dashboard reads:

- **App icons** come from `expo.ios.icon` or `expo.icon` in `app.json`. Apps configured only with `app.config.js` or `app.config.ts` get a monogram instead.
- **Registered devices** on a project's Signing page need your Apple Team ID. Enter it under Settings, Integrations.
- **PR and CI details, pull request builds and GitHub statuses** need the GitHub CLI, signed in with `gh auth login`. Pull requests from forks are never built: their code would run on your Mac.
- **Slack or Discord**: paste an incoming webhook URL under Settings, Integrations. The dashboard shows only its host afterwards.
- **Who started a build** comes from Tailscale, which tells the dashboard who is signed in on each device in your tailnet.
- **Other ports:** set `MACBUILD_UI_PORT` (default 4180) or `MACBUILD_UI_HTTPS_PORT` (default 8443) when you run the installer with `--ui`.

## Security

**The web UI has no login.** Anyone who can reach it can start builds, run dev servers and press their keys, and download your IPAs. It listens on `127.0.0.1` and is meant to be shared only through your private tailnet. Never put it on the public internet, and don't turn on Tailscale Funnel for it. It answers only requests addressed to `localhost`, `127.0.0.1` or a `*.ts.net` name, which stops other websites from reaching it through DNS rebinding. To use another name, list it in `MACBUILD_UI_HOSTS` (comma-separated) in `~/Library/LaunchAgents/local.macbuild.ui.plist`.

Signing credentials stay with EAS and your Mac. Your Apple password, if you set one, is read from a file you choose. Environment variable values never reach the UI.
