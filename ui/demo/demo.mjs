// The dashboard with sample projects and builds, for working on the UI and for the README screenshots. Nothing here
// touches your real projects or settings: everything lives in a temporary folder, and eas, gh, git's network calls,
// xcodebuild and pmset are stand-ins.
//   node ui/demo/demo.mjs [--port 4181]     then open http://localhost:4181 (setup: #/setup)
// The terminal setup runs in a browser on the next port (http://localhost:4182): the real `macbuild setup`, here.
// One build is running when the demo starts and another is queued behind it.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../../lib/diagnose.mjs';
import { startTerminal } from './terminal.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[process.argv.indexOf('--port') + 1] || 0) || 4181;
// The real path: on macOS the temp folder is reached through a symlink, and the eas stand-in looks projects up by folder.
const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'macbuild-demo-')));
const BIN = join(DIR, 'bin');
const DATA = join(DIR, 'builds');
const NOW = Date.now();
const MINUTE = 60000; const HOUR = 60 * MINUTE; const DAY = 24 * HOUR;
mkdirSync(BIN); mkdirSync(DATA);

const PEOPLE = ['Alex Rivera', 'Sam Chen', 'Priya Natarajan', 'Jordan Lee'];
const PROJECTS = [
  {
    name: 'notes', repo: 'acme/notes', bundle: 'com.acme.notes', title: 'Notes', version: '2.4.0',
    main: ['Initial Expo app', 'Rich text editor', 'Offline sync for notes', 'Search across notebooks', 'Dark mode for settings',
      'Pin notes to the top', 'Speed up image cache', 'Add onboarding flow', 'Haptics on save', 'Bump expo to 54', 'Share extension'],
    branches: { 'feature/folders': ['Nested folders', 'Drag notes between folders'], 'fix/keyboard': ['Fix keyboard overlap on login'], 'release/2.4': ['Release notes for 2.4'] },
  },
  {
    name: 'recipes', repo: 'acme/kitchen', sub: 'apps/recipes', bundle: 'com.acme.recipes', title: 'Recipes', version: '1.2.0',
    main: ['Monorepo with shared ui', 'Recipe list', 'Shopping list', 'Timer with live activity', 'Update app icon',
      'Share sheet for recipes', 'Localize into Spanish', 'Paginate the feed'],
    branches: { 'feature/meal-plan': ['Weekly meal plan', 'Meal plan widgets'], 'chore/sentry': ['Sentry source maps'] },
  },
  {
    name: 'pulse', repo: 'acme/pulse', bundle: 'com.acme.pulse', title: 'Pulse', version: '0.9.3',
    main: ['Heart rate chart', 'HealthKit permissions', 'Streaks', 'Fix crash on launch', 'Widget for streaks', 'Refactor auth store'],
    branches: { 'feature/onboarding': ['Onboarding carousel', 'Ask for notifications later'], 'fix/launch': ['Guard against empty HealthKit data'] },
  },
];

const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' }).toString().trim();
const pick = (list, seed) => list[Math.abs(seed) % list.length];

