// The dashboard with sample projects and builds, for working on the UI and for the README screenshots. Nothing here
// touches your real projects or settings: everything lives in a temporary folder, and eas, gh, git's network calls,
// xcodebuild and pmset are stand-ins.
//   node ui/demo/demo.mjs [--port 4181]     then open http://localhost:4181
// One build is running when the demo starts and another is queued behind it.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  // An app.json icon where the demo has one; pulse uses app.config.ts, so the dashboard falls back to a monogram.
  if (existsSync(join(HERE, `${project.name}.png`))) {
    mkdirSync(join(app, 'assets'));
    copyFileSync(join(HERE, `${project.name}.png`), join(app, 'assets/icon.png'));
    writeFileSync(join(app, 'app.json'), `${JSON.stringify({ expo: { name: project.title, slug: project.name, version: project.version, icon: './assets/icon.png', ios: { bundleIdentifier: project.bundle } } }, null, 2)}\n`);
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

// Build history: three weeks of builds across the projects, with logs grouped into EAS's phases.
const PHASES = [
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
const FAILURES = [
  ['RUN_FASTLANE', '❌ error: Provisioning profile "*[expo] com.acme.pulse AdHoc" doesn\'t include the currently selected device "Priya’s iPhone".'],
  ['INSTALL_PODS', 'Error: [!] CocoaPods could not find compatible versions for pod "ExpoModulesCore"'],
  ['RUN_FASTLANE', '❌ error: Value of type \'NotesStore\' has no member \'syncNow\''],
];
let serial = 0;
function seedBuild(project, { ago, branch = 'main', step = 0, profile = 'development', status = 'success', testflight = false, trigger = 'manual', source = 'github', ipa = false, minutes = 9 }) {
  serial += 1;
  const commits = project.commits[branch];
  const commit = commits[Math.max(0, commits.length - 1 - step)];
  const createdAt = NOW - ago;
  const startedAt = createdAt + 2000 + (serial % 5) * 1000;
  const failure = status === 'failed' ? FAILURES[serial % FAILURES.length] : null;
  const scale = (minutes * MINUTE + ((serial * 7919) % 50) * 1000) / PHASES.reduce((sum, [, seconds]) => sum + seconds * 1000, 0);
  let at = startedAt;
  const phases = [];
  let log = '';
  for (const [name, seconds, lines] of PHASES) {
    phases.push({ name, at });
    const stops = failure?.[0] === name || (status === 'cancelled' && name === 'INSTALL_PODS');
    log += (stops ? lines.slice(0, Math.ceil(lines.length / 2)) : lines).map((line) => `[${name}] ${line}\n`).join('');
    at += seconds * 1000 * scale * (stops ? 0.6 : 1);
    if (failure?.[0] === name) { log += `[${name}] ${failure[1]}\n`; break; }
    if (stops) break;
  }
  if (testflight && status === 'success') {
    phases.push({ name: 'SUBMIT', at });
    log += 'Scheduling iOS submission\nSubmitted your app to Apple App Store Connect!\n';
    at += 3 * MINUTE;
  }
  if (status === 'success') log += 'Build successful\n';
  const store = profile === 'production';
  const id = `${new Date(createdAt).toISOString().replace(/\D/g, '').slice(0, 14)}-${project.name}`;
  const build = {
    id, project: project.name, action: testflight ? 'testflight' : 'build', profile, distribution: store ? 'store' : 'internal', channel: profile,
    source, ref: branch, trigger, status, createdAt, startedAt, finishedAt: at + 2000, phases,
    commit: { hash: commit.hash, short: commit.hash.slice(0, 7), subject: commit.subject, author: commit.author, date: commit.when, url: `https://github.com/${project.repo}/commit/${commit.hash}` },
    pr: branch !== 'main' ? { number: 40 + (serial % 30), title: commit.subject, url: `https://github.com/${project.repo}/pull/${40 + (serial % 30)}` } : null,
    repo: project.repo, dirty: source === 'working' ? 3 : 0,
  };
  if (status === 'failed') build.reason = failure[1];
  if (status === 'success') {
    build.app = { id: project.bundle, name: project.title, version: project.version, number: String(40 + serial) };
    build.signing = store
      ? { profile: `*[expo] ${project.bundle} AppStore`, team: 'Acme Labs (T3AM1D2345)', expires: new Date(NOW + 290 * DAY).toISOString(), devices: 0 }
      : { profile: `*[expo] ${project.bundle} AdHoc`, team: 'Acme Labs (T3AM1D2345)', expires: new Date(NOW + 22 * DAY).toISOString(), devices: 4 };
    build.installable = !store; build.ipaBytes = (38 + (serial % 9)) * 1048576; build.runtime = project.version;
    build.expired = !ipa;
    if (testflight) build.submission = `https://expo.dev/accounts/acme/projects/${project.name}/submissions/6f1c2a0e-${String(serial).padStart(4, '0')}-4d3b-9a51-2c7e8b1d0f42`;
  }
  mkdirSync(join(DATA, id));
  writeFileSync(join(DATA, id, 'meta.json'), JSON.stringify(build));
  writeFileSync(join(DATA, id, 'build.log'), log);
  if (status === 'success' && ipa) writeFileSync(join(DATA, id, 'app.ipa'), 'demo');
}
const [notes, recipes, pulse] = PROJECTS;
const history = [
  [notes, { ago: 2 * HOUR, ipa: true, minutes: 8 }], [pulse, { ago: 5 * HOUR, branch: 'feature/onboarding', status: 'failed', minutes: 7 }],
  [recipes, { ago: 7 * HOUR, profile: 'production', testflight: true, ipa: true, minutes: 14 }], [notes, { ago: 9 * HOUR, branch: 'feature/folders', ipa: true, trigger: 'push' }],
  [pulse, { ago: 26 * HOUR, branch: 'fix/launch', ipa: true, minutes: 8 }], [notes, { ago: 28 * HOUR, source: 'working', ipa: true, minutes: 7 }],
  [recipes, { ago: 30 * HOUR, branch: 'feature/meal-plan', status: 'cancelled' }], [notes, { ago: 2 * DAY, profile: 'production', testflight: true, ipa: true, minutes: 13 }],
  [pulse, { ago: 2.2 * DAY, step: 1, ipa: true, minutes: 10 }], [recipes, { ago: 2.6 * DAY, step: 1, status: 'failed', minutes: 3 }],
  [recipes, { ago: 2.8 * DAY, step: 1, minutes: 11 }], [notes, { ago: 3.1 * DAY, step: 1, trigger: 'push' }],
  [pulse, { ago: 3.5 * DAY, step: 2, profile: 'preview', minutes: 9 }], [notes, { ago: 4 * DAY, step: 2, profile: 'preview', minutes: 10 }],
  [recipes, { ago: 4.4 * DAY, step: 2, profile: 'production', testflight: true, minutes: 15 }], [pulse, { ago: 5 * DAY, step: 2, status: 'failed', minutes: 6 }],
  [notes, { ago: 5.5 * DAY, step: 3, minutes: 11 }], [recipes, { ago: 6 * DAY, step: 3 }], [notes, { ago: 6.6 * DAY, step: 3, trigger: 'rebuild', minutes: 9 }],
  [pulse, { ago: 7.2 * DAY, step: 3, minutes: 12 }], [notes, { ago: 8 * DAY, step: 4, profile: 'production', testflight: true, minutes: 16 }],
  [recipes, { ago: 8.5 * DAY, step: 4, minutes: 10 }], [notes, { ago: 9.1 * DAY, step: 4, status: 'failed', minutes: 5 }],
  [pulse, { ago: 9.6 * DAY, step: 4, minutes: 12 }], [notes, { ago: 10.3 * DAY, step: 5, minutes: 13 }], [recipes, { ago: 11 * DAY, step: 5, minutes: 12 }],
  [notes, { ago: 11.8 * DAY, step: 6, minutes: 14 }], [pulse, { ago: 12.4 * DAY, step: 5, minutes: 13 }], [notes, { ago: 13.2 * DAY, step: 7, minutes: 15 }],
];
for (const [project, options] of history) seedBuild(project, options);

// Build on push for notes' main branch, already up to date.
writeFileSync(join(DIR, 'ui.json'), JSON.stringify({ triggers: [{ project: 'notes', branch: 'main', profile: 'development', submit: false, sha: notes.commits.main.at(-1).hash }] }, null, 2));

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
  "pr list") case " $* " in
    *" --head "*) echo '[{"number":48,"title":"Nested folders","url":"https://github.com/acme/notes/pull/48"}]';;
    *) echo '[{"number":48,"headRefName":"feature/folders","title":"Nested folders","url":"https://github.com/acme/notes/pull/48"},{"number":51,"headRefName":"feature/onboarding","title":"Onboarding carousel","url":"https://github.com/acme/pulse/pull/51"},{"number":44,"headRefName":"feature/meal-plan","title":"Weekly meal plan","url":"https://github.com/acme/kitchen/pull/44"}]';;
  esac;;
  "api "*) echo '{"check_runs":[{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"success"},{"status":"completed","conclusion":"success"}]}';;
  *) exit 1;;
