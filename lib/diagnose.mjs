// Known causes of failed builds and what to do about each. The web UI shows the first match under a failed build, and
// macbuild prints it after a failed build in the terminal. Most specific first; `code` in a fix is shown as code.
//   node lib/diagnose.mjs <log file>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const KNOWN = [
  [/No space left on device|ENOSPC/i, 'The Mac ran out of disk space',
    'Free some space, for example with Disk cleanup in the web UI’s Settings, then build again.'],
  [/errSecInternalComponent/i, 'codesign couldn’t use the signing keychain',
    'Usually a keychain left behind by a build that crashed. Build again: macbuild removes stale EAS keychains first. If it happens again, restart the Mac.'],
  [/Provisioning profile .{0,120}doesn.t include (the currently selected device|signing certificate)/i, 'The provisioning profile is missing this device or certificate',
    'Register the device with `eas device:create`, then build again so EAS makes a new profile. `eas credentials` also refreshes it.'],
  [/(certificate|cert) .{0,80}(has expired|is expired|has been revoked|was revoked)|Revoked certificate/i, 'The distribution certificate expired or was revoked',
    'Run `eas credentials`, remove the old certificate and let EAS create a new one, then build again.'],
  [/No profile for team|No signing certificate|requires a provisioning profile|No matching provisioning profiles found/i, 'There are no signing credentials for this app',
    'Run `eas credentials` once in a terminal to set them up, then build again.'],
  [/Apple ID or password (is|was) incorrect|Invalid username and password|Authentication with Apple Developer Portal failed/i, 'Signing in to Apple failed',
    'Check `MACBUILD_APPLE_ID` and the password file in `~/.config/macbuild/env`, or leave both empty and run `eas credentials` once to save a session.'],
  [/You are not logged in|An Expo user account is required/i, 'eas-cli isn’t signed in on this Mac',
    'Run `eas login` on the Mac, then build again.'],
  [/spawn (pod|fastlane) ENOENT|(pod|fastlane): command not found/i, 'CocoaPods or fastlane isn’t installed where builds can find it',
    'Run `macbuild doctor` and install what it lists. Homebrew installs are found automatically.'],
  [/CocoaPods could not find compatible versions|Unable to find a specification for|pod install.{0,40}failed|Error installing pods/i, 'CocoaPods couldn’t install a native dependency',
    'Check native package versions with `npx expo install --check`, run `pod repo update`, then build again.'],
  [/requires (a minimum Xcode version|Xcode \d+)|Xcode \d+(\.\d+)? or (newer|later) is required|unable to find a destination matching|SDK "iphoneos\d/i, 'This needs a newer Xcode',
    'Update Xcode from the App Store, open it once to finish installing, then run `sudo xcode-select -s /Applications/Xcode.app`.'],
  [/SDK location not found|(ANDROID_HOME|ANDROID_SDK_ROOT) (is not set|isn.t set|environment variable)/i, 'The Android SDK wasn’t found',
    'Install Android Studio, or set `ANDROID_HOME` to the SDK folder in `~/.config/macbuild/env`.'],
  [/Unsupported class file major version|requires Java 17|JAVA_HOME is not set|Could not determine java version/i, 'Gradle needs Java 17',
    'Install it with `brew install --cask zulu@17`, or set `JAVA_HOME` in `~/.config/macbuild/env`.'],
  [/OutOfMemoryError|Java heap space|Metaspace/i, 'Gradle ran out of memory',
    'Close other apps, or raise `org.gradle.jvmargs` with a config plugin, then build again.'],
  [/ERESOLVE|lockfile.{0,40}(out of date|needs to be updated)|frozen-lockfile|npm ci.{0,60}(in sync|can only install)/i, 'Dependencies didn’t install from the lockfile',
    'package.json and the lockfile disagree. Run your package manager’s install, commit the lockfile, and push.'],
  [/Unable to resolve module|Unable to resolve ".{1,120}" from|SyntaxError: .{0,200}\.(js|jsx|ts|tsx)/i, 'The JavaScript bundle didn’t build',
    'Run `npx expo export` on the Mac to see the full error. It’s usually a missing package or a wrong import path.'],
  [/\.swift:\d+:\d+: error|Value of type .{1,80} has no member|cannot find .{1,80} in scope|\.(m|mm):\d+:\d+: error/i, 'Native code didn’t compile',
    'A native module or your own native code doesn’t compile with this Xcode. Check the error above; `npx expo install --check` fixes mismatched package versions.'],
].map(([match, title, fix]) => ({ match, title, fix }));

const clean = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
export function diagnose(text) {
  const plain = clean(text);
  const known = KNOWN.find((item) => item.match.test(plain));
  return known ? { title: known.title, fix: known.fix } : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const hint = diagnose(readFileSync(process.argv[2], 'utf8'));
    if (hint) console.log(`likely cause: ${hint.title}\n${hint.fix.replace(/`/g, '')}`);
  } catch {}
}