// Repositories with backdated history. Fetches are faked (see the git stand-in below), so origin/* refs are set here.
for (const [index, project] of PROJECTS.entries()) {
  const root = join(DIR, 'code', project.repo.split('/')[1]);
  const app = project.sub ? join(root, project.sub) : root;
  mkdirSync(app, { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(app, 'eas.json'), `${JSON.stringify({
    build: {
      development: { developmentClient: true, distribution: 'internal', channel: 'development' },
      preview: { distribution: 'internal', channel: 'preview' },
      production: { channel: 'production', autoIncrement: true },
      simulator: { extends: 'development', ios: { simulator: true } },
    },
    submit: { production: {} },
  }, null, 2)}\n`);
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.env\n');
  const web = project.name === 'notes' ? { 'react-dom': '19.1.0', 'react-native-web': '~0.21.0' } : {};
  writeFileSync(join(app, 'package.json'), `${JSON.stringify({ name: project.name, version: project.version, dependencies: { expo: '~54.0.0', 'expo-dev-client': '~6.0.0', 'react-native': '0.81.4', ...web } }, null, 2)}\n`);
  // Installed dependencies, as far as the dev server page looks (it only reads their package.json). recipes is left
  // uninstalled, so the page shows what it says when they're missing.
  if (project.name !== 'recipes') {
    for (const [name, version] of Object.entries({ expo: '54.0.12', 'expo-dev-client': '6.0.3', ...Object.fromEntries(Object.keys(web).map((key) => [key, '19.1.0'])) })) {
      mkdirSync(join(app, 'node_modules', name), { recursive: true });
      writeFileSync(join(app, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
  }
  // An app.json icon where the demo has one; pulse uses app.config.ts, so the dashboard falls back to a monogram.
  if (existsSync(join(HERE, `${project.name}.png`))) {
    mkdirSync(join(app, 'assets'));
    copyFileSync(join(HERE, `${project.name}.png`), join(app, 'assets/icon.png'));
    writeFileSync(join(app, 'app.json'), `${JSON.stringify({ expo: { name: project.title, slug: project.name, version: project.version, icon: './assets/icon.png', ios: { bundleIdentifier: project.bundle }, extra: { eas: { projectId: `${project.name}-4c1e-9a2b` } } } }, null, 2)}\n`);
  } else writeFileSync(join(app, 'app.config.ts'), 'export default { name: "Pulse" };\n');
  project.commits = {};
  const commit = (subject, when, author) => {
    writeFileSync(join(app, 'CHANGELOG.md'), `${subject}\n`, { flag: 'a' });
    git(root, ['add', '.']);
    const date = new Date(when).toISOString();
    git(root, ['commit', '-qm', subject], { GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: 'dev@example.com', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    return git(root, ['rev-parse', 'HEAD']);
  };
  project.main.forEach((subject, step) => {
    const when = NOW - (project.main.length - step) * 1.3 * DAY - index * 3 * HOUR;
    project.commits.main = [...(project.commits.main ?? []), { subject, hash: commit(subject, when, pick(PEOPLE, step + index)), when, author: pick(PEOPLE, step + index) }];
  });
  for (const [branch, subjects] of Object.entries(project.branches)) {
    git(root, ['checkout', '-q', '-b', branch, 'main']);
    project.commits[branch] = subjects.map((subject, step) => {
      const when = NOW - (subjects.length - step) * 9 * HOUR - index * HOUR;
      const author = pick(PEOPLE, step + index + 1);
      return { subject, hash: commit(subject, when, author), when, author };
    });
    git(root, ['update-ref', `refs/remotes/origin/${branch}`, branch]);
    git(root, ['checkout', '-q', 'main']);
  }
  git(root, ['update-ref', 'refs/remotes/origin/main', 'main']);
  git(root, ['remote', 'add', 'origin', `https://github.com/${project.repo}.git`]);
  if (project.name === 'notes') writeFileSync(join(app, 'App.tsx'), '// work in progress\n');
  project.root = root; project.dir = app;
}
writeFileSync(join(DIR, 'projects.conf'), PROJECTS.map((project) => `${project.name}|${project.dir}`).join('\n') + '\n');

// Build history: two weeks of builds across the projects and both platforms, with logs grouped into EAS's phases.
const IOS_PHASES = [
  ['SETUP_WORKINGDIR', 2, ['Preparing workingdir']], ['START_BUILD', 1, ['Starting build', 'Platform: ios']],
  ['READ_EAS_JSON', 1, ['Using eas.json']], ['READ_PACKAGE_JSON', 1, ['Using package.json']],
  ['INSTALL_DEPENDENCIES', 52, ['Running "npm ci --include=dev"', 'added 1284 packages, and audited 1285 packages in 49s', '231 packages are looking for funding']],
  ['READ_APP_CONFIG', 3, ['Using app configuration']], ['RUN_EXPO_DOCTOR', 9, ['Running "expo doctor"', '17/17 checks passed. No issues detected!']],
  ['PREPARE_CREDENTIALS', 4, ['Using distribution certificate', 'Using provisioning profile']],
  ['PREBUILD', 18, ['- Creating native directory (./ios)', '✔ Created native directory', '- Updating package.json', '✔ Finished prebuild']],
  ['INSTALL_PODS', 74, ['Using Expo modules', 'Installing pods', 'Pod installation complete! There are 98 dependencies from the Podfile and 121 total pods installed.']],
  ['CONFIGURE_EXPO_UPDATES', 2, ['Setting the update channel']], ['CONFIGURE_XCODE_PROJECT', 2, ['Configuring the Xcode project']],
  ['RUN_FASTLANE', 420, ['Running "fastlane ios build"', '▸ Compiling ExpoModulesCore', '▸ Compiling React-Core', '▸ Compiling hermes-engine', '▸ Compiling AppDelegate.swift', '▸ Linking', '▸ Signing', '▸ Archive Succeeded', '** ARCHIVE SUCCEEDED **']],
  ['PREPARE_ARTIFACTS', 6, ['Preparing artifacts']], ['UPLOAD_APPLICATION_ARCHIVE', 3, ['Application archive saved']],
];
const ANDROID_PHASES = [
  ['SETUP_WORKINGDIR', 2, ['Preparing workingdir']], ['START_BUILD', 1, ['Starting build', 'Platform: android']],
  ['READ_EAS_JSON', 1, ['Using eas.json']], ['READ_PACKAGE_JSON', 1, ['Using package.json']],
  ['INSTALL_DEPENDENCIES', 50, ['Running "npm ci --include=dev"', 'added 1284 packages in 47s']],
  ['READ_APP_CONFIG', 3, ['Using app configuration']], ['RUN_EXPO_DOCTOR', 9, ['17/17 checks passed. No issues detected!']],
  ['PREPARE_CREDENTIALS', 3, ['Using keystore from EAS']], ['PREBUILD', 16, ['- Creating native directory (./android)', '✔ Finished prebuild']],
  ['CONFIGURE_EXPO_UPDATES', 2, ['Setting the update channel']],
  ['RUN_GRADLEW', 380, ['Running "./gradlew :app:assembleRelease"', '> Task :expo-modules-core:compileReleaseKotlin', '> Task :app:createBundleReleaseJsAndAssets', '> Task :app:packageRelease', 'BUILD SUCCESSFUL in 6m 12s']],
  ['PREPARE_ARTIFACTS', 5, ['Preparing artifacts']], ['UPLOAD_APPLICATION_ARCHIVE', 3, ['Application archive saved']],
];
const FAILURES = {
  device: ['RUN_FASTLANE', '❌ error: Provisioning profile "*[expo] com.acme.pulse AdHoc" doesn\'t include the currently selected device "Priya’s iPhone".'],
  pods: ['INSTALL_PODS', 'Error: [!] CocoaPods could not find compatible versions for pod "ExpoModulesCore"'],
  swift: ['RUN_FASTLANE', '❌ /ios/notes/NotesStore.swift:48:12: error: Value of type \'NotesStore\' has no member \'syncNow\''],
  java: ['RUN_GRADLEW', 'FAILURE: Build failed with an exception. Unsupported class file major version 65'],
};
const BASE_SIZE = { notes: 39.2, recipes: 44.1, pulse: 31.4 };
const fingerprintOf = (...parts) => createHash('sha1').update(parts.join('/')).digest('hex');
const seeded = [];
let serial = 0;
function seedBuild(project, { ago, branch = 'main', step = 0, profile = 'development', platform = 'ios', status = 'success', submit = false, trigger = 'manual', by, source = 'github', file = false, minutes = 9, failure, grow = 0 }) {
  serial += 1;
  const commits = project.commits[branch];
  const commit = commits[Math.max(0, commits.length - 1 - step)];
  const createdAt = NOW - ago;
  const startedAt = createdAt + 2000 + (serial % 5) * 1000;
  const android = platform === 'android'; const simulator = profile === 'simulator'; const store = profile === 'production';
  const artifact = android ? (store ? 'app.aab' : 'app.apk') : simulator ? 'app.tar.gz' : 'app.ipa';
  const fingerprint = fingerprintOf(project.name, platform, Math.floor((commits.length - step) / 3), branch === 'main' ? '' : branch);
  const id = `${new Date(createdAt).toISOString().replace(/\D/g, '').slice(0, 14)}-${project.name}`;
  const build = {
    id, project: project.name, platform, action: submit ? 'submit' : 'build', profile, distribution: store ? 'store' : 'internal', channel: profile === 'simulator' ? 'development' : profile,
    artifact, simulator, devClient: profile === 'development' || simulator, source, ref: branch, trigger, by: by ? { name: by, login: `${by.split(' ')[0].toLowerCase()}@acme.dev` } : null,
    status, createdAt, startedAt, fingerprint,
    commit: { hash: commit.hash, short: commit.hash.slice(0, 7), subject: commit.subject, author: commit.author, date: commit.when, url: `https://github.com/${project.repo}/commit/${commit.hash}` },
    pr: branch !== 'main' ? { number: 40 + (serial % 30), title: commit.subject, url: `https://github.com/${project.repo}/pull/${40 + (serial % 30)}` } : null,
    repo: project.repo, dirty: source === 'working' ? 3 : 0,
  };
  let log = `macbuild: fingerprint ${fingerprint}\n`;
  if (status === 'skipped') {
    // Reuses the newest earlier build of the same kind, which is what --skip-unchanged finds by fingerprint.
    const earlier = seeded.filter((item) => item.status === 'success' && item.project === project.name && item.profile === profile && item.platform === platform).at(-1);
    Object.assign(build, { reusedFrom: earlier.id, app: earlier.app, ipaBytes: earlier.ipaBytes, installable: false, phases: [], finishedAt: startedAt + 9000, fingerprint: earlier.fingerprint });
    log += `macbuild: unchanged since ${join(DATA, earlier.id, earlier.artifact)}\n`;
    seeded.push(build);
    return writeBuild(build, log);
  }
  const PHASES = android ? ANDROID_PHASES : IOS_PHASES;
  const failing = failure ? FAILURES[failure] : null;
  const scale = (minutes * MINUTE + ((serial * 7919) % 50) * 1000) / PHASES.reduce((sum, [, seconds]) => sum + seconds * 1000, 0);
  let at = startedAt;
  const phases = [];
  for (const [name, seconds, lines] of PHASES) {
    phases.push({ name, at });
    const stops = failing?.[0] === name || (status === 'cancelled' && ['INSTALL_PODS', 'RUN_GRADLEW'].includes(name));
    log += (stops ? lines.slice(0, Math.ceil(lines.length / 2)) : lines).map((line) => `[${name}] ${line}\n`).join('');
    at += seconds * 1000 * scale * (stops ? 0.6 : 1);
    if (failing?.[0] === name) { log += `[${name}] ${failing[1]}\n`; break; }
    if (stops) break;
  }
  if (submit && status === 'success') {
    phases.push({ name: 'SUBMIT', at });
    log += `Scheduling ${android ? 'Android' : 'iOS'} submission\nSubmitted your app to ${android ? 'Google Play' : 'Apple App Store Connect'}!\n`;
    at += 3 * MINUTE;
  }
  if (status === 'success') log += 'Build successful\n';
  Object.assign(build, { phases, finishedAt: at + 2000 });
  if (status === 'failed') { build.reason = failing[1]; build.hint = diagnose(log); }
  if (status === 'success') {
    const before = seeded.filter((item) => item.status === 'success' && item.project === project.name && item.profile === profile && item.platform === platform).at(-1);
    const size = (BASE_SIZE[project.name] - (android ? 9 : 0) - (store && android ? 6 : 0) + (seeded.length * 0.06) + grow) * 1048576;
    build.app = { id: project.bundle, name: project.title, version: project.version, number: String(40 + serial) };
    if (!android && !simulator) {
      build.signing = store
        ? { profile: `*[expo] ${project.bundle} AppStore`, team: 'Acme Labs (T3AM1D2345)', expires: new Date(NOW + 290 * DAY).toISOString(), devices: 0 }
        : { profile: `*[expo] ${project.bundle} AdHoc`, team: 'Acme Labs (T3AM1D2345)', expires: new Date(NOW + 22 * DAY).toISOString(), devices: 4 };
      build.runtime = project.version;
    }
    Object.assign(build, { installable: !store && !simulator, ipaBytes: Math.round(size), sizeBefore: before?.ipaBytes, expired: !file });
    if (submit) build.submission = `https://expo.dev/accounts/acme/projects/${project.name}/submissions/6f1c2a0e-${String(serial).padStart(4, '0')}-4d3b-9a51-2c7e8b1d0f42`;
  }
  seeded.push(build);
  return writeBuild(build, log, status === 'success' && file);
}
function writeBuild(build, log, file = false) {
  mkdirSync(join(DATA, build.id));
  writeFileSync(join(DATA, build.id, 'meta.json'), JSON.stringify(build));
  writeFileSync(join(DATA, build.id, 'build.log'), log);
  if (file) writeFileSync(join(DATA, build.id, build.artifact), 'demo');
}
const [notes, recipes, pulse] = PROJECTS;
const history = [
  [notes, { ago: 2 * HOUR, file: true, minutes: 8, by: 'Priya Natarajan' }], [pulse, { ago: 5 * HOUR, branch: 'feature/onboarding', status: 'failed', failure: 'device', minutes: 7, trigger: 'pr' }],
  [notes, { ago: 6 * HOUR, profile: 'simulator', file: true, minutes: 6, by: 'Alex Rivera' }],
  [recipes, { ago: 7 * HOUR, profile: 'production', submit: true, file: true, minutes: 14, trigger: 'nightly', grow: 3.9 }], [notes, { ago: 9 * HOUR, branch: 'feature/folders', file: true, trigger: 'pr' }],
  [notes, { ago: 11 * HOUR, branch: 'feature/folders', status: 'skipped', trigger: 'pr' }],
  [pulse, { ago: 20 * HOUR, platform: 'android', file: true, minutes: 7, by: 'Sam Chen' }], [pulse, { ago: 26 * HOUR, branch: 'fix/launch', file: true, minutes: 8 }],
  [notes, { ago: 28 * HOUR, source: 'working', file: true, minutes: 7 }], [recipes, { ago: 30 * HOUR, branch: 'feature/meal-plan', status: 'cancelled' }],
  [pulse, { ago: 1.6 * DAY, platform: 'android', status: 'failed', failure: 'java', minutes: 4 }],
  [notes, { ago: 2 * DAY, profile: 'production', submit: true, file: true, minutes: 13 }], [pulse, { ago: 2.2 * DAY, step: 1, file: true, minutes: 10 }],
  [recipes, { ago: 2.6 * DAY, step: 1, status: 'failed', failure: 'pods', minutes: 3 }], [recipes, { ago: 2.8 * DAY, step: 1, minutes: 11 }],
  [notes, { ago: 3.1 * DAY, step: 1, trigger: 'push' }], [notes, { ago: 3.3 * DAY, step: 1, status: 'skipped', trigger: 'push' }],
  [pulse, { ago: 3.5 * DAY, step: 2, profile: 'preview', minutes: 9 }], [notes, { ago: 4 * DAY, step: 2, profile: 'preview', minutes: 10 }],
  [recipes, { ago: 4.4 * DAY, step: 2, profile: 'production', submit: true, minutes: 15, trigger: 'nightly' }], [pulse, { ago: 4.7 * DAY, step: 2, platform: 'android', profile: 'production', submit: true, minutes: 11 }],
  [pulse, { ago: 5 * DAY, step: 2, status: 'failed', failure: 'device', minutes: 6 }],
  [notes, { ago: 5.5 * DAY, step: 3, minutes: 11 }], [recipes, { ago: 6 * DAY, step: 3 }], [notes, { ago: 6.6 * DAY, step: 3, trigger: 'rebuild', minutes: 9 }],
  [pulse, { ago: 7.2 * DAY, step: 3, minutes: 12 }], [notes, { ago: 8 * DAY, step: 4, profile: 'production', submit: true, minutes: 16 }],
  [recipes, { ago: 8.5 * DAY, step: 4, minutes: 10 }], [notes, { ago: 9.1 * DAY, step: 4, status: 'failed', failure: 'swift', minutes: 5 }],
  [pulse, { ago: 9.6 * DAY, step: 4, minutes: 12 }], [notes, { ago: 10.3 * DAY, step: 5, minutes: 13 }], [recipes, { ago: 11 * DAY, step: 5, minutes: 12 }],
  [notes, { ago: 11.8 * DAY, step: 6, minutes: 14 }], [pulse, { ago: 12.4 * DAY, step: 5, minutes: 13 }], [notes, { ago: 13.2 * DAY, step: 7, minutes: 15 }],
];
// Oldest first, so a reused build and a size change can refer to the build before.
for (const [project, options] of history.sort((a, b) => b[1].ago - a[1].ago)) seedBuild(project, options);

// OTA updates, for the project's OTA page: notes on both channels, one that failed, and one for recipes.
function seedUpdate(project, { ago, branch = 'main', step = 0, channel, platform = 'all', status = 'success', message, by, reason }) {
  const commits = project.commits[branch];
  const commit = commits[Math.max(0, commits.length - 1 - step)];
  const createdAt = NOW - ago; const startedAt = createdAt + 1500; const finishedAt = startedAt + 95000;
  const group = createHash('sha1').update(`${project.name}${ago}`).digest('hex');
  const build = {
    id: `${new Date(createdAt).toISOString().replace(/\D/g, '').slice(0, 14)}-update-${project.name}`, project: project.name, action: 'update', profile: channel, channel, environment: channel,
    platform, updateMessage: message, ref: branch, source: 'github', trigger: 'manual', by: by ? { name: by, login: `${by.split(' ')[0].toLowerCase()}@acme.dev` } : null,
    status, createdAt, startedAt, finishedAt, phases: [{ name: 'UPDATE', at: startedAt }], repo: project.repo,
    commit: { hash: commit.hash, short: commit.hash.slice(0, 7), subject: commit.subject, author: commit.author, date: commit.when, url: `https://github.com/${project.repo}/commit/${commit.hash}` },
    ...(status === 'success' ? { updateUrl: `https://expo.dev/accounts/acme/projects/${project.name}/updates/${group.slice(0, 8)}-${group.slice(8, 12)}-4${group.slice(13, 16)}-a${group.slice(17, 20)}-${group.slice(20, 32)}` } : { reason }),
  };
  const log = `[UPDATE] Exporting ${platform === 'all' ? 'iOS and Android' : platform} bundles\n[UPDATE] Uploading 4 assets\n${status === 'success' ? `[UPDATE] ✔ Published!\n[UPDATE] Branch ${channel}\n[UPDATE] Update group ${build.updateUrl}\n` : `[UPDATE] ${reason}\n`}`;
  writeBuild(build, log);
}
seedUpdate(notes, { ago: 5 * HOUR, channel: 'preview', platform: 'ios', message: 'Search across notebooks', by: 'Priya Natarajan', step: 2 });
seedUpdate(notes, { ago: 1.2 * DAY, channel: 'production', message: 'Fix keyboard overlap on login', by: 'Alex Rivera', step: 1 });
seedUpdate(notes, { ago: 2.4 * DAY, channel: 'preview', message: 'Pin notes to the top', status: 'failed', reason: 'Error: EXPO_PUBLIC_API_URL is not set in the preview environment', by: 'Sam Chen', step: 4 });
seedUpdate(notes, { ago: 4.5 * DAY, channel: 'production', message: 'Speed up image cache', by: 'Alex Rivera', step: 3 });
seedUpdate(recipes, { ago: 2 * DAY, channel: 'production', message: 'Localize into Spanish', by: 'Jordan Lee', step: 2 });

// Automatic builds: every push to notes' main, its pull requests, and recipes to TestFlight every night. All up to date.
const today = new Date(); const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
writeFileSync(join(DIR, 'ui.json'), JSON.stringify({
  githubStatus: true, setupComplete: true, loginAtLogin: true,
  triggers: [
    { project: 'notes', on: 'push', branch: 'main', profile: 'development', platform: 'ios', submit: false, skipUnchanged: true, sha: notes.commits.main.at(-1).hash },
    { project: 'notes', on: 'pr', profile: 'development', platform: 'ios', submit: false, skipUnchanged: true, prs: { 48: notes.commits['feature/folders'].at(-1).hash } },
    { project: 'recipes', on: 'nightly', branch: 'main', at: '02:00', profile: 'production', platform: 'ios', submit: true, sha: recipes.commits.main.at(-1).hash, lastRun: todayKey },
  ],
}, null, 2));
// A home folder for the server, with the folders Disk cleanup measures (their sizes come from the du stand-in).
const HOME = DIR; // so the projects above read as ~/code/... in setup
for (const folder of ['Library/Developer/Xcode/DerivedData/CompilationCache.noindex', 'Library/Developer/Xcode/iOS DeviceSupport', 'Library/Caches/CocoaPods',
  '.gradle/caches', '.cache/macbuild', 'Library/Developer/CoreSimulator/Devices', 'Library/Android/sdk']) mkdirSync(join(HOME, folder), { recursive: true });

// Apps for the setup page (#/setup) to find: two in the usual folders that macbuild doesn't have yet, and one the
// agent finds outside them. The agent is a stand-in too (fake-agent.mjs, as claude and codex), so setup runs offline.
const json = (file, data) => writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
for (const [dir, title, extra, eas] of [
  ['code/habit', 'Habit', { 'expo-dev-client': '~6.0.0' }, null],
  ['Developer/wallet', 'Wallet', {}, { build: { development: { developmentClient: true, distribution: 'internal' }, production: {} } }],
  ['clients/fieldnotes', 'Field Notes', { 'expo-dev-client': '~6.0.0' }, { build: { development: { developmentClient: true, distribution: 'internal' }, production: {} } }],
]) {
  const app = join(HOME, dir); const slug = dir.split('/')[1];
  mkdirSync(app, { recursive: true });
  json(join(app, 'package.json'), { name: slug, dependencies: { expo: slug === 'wallet' ? '~53.0.0' : '~54.0.0', ...extra } });
  json(join(app, 'app.json'), { expo: { name: title, slug, ...(slug === 'wallet' ? { ios: { bundleIdentifier: 'com.acme.wallet' } } : {}), ...(slug === 'fieldnotes' ? { ios: { bundleIdentifier: 'com.northwind.fieldnotes' }, android: { package: 'com.northwind.fieldnotes' }, extra: { eas: { projectId: '7c1d-fieldnotes' } } } : {}) } });
  if (eas) json(join(app, 'eas.json'), eas);
  git(app, ['init', '-q', '-b', 'main']);
  git(app, ['remote', 'add', 'origin', `https://github.com/${slug === 'fieldnotes' ? 'northwind' : 'acme'}/${slug}.git`]);
}
for (const name of ['claude', 'codex']) symlinkSync(join(HERE, 'fake-agent.mjs'), join(BIN, name));

// Stand-ins on PATH. git only fakes the network; everything else is real git.
const script = (name, body) => writeFileSync(join(BIN, name), `#!/bin/bash\n${body}`, { mode: 0o755 });
script('git', `REAL=$(PATH=\${PATH#*:} command -v git)
dir=.; cmd=$1; [ "$1" = -C ] && { dir=$2; cmd=$3; }
case "$cmd" in
  fetch) exit 0;;
  ls-remote) ref=\${@: -1}; sha=$("$REAL" -C "$dir" rev-parse -q --verify "refs/remotes/origin/\${ref#refs/heads/}") && printf '%s\\t%s\\n' "$sha" "$ref"; exit 0;;
esac
exec "$REAL" "$@"
`);
script('xcodebuild', 'echo "Xcode 26.1"; echo "Build version 17B55"\n');
script('scutil', 'echo "Studio Mac"\n');
script('sysctl', 'echo "Apple M3 Pro"\n');
script('sw_vers', 'echo "26.1"\n');
// Sizes for the folders Disk cleanup measures, in KB, as if the Mac had been building for a while.
script('du', `case "$2" in
  */CompilationCache.noindex) echo "6815744	$2";; */DerivedData) echo "25165824	$2";; *"iOS DeviceSupport") echo "15728640	$2";;
  */CocoaPods) echo "2621440	$2";; */.gradle/caches) echo "4194304	$2";; */.cache/macbuild) echo "3145728	$2";; */CoreSimulator/Devices) echo "9437184	$2";;
  *) exec "$(PATH=\${PATH#*:} command -v du)" "$@";;
esac
`);
// Tailscale, signed in, with the dashboard on the tailnet: setup's Phone step shows the link and its QR code. The demo
// names it in MACBUILD_TAILSCALE, so it never touches the Tailscale on this Mac.
script('tailscale', `case "$1 $2" in
  "status --json") echo '{"BackendState":"Running","Self":{"Online":true,"DNSName":"studio-mac.tail4f2a.ts.net."}}';;
  "serve status") echo "https://studio-mac.tail4f2a.ts.net:8443 (tailnet only)"; echo "|-- / proxy http://127.0.0.1:\${MACBUILD_UI_PORT:-4180}";;
  *) exit 0;;
esac
`);
// A paired iPhone, for setup's "install builds on which iPhone?".
script('xcrun', `[ "$1 $2 $3" = "devicectl list devices" ] || exit 1
out=""; while [ $# -gt 0 ]; do [ "$1" = --json-output ] && out=$2; shift; done
echo '{"result":{"devices":[{"identifier":"8A4F2C1E-5B6D-4E7F-9A0B-1C2D3E4F5A6B","connectionProperties":{"transportType":"localNetwork","pairingState":"paired"},"hardwareProperties":{"udid":"00008140-001A2D3E0C38801C","marketingName":"iPhone 16 Pro","deviceType":"iPhone"},"deviceProperties":{"name":"Alex’s iPhone"}}]}}' > "$out"
`);
// npx expo start runs the stand-in dev server (fake-expo.mjs); npx expo install, for setup's fixes, adds the package to
// package.json the way expo install would.
script('npx', `[ "$1 $2" = "expo start" ] && exec node ${JSON.stringify(join(HERE, 'fake-expo.mjs'))} "$@"
node -e 'const f="package.json";const p=require(require("path").resolve(f));p.dependencies[process.argv[1]]="~6.0.0";require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\\n")' "\${@: -1}"; echo "› Installed \${@: -1}"
`);
script('pmset', `echo "Now drawing from 'AC Power'"; echo " -InternalBattery-0 (id=4653155)	100%; charged; 0:00 remaining present: true"\n`);
const expo = (project) => ({
  info: `fullName  @acme/${project.name}\nID        ${project.name}-4c1e-9a2b`,
  submissions: [
    { id: 's1', status: 'FINISHED', createdAt: new Date(NOW - 7 * HOUR).toISOString(), iosConfig: { ascAppIdentifier: '6741234501' } },
    { id: 's2', status: 'FINISHED', createdAt: new Date(NOW - 2 * DAY).toISOString(), iosConfig: { ascAppIdentifier: '6741234501' } },
    { id: 's3', status: 'ERRORED', createdAt: new Date(NOW - 8 * DAY).toISOString(), iosConfig: { ascAppIdentifier: '6741234501' } },
  ],
  channels: { currentPage: [
    { name: 'production', isPaused: false, updateBranches: [{ name: 'production', updateGroups: [1, 2, 3, 4] }] },
    { name: 'preview', isPaused: false, updateBranches: [{ name: 'preview', updateGroups: [1, 2] }] },
    { name: 'development', isPaused: true, updateBranches: [{ name: 'development', updateGroups: [1] }] },
  ] },
  cloud: [
    { buildProfile: 'production', status: 'FINISHED', createdAt: new Date(NOW - 40 * DAY).toISOString(), appVersion: '2.1.0', appBuildVersion: '31' },
    { buildProfile: 'development', status: 'FINISHED', createdAt: new Date(NOW - 45 * DAY).toISOString(), appVersion: '2.1.0', appBuildVersion: '30' },
    { buildProfile: 'preview', status: 'ERRORED', createdAt: new Date(NOW - 47 * DAY).toISOString(), appVersion: '2.0.4', appBuildVersion: '29' },
  ],
});
writeFileSync(join(DIR, 'expo.json'), JSON.stringify(Object.fromEntries(PROJECTS.map((project) => [project.dir, expo(project)]))));
script('eas', `# Answers the read-only commands the dashboard runs, from expo.json keyed by project folder.
data() { node -e 'const d=require(process.argv[1])[process.argv[2]];const v=process.argv[3].split(".").reduce((o,k)=>o[k],d);console.log(typeof v==="string"?v:JSON.stringify(v))' "${DIR}/expo.json" "$PWD" "$1"; }
case "$1" in
  --version) echo "eas-cli/16.20.0 darwin-arm64 node-v22.17.0";;
  whoami) echo acme;;
  credentials:configure-build) echo "✔ Logged in as acme"; sleep 0.6
    echo "✔ Using remote iOS credentials (Expo server)"; sleep 0.6
    echo "  Distribution certificate   valid for 290 more days"
    echo "  Provisioning profile       AdHoc, 4 registered devices"; sleep 0.4
    echo "✔ All credentials are ready to build";;
  init) node -e 'const f="app.json";const p=require(require("path").resolve(f));p.expo.extra={...p.expo.extra,eas:{projectId:"5e2a-"+p.expo.slug}};require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\\n")'; echo "✔ Linked to @acme";;
  project:info) data info;;
  submit:list) data submissions;;
  channel:list) data channels;;
  build:list) data cloud;;
  env:list) case "$2" in
    production) printf 'EXPO_PUBLIC_API_URL=https://api.example.com\\nSENTRY_AUTH_TOKEN=*****\\nEXPO_PUBLIC_POSTHOG_KEY=phc_x\\n';;
    preview) printf 'EXPO_PUBLIC_API_URL=https://staging.example.com\\nSENTRY_AUTH_TOKEN=*****\\n';;
    *) printf 'EXPO_PUBLIC_API_URL=http://localhost:3000\\n';; esac;;
  device:list) printf 'Name   Alex’s iPhone 16 Pro\\nClass  IPHONE\\nUDID   00008140-001A2D3E0C38801C\\n\\nName   Test iPad Air\\nClass  IPAD\\nUDID   00008103-000E59A21E90401E\\n\\nName   Priya’s iPhone 15\\nClass  IPHONE\\nUDID   00008120-0016440C3C61A01E\\n';;
  *) exit 1;;
esac
`);
script('gh', `# Pull requests and checks for the sample repositories.
case "$1 $2" in
  "auth status") echo "Logged in to github.com account acme" >&2;;
  "pr list") case " $* " in
    *" --head "*) echo '[{"number":48,"title":"Nested folders","url":"https://github.com/acme/notes/pull/48"}]';;
    *) echo '[{"number":48,"headRefName":"feature/folders","title":"Nested folders","url":"https://github.com/acme/notes/pull/48"},{"number":51,"headRefName":"feature/onboarding","title":"Onboarding carousel","url":"https://github.com/acme/pulse/pull/51"},{"number":44,"headRefName":"feature/meal-plan","title":"Weekly meal plan","url":"https://github.com/acme/kitchen/pull/44"}]';;
  esac;;
  "api "*) echo '{"check_runs":[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"success"}]}';;
  *) exit 1;;
esac
`);
// The builder: writes a believable log over time, then an IPA. DEMO_BUILD_SECONDS sets how long the compile step runs.
script('macbuild', `case "$1" in
  doctor) echo '{"ok":true,"items":[{"id":"macos","label":"macOS","status":"ok","detail":"26.1"},{"id":"xcode","label":"Xcode","status":"ok","detail":"Xcode 26.1"},{"id":"node","label":"node","status":"ok","detail":"v22.17.0"},{"id":"eas-cli","label":"eas-cli","status":"ok","detail":"eas-cli/16.0.0"},{"id":"expo-login","label":"Expo login","status":"ok","detail":"acme"},{"id":"projects","label":"projects","status":"ok","detail":"3 listed"}]}'; exit 0;;
  scan) exit 0;;
esac
out=""; for a in "$@"; do [ "$prev" = --output ] && out=$a; prev=$a; done
LOG=\${MACBUILD_LOG:-/dev/stdout}
say() { echo "[$1] $2" >> "$LOG"; }
for phase in SETUP_WORKINGDIR START_BUILD READ_EAS_JSON READ_PACKAGE_JSON; do say $phase "Starting"; sleep 0.4; done
say INSTALL_DEPENDENCIES 'Running "npm ci --include=dev"'; sleep 3; say INSTALL_DEPENDENCIES "added 1284 packages in 49s"
for phase in READ_APP_CONFIG RUN_EXPO_DOCTOR PREPARE_CREDENTIALS PREBUILD; do say $phase "Done"; sleep 1; done
say INSTALL_PODS "Installing pods"; sleep 3; say INSTALL_PODS "Pod installation complete! 121 total pods installed."
say RUN_FASTLANE 'Running "fastlane ios build"'
end=$((SECONDS + \${DEMO_BUILD_SECONDS:-60})); n=0
while [ $SECONDS -lt $end ]; do n=$((n + 1)); say RUN_FASTLANE "▸ Compiling module $n of 412"; sleep 0.5; done
say RUN_FASTLANE "** ARCHIVE SUCCEEDED **"; say PREPARE_ARTIFACTS "Preparing artifacts"; echo "Build successful" >> "$LOG"
[ -z "$out" ] || echo demo > "$out"
`);

// The dashboard listens on an inner port behind a small proxy that names it as 127.0.0.1, so the demo also opens
// through preview proxies that send their own Host. The real dashboard answers only loopback and tailnet names.
const INNER = PORT + 1000;
const ENV = {
  ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}`, MACBUILD_BIN: join(BIN, 'macbuild'),
  MACBUILD_DATA: DATA, MACBUILD_PROJECTS: join(DIR, 'projects.conf'), MACBUILD_CONFIG: join(DIR, 'ui.json'),
  FAKE_AGENT_DELAY: process.env.FAKE_AGENT_DELAY ?? '420', FAKE_AGENT_EXTRA: join(HOME, 'clients/fieldnotes'), MACBUILD_NO_TERMINAL: '1',
  MACBUILD_TAILSCALE: join(BIN, 'tailscale'),
};
createServer((req, res) => {
  const upstream = httpRequest({ host: '127.0.0.1', port: INNER, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${INNER}` } }, (reply) => {
    res.writeHead(reply.statusCode, reply.headers); reply.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(PORT, '127.0.0.1');
// The terminal setup in a browser, on the next port: the real `macbuild setup` against these sample apps.
const terminal = startTerminal({ port: PORT + 1, env: { ...ENV, MACBUILD_UI_PORT: String(PORT), MACBUILD_SETUP_DEMO: '1', DEMO_BUILD_SECONDS: '12' } });
const server = spawn(process.execPath, [join(HERE, '..', 'server.mjs')], {
  stdio: 'inherit',
  env: {
    ...ENV, MACBUILD_UI_PORT: String(INNER), MACBUILD_APPLE_TEAM: 'T3AM1D2345', DEMO_BUILD_SECONDS: process.env.DEMO_BUILD_SECONDS ?? '600',
  },
});
const post = (body) => fetch(`http://127.0.0.1:${PORT}/api/builds`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify(body) });
for (let tries = 0; tries < 50; tries += 1) {
  if (await fetch(`http://127.0.0.1:${PORT}/api/builds`).then((res) => res.ok, () => false)) break;
  await new Promise((resolve) => { setTimeout(resolve, 100); });
}
await post({ project: 'notes', profile: 'development', ref: 'feature/folders', label: 'feature/folders' });
await new Promise((resolve) => { setTimeout(resolve, 1100); });
await post({ project: 'pulse', profile: 'production', platform: 'android', ref: 'main', label: 'main', submit: true });
// pulse's dev server, started "in a terminal" (not by the dashboard), for the dashboard to find and follow.
const terminalExpo = spawn(process.execPath, [join(HERE, 'fake-expo.mjs'), 'expo', 'start', '--port', '8090'], { cwd: PROJECTS.find((project) => project.name === 'pulse').dir, env: ENV, stdio: 'ignore' });
// notes' dev server, running when the demo opens, as if someone had started it from their phone.
await fetch(`http://127.0.0.1:${PORT}/api/dev/notes/start`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify({ connection: 'tailnet', cols: 96, rows: 30 }) });
console.log(`macbuild demo: http://localhost:${PORT}  (data in ${DIR})`);
console.log(`terminal setup: http://localhost:${PORT + 1}`);
const stop = () => { terminal.stop(); terminalExpo.kill('SIGINT'); server.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
