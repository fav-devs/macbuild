// Prints the fingerprint of an Expo project's native code for one platform, using the project's own @expo/fingerprint.
// Two builds with the same fingerprint have the same native code, so a development build can be reused instead of rebuilt.
// Prints nothing when the project doesn't have the package or it fails, and macbuild then builds as usual.
//   node lib/fingerprint.mjs <project folder> <ios|android>
import { createRequire } from 'node:module';
import { join } from 'node:path';

const [dir, platform = 'ios'] = process.argv.slice(2);
try {
  const { createFingerprintAsync } = createRequire(join(dir, 'package.json'))('@expo/fingerprint');
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), 120000).unref(); });
  const fingerprint = await Promise.race([createFingerprintAsync(dir, { platforms: [platform] }), timeout]);
  if (fingerprint?.hash) console.log(fingerprint.hash);
} catch {
  // no fingerprint: build as usual
}
