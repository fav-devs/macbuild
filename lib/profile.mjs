// What macbuild needs from eas.json build profiles, with `extends` followed. Used by bin/macbuild and the web UI.
//   node lib/profile.mjs <eas.json> <profile> <ios|android>   prints key=value lines, or missing=1
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function readProfiles(file) {
  const { build = {} } = JSON.parse(readFileSync(file, 'utf8'));
  const value = (name, path, seen = new Set()) => {
    if (!build[name] || seen.has(name)) return undefined;
    seen.add(name);
    const own = path.reduce((node, key) => node?.[key], build[name]);
    return own !== undefined ? own : build[name].extends ? value(build[name].extends, path, seen) : undefined;
  };
  return Object.keys(build).map((name) => {
    const distribution = value(name, ['distribution']) ?? 'store';
    const developmentClient = Boolean(value(name, ['developmentClient']));
    const simulator = Boolean(value(name, ['ios', 'simulator']));
    // EAS builds an APK for internal and development builds unless buildType says otherwise, and an AAB for the store.
    const buildType = value(name, ['android', 'buildType']);
    const apk = buildType ? buildType === 'apk' : distribution === 'internal' || developmentClient;
    return {
      name, distribution, developmentClient, channel: value(name, ['channel']) ?? '',
      ios: { artifact: simulator ? 'tar.gz' : 'ipa', simulator },
      android: { artifact: apk ? 'apk' : 'aab', simulator: false },
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, name, platform = 'ios'] = process.argv.slice(2);
  let profiles;
  try { profiles = readProfiles(file); } catch { process.exit(0); } // unreadable eas.json: macbuild uses its defaults
  const profile = profiles.find((item) => item.name === name);
  if (!profile) console.log('missing=1');
  else {
    const target = profile[platform === 'android' ? 'android' : 'ios'];
    console.log([`artifact=${target.artifact}`, `simulator=${target.simulator ? 1 : 0}`, `distribution=${profile.distribution}`, `devclient=${profile.developmentClient ? 1 : 0}`].join('\n'));
  }
}