esac
`);
// The builder: writes a believable log over time, then an IPA. DEMO_BUILD_SECONDS sets how long the compile step runs.
script('macbuild', `out=""; for a in "$@"; do [ "$prev" = --output ] && out=$a; prev=$a; done
say() { echo "[$1] $2" >> "$MACBUILD_LOG"; }
for phase in SETUP_WORKINGDIR START_BUILD READ_EAS_JSON READ_PACKAGE_JSON; do say $phase "Starting"; sleep 0.4; done
say INSTALL_DEPENDENCIES 'Running "npm ci --include=dev"'; sleep 3; say INSTALL_DEPENDENCIES "added 1284 packages in 49s"
for phase in READ_APP_CONFIG RUN_EXPO_DOCTOR PREPARE_CREDENTIALS PREBUILD; do say $phase "Done"; sleep 1; done
say INSTALL_PODS "Installing pods"; sleep 3; say INSTALL_PODS "Pod installation complete! 121 total pods installed."
say RUN_FASTLANE 'Running "fastlane ios build"'
end=$((SECONDS + \${DEMO_BUILD_SECONDS:-60})); n=0
while [ $SECONDS -lt $end ]; do n=$((n + 1)); say RUN_FASTLANE "▸ Compiling module $n of 412"; sleep 0.5; done
say RUN_FASTLANE "** ARCHIVE SUCCEEDED **"; say PREPARE_ARTIFACTS "Preparing artifacts"; echo "Build successful" >> "$MACBUILD_LOG"
echo demo > "$out"
`);

const server = spawn(process.execPath, [join(HERE, '..', 'server.mjs')], {
  stdio: 'inherit',
  env: {
    ...process.env, PATH: `${BIN}:${process.env.PATH}`, MACBUILD_UI_PORT: String(PORT), MACBUILD_BIN: join(BIN, 'macbuild'),
    MACBUILD_DATA: DATA, MACBUILD_PROJECTS: join(DIR, 'projects.conf'), MACBUILD_CONFIG: join(DIR, 'ui.json'), MACBUILD_APPLE_TEAM: 'T3AM1D2345',
    DEMO_BUILD_SECONDS: process.env.DEMO_BUILD_SECONDS ?? '600',
  },
});
const post = (body) => fetch(`http://127.0.0.1:${PORT}/api/builds`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify(body) });
for (let tries = 0; tries < 50; tries += 1) {
  if (await fetch(`http://127.0.0.1:${PORT}/api/builds`).then((res) => res.ok, () => false)) break;
  await new Promise((resolve) => { setTimeout(resolve, 100); });
}
await post({ project: 'notes', profile: 'development', ref: 'feature/folders', label: 'feature/folders' });
await new Promise((resolve) => { setTimeout(resolve, 1100); });
await post({ project: 'pulse', profile: 'production', ref: 'main', label: 'main', submit: true });
console.log(`macbuild demo: http://localhost:${PORT}  (data in ${DIR})`);
const stop = () => { server.kill(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
