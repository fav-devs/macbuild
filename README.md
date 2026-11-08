# macbuild

Build your Expo apps for iOS and Android on your own Mac, with an EAS-style dashboard you can use from your phone.

macbuild wraps `eas build --local`: it answers the signing prompts, builds any branch or commit in a clean checkout, skips rebuilds when only JavaScript changed, and uploads to TestFlight or Google Play. It also runs your Expo dev servers and publishes OTA updates. No build credits, no queue.

<img src="docs/dashboard.png" alt="A project's overview: the build running now with its time left, latest builds, health, signing and working copy">

<p>
  <img src="docs/builds.png" width="250" alt="Build list on an iPhone">
  <img src="docs/build.png" width="250" alt="A build's details and install button on an iPhone">
  <img src="docs/insights.png" width="250" alt="Insights with build charts on an iPhone">
</p>

## Install

On the Mac, with the dashboard:

```sh
curl -fsSL https://raw.githubusercontent.com/fav-devs/macbuild/main/install.sh | bash -s -- --ui
```

Leave out `--ui` for the command line only, and add `--guard` to block EAS cloud builds. Run it again to update. In a terminal it ends with a [guided setup](docs/setup.md) that finds your apps, checks your tools and sets up signing.

You need Xcode, Node.js, CocoaPods, fastlane, `eas-cli` (signed in with `eas login`) and an Apple Developer account. For Android, add Android Studio and Java 17. GitHub CLI and Tailscale are optional.

From Windows, Linux or another Mac, send builds to that Mac with the npm package. See [remote builds](docs/remote.md).

```sh
npm install -g @fav-devs/macbuild
```

## Build

```sh
macbuild myapp                                # dev build from your working copy
macbuild myapp --ref main                     # what's pushed to GitHub, in a clean checkout
macbuild myapp --install                      # build, then install on your iPhone
macbuild myapp --skip-unchanged --install     # rebuild only if native code changed
macbuild myapp --profile simulator --install  # open it in the iOS Simulator
macbuild myapp --submit --ref main            # production build, uploaded to TestFlight
macbuild myapp --android --install            # Android APK, on the phone connected with adb
```

When a build fails, macbuild says the likely cause and how to fix it. Every option and setting is in [builds and settings](docs/builds.md).

## Dev servers

<img src="docs/dev-server.png" width="49%" alt="A project's dev server page: running on port 8081, the iOS bundle, Expo's terminal with its keys, a QR code for the phone"> <img src="docs/dev-server-terminal.png" width="49%" alt="A dev server started in a terminal, shown in full on the dashboard">

Each project's **Dev server** page runs `npx expo start` on the Mac. Start it from your phone, scan the QR code, follow Expo's terminal, and press its keys or answer its questions from the dashboard. If you'd rather keep running `npx expo start` in your own terminal, one line in `metro.config.js` puts that terminal on the dashboard too:

```js
try { require('@fav-devs/macbuild/metro').attach(); } catch {}
```

```sh
macbuild dev myapp                   # start it and wait until Metro is ready
macbuild dev log myapp --follow      # Expo's output as numbered lines
macbuild dev wait myapp --since 120  # did the change after line 120 bundle? exit 0 yes, 1 no
macbuild dev hook myapp              # add that line to the app's metro.config.js
```

More in [dev servers](docs/dev-servers.md).

## OTA updates

Open a project and choose **Push OTA**: pick a channel, a pushed branch, the platforms and a message, then review it before it goes out. From a terminal:

```sh
macbuild update myapp --channel production --ref main --message "Fix the login screen"
```

More in [OTA updates](docs/ota.md).

## Dashboard

With `--ui`, the dashboard runs at `http://localhost:4180`. With Tailscale it's also on your tailnet at `https://<your-mac>.<tailnet>.ts.net:8443`: open that on your iPhone and add it to your Home Screen. Start builds from any branch, follow them live and install dev builds over the air. Build on every push or pull request, check signing, channels and submissions, and get a notification when a build finishes. More in [the dashboard](docs/dashboard.md).

**The dashboard has no login.** Anyone who can reach it can start builds and dev servers and download your IPAs. It listens on `127.0.0.1` and is meant for your private tailnet. Never put it on the public internet or Tailscale Funnel.

## Agents

Point your agent at [AGENTS.md](AGENTS.md):

> Set up macbuild on this Mac by following https://github.com/fav-devs/macbuild/blob/main/AGENTS.md

`macbuild mcp` is a stdio MCP server for builds and dev servers, with tools such as `wait`, `log`, `dev_log`, `dev_wait` and `dev_send`. `macbuild wait` blocks until a dashboard job finishes, and `macbuild ask` sends a failed build to T3 Code.

## More

[Setup](docs/setup.md) · [Builds and settings](docs/builds.md) · [Dashboard](docs/dashboard.md) · [Dev servers](docs/dev-servers.md) · [OTA updates](docs/ota.md) · [Remote builds](docs/remote.md) · [Files and uninstall](docs/reference.md)

## Develop

```sh
git clone https://github.com/fav-devs/macbuild.git && cd macbuild
npm ci --prefix ui
node ui/demo/demo.mjs        # the dashboard with sample apps, builds and dev servers, at http://localhost:4181
node --test test/*.test.mjs
```

The demo uses stand-ins for `eas`, `gh`, GitHub, `expo start` and the setup agent, so it runs on any machine and never touches your projects. The screenshots come from it. [AGENTS.md](AGENTS.md) explains how the pieces fit together.

## License

MIT. Not affiliated with Expo or Apple.
