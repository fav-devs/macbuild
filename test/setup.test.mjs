// First-time setup (lib/setup.mjs): finding apps, the agent's answers and what macbuild does with them, the terminal UI
// driven through a pseudo-terminal, and the dashboard's #/setup endpoints. The agent is ui/demo/fake-agent.mjs, run as
// `claude` or `codex`, so nothing here needs an account or the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SetupFlow, applyAction, checkApp, describeAction, detectTailscale, nameApps, ownReview, quickScan, readApp, readProjects, sanitizeFound, sanitizeReview, writeSetting,
} from '../lib/setup.mjs';
import { lastJson, runAgent, toolActivity } from '../lib/setup-agent.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = join(ROOT, 'ui/demo/fake-agent.mjs');
const json = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };
const DEV = { build: { development: { developmentClient: true, distribution: 'internal' }, production: {} } };

// A home folder with: a ready app, a monorepo app missing its bundle identifier, an app without eas.json, an example
// inside node_modules that must be skipped, and one app outside the usual folders that only the agent finds.
function home({ agents = ['claude'] } = {}) {
  // The real path: on macOS the temp folder is behind a symlink, and setup keeps real paths.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'macbuild-setup-')));
  const app = (path, deps, expo, eas) => {
    json(join(dir, path, 'package.json'), { dependencies: { expo: '~54.0.0', ...deps } });
    if (expo) json(join(dir, path, 'app.json'), { expo });
    if (eas) json(join(dir, path, 'eas.json'), eas);
  };
  app('code/notes', { 'expo-dev-client': '6' }, { name: 'Notes', slug: 'notes', ios: { bundleIdentifier: 'com.acme.notes' }, platforms: ['ios'], extra: { eas: { projectId: 'p1' } } }, DEV);
  app('Developer/kitchen/apps/mobile', { 'expo-dev-client': '6' }, { name: 'Recipes', slug: 'recipes', platforms: ['ios'], extra: { eas: { projectId: 'p2' } } }, DEV);
  app('Projects/pulse', {}, { name: 'Pulse', slug: 'pulse', ios: { bundleIdentifier: 'com.acme.pulse' }, platforms: ['ios'], extra: { eas: { projectId: 'p3' } } }, null);
  app('code/notes/node_modules/expo/templates/blank', {}, { name: 'Blank' }, null);
  app('clients/field', { 'expo-dev-client': '6' }, { name: 'Field', slug: 'field', ios: { bundleIdentifier: 'com.acme.field' }, platforms: ['ios'], extra: { eas: { projectId: 'p4' } } }, DEV);
  mkdirSync(join(dir, 'bin'));
  for (const name of agents) symlinkSync(FAKE, join(dir, 'bin', name));
  // npx expo install, as setup runs it: adds the package to package.json.
  writeFileSync(join(dir, 'bin/npx'), `#!/bin/sh\nnode -e 'const p=require(process.cwd()+"/package.json");p.dependencies[process.argv[1]]="6";require("fs").writeFileSync("package.json",JSON.stringify(p))' "$4"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'bin/eas'), '#!/bin/sh\ncase "$1" in --version) echo "eas-cli/16.19.3";; whoami) echo acme;; credentials:configure-build) echo "credentials ready";; *) exit 1;; esac\n', { mode: 0o755 });
  // What `macbuild doctor` looks for, so the terminal test sees a ready Mac on Linux too.
  for (const [name, out] of [['xcodebuild', 'Xcode 26.1'], ['pod', '1.16.2'], ['fastlane', 'fastlane'], ['sw_vers', '26.1']]) writeFileSync(join(dir, 'bin', name), `#!/bin/sh\necho "${out}"\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'bin/uname'), '#!/bin/sh\n[ -z "$1" ] && echo Darwin || /usr/bin/env -i PATH=/usr/bin:/bin uname "$@"\n', { mode: 0o755 });
  const env = { ...process.env, HOME: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_AGENT_DELAY: '5', FAKE_AGENT_EXTRA: join(dir, 'clients/field'), FAKE_AGENT_LOG: join(dir, 'agent-calls') };
  for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_')) delete env[name];
  return { dir, env };
}
const DOCTOR = { ok: true, items: [{ id: 'xcode', label: 'Xcode', status: 'ok', detail: 'Xcode 26.1' }, { id: 'expo-login', label: 'Expo login', status: 'ok', detail: 'acme' }, { id: 'cocoapods', label: 'CocoaPods', status: 'miss', detail: 'brew install cocoapods' }] };
function flowFor(dir, env, hooks = {}) {
  Object.assign(process.env, { PATH: env.PATH, FAKE_AGENT_DELAY: '5', FAKE_AGENT_EXTRA: env.FAKE_AGENT_EXTRA, FAKE_AGENT_LOG: env.FAKE_AGENT_LOG });
  return new SetupFlow({ home: dir, hooks: { doctor: async () => DOCTOR, devices: async () => [], tailscale: async () => ({ installed: false }), ...hooks } });
}
async function settled(flow) { let view = await flow.view(); while (view.busy) { await flow.wait(); view = await flow.view(); } return view; }
const values = (view) => Object.fromEntries(view.fields.map((field) => [field.id, field.value]));

test('the quick scan finds Expo apps, skips examples in node_modules, and names apps after their repository when the folder is generic', () => {
  const { dir } = home();
  const apps = nameApps(quickScan({ home: dir }));
  const names = apps.map((app) => app.name).sort();
  assert.deepEqual(names, ['notes', 'pulse', 'recipes']); // apps/mobile goes by its Expo slug; clients/ isn't scanned
  // Without a slug, a folder called "mobile" in "apps" is named after the folder above them.
  assert.equal(nameApps([{ path: join(dir, 'Developer/kitchen/apps/mobile'), name: '', slug: null }])[0].name, 'kitchen');
  assert.ok(!apps.some((app) => app.path.includes('node_modules')));
  assert.equal(apps.find((app) => app.name === 'pulse').easJson, false);
  assert.equal(readApp(join(dir, 'code/notes')).bundleId, 'com.acme.notes');
});

test('the checks find what would make EAS stop and ask, and suggest an identifier from the Expo account', () => {
  const { dir } = home();
  const recipes = { ...readApp(join(dir, 'Developer/kitchen/apps/mobile')), name: 'recipes' };
  const issues = checkApp(recipes, { owner: 'acme' });
  const bundle = issues.find((issue) => issue.id === 'bundle-recipes');
  assert.equal(bundle.question.default, 'com.acme.recipes');
  assert.deepEqual(bundle.action, { type: 'set_config', app: 'recipes', key: 'ios.bundleIdentifier', answer: 'bundle-recipes', why: 'EAS asks for it otherwise' });
  const pulse = { ...readApp(join(dir, 'Projects/pulse')), name: 'pulse' };
  assert.ok(checkApp(pulse).some((issue) => issue.action?.type === 'create_eas_json'));
  const notes = { ...readApp(join(dir, 'code/notes')), name: 'notes' };
  assert.deepEqual(checkApp(notes).filter((issue) => issue.severity !== 'info'), []);
  assert.match(ownReview([notes, recipes], issues).say, /notes looks ready/);
});

test('an agent’s answer is checked: unknown actions, apps, settings and bad identifiers are dropped', () => {
  const review = sanitizeReview({
    say: 'ok', done: true,
    questions: [{ id: 'bundle', kind: 'text', label: 'Bundle', help: null, options: [], default: 'com.acme.x' }, { id: 'bad id!', kind: 'text', label: 'x', options: [] }],
    actions: [
      { type: 'set_config', app: 'notes', key: 'ios.bundleIdentifier', answer: 'bundle', why: 'x' },
      { type: 'set_config', app: 'notes', key: 'ios.bundleIdentifier', value: 'not an id', why: 'x' },
      { type: 'set_config', app: 'notes', key: 'expo.owner', value: 'evil', why: 'x' },
      { type: 'run_command', app: 'notes', value: 'rm -rf ~', why: 'x' },
      { type: 'link_eas', app: 'someone-else', why: 'x' },
      { type: 'set_setting', key: 'MACBUILD_APPLE_PASSWORD_FILE', value: '/tmp/x', why: 'x' },
      { type: 'set_setting', key: 'MACBUILD_APPLE_ID', value: 'me@example.com', why: 'x' },
      { type: 'add_profile', app: 'notes', value: 'everything', why: 'x' },
    ],
  }, ['notes']);
  assert.deepEqual(review.questions.map((q) => q.id), ['bundle']);
  assert.deepEqual(review.actions.map((action) => `${action.type}:${action.key ?? ''}`), ['set_config:ios.bundleIdentifier', 'set_setting:MACBUILD_APPLE_ID']);
  const { dir } = home();
  assert.deepEqual(sanitizeFound([{ path: '/etc' }, { path: join(dir, 'nowhere') }, { path: '~/code/notes', name: 'Notes App!', suggested: true }], dir).map((app) => app.name), ['notes-app']);
});

test('fixes change only what they say, and settings never take shell characters', async () => {
  const { dir } = home();
  const appDir = join(dir, 'Developer/kitchen/apps/mobile');
  const apps = [{ name: 'recipes', dir: appDir }];
  const result = await applyAction({ type: 'set_config', app: 'recipes', key: 'ios.bundleIdentifier', answer: 'b' }, { answers: { b: 'com.acme.recipes' }, apps });
  assert.equal(result.ok, true);
  const config = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8'));
  assert.equal(config.expo.ios.bundleIdentifier, 'com.acme.recipes');
  assert.equal(config.expo.extra.eas.projectId, 'p2');
  assert.equal((await applyAction({ type: 'set_config', app: 'recipes', key: 'ios.bundleIdentifier', value: 'x; rm -rf' }, { apps })).ok, false);
  await applyAction({ type: 'add_profile', app: 'recipes', value: 'simulator' }, { apps });
  assert.deepEqual(JSON.parse(readFileSync(join(appDir, 'eas.json'), 'utf8')).build.simulator, { extends: 'development', ios: { simulator: true } });
  const env = join(dir, 'env');
  writeFileSync(env, 'MACBUILD_APPLE_ID=\nMACBUILD_DEVICE=\n');
  writeSetting(env, 'MACBUILD_SIMULATOR', 'iPhone 16 Pro');
  writeSetting(env, 'MACBUILD_APPLE_ID', 'me@example.com');
  assert.equal(readFileSync(env, 'utf8'), 'MACBUILD_APPLE_ID=me@example.com\nMACBUILD_DEVICE=\nMACBUILD_SIMULATOR="iPhone 16 Pro"\n');
  assert.throws(() => writeSetting(env, 'MACBUILD_APPLE_ID', '$(touch x)@a.b'));
  assert.throws(() => writeSetting(env, 'PATH', '/tmp'));
});

test('Claude Code runs read-only, its progress becomes short lines, and its answer comes from the stream', async () => {
  const { dir, env } = home();
  Object.assign(process.env, { FAKE_AGENT_DELAY: '5', FAKE_AGENT_LOG: env.FAKE_AGENT_LOG });
  const lines = [];
  const result = await runAgent({ agent: 'claude', bin: join(dir, 'bin/claude'), task: 'find', home: dir, cwd: dir, onActivity: (line) => lines.push(line), context: { home: dir, roots: [join(dir, 'code')], extraFolders: [], candidates: [{ path: join(dir, 'code/notes'), title: 'Notes', easJson: true }], alreadyAdded: [] } });
  assert.equal(result.ok, true);
  assert.equal(result.data.apps[0].path, join(dir, 'code/notes'));
  assert.ok(lines.includes('Reading ~/code/notes/app.json'), lines.join('\n'));
  const [call] = readFileSync(env.FAKE_AGENT_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const flag = (name) => call.args[call.args.indexOf(name) + 1];
  assert.equal(flag('--allowedTools'), 'Read,Glob,Grep');
  assert.match(flag('--disallowedTools'), /Bash.*Edit.*Write/);
  assert.equal(flag('--tools'), 'Read,Glob,Grep');
  assert.ok(call.args.includes('--json-schema'));
  assert.equal(toolActivity('Grep', { pattern: 'expo', path: '/Users/a/code' }, '/Users/a'), 'Searching ~/code for “expo”');
  assert.deepEqual(lastJson('Here you go:\n```json\n{"say":"hi","apps":[]}\n```'), { say: 'hi', apps: [] });
});

test('Codex runs in its read-only sandbox, and its answer comes from the file it writes', async () => {
  const { dir, env } = home({ agents: ['codex'] });
  Object.assign(process.env, { FAKE_AGENT_DELAY: '5', FAKE_AGENT_LOG: env.FAKE_AGENT_LOG });
  const lines = [];
  const result = await runAgent({ agent: 'codex', bin: join(dir, 'bin/codex'), task: 'find', home: dir, cwd: dir, onActivity: (line) => lines.push(line), context: { home: dir, roots: [join(dir, 'code')], extraFolders: [], candidates: [{ path: join(dir, 'code/notes'), title: 'Notes', easJson: true }], alreadyAdded: [] } });
  assert.equal(result.ok, true);
  assert.match(result.data.say, /one Expo app/);
  assert.ok(lines.some((line) => line.startsWith('Running cat ~/code/notes/')), lines.join('\n'));
  const [call] = readFileSync(env.FAKE_AGENT_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(call.args[0], 'exec');
  assert.equal(call.args[call.args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(call.args.includes('--output-schema') && call.args.includes('-o'));
});

test('a signed-out agent falls back to macbuild’s own scan, and says why', async () => {
  const { dir, env } = home();
  const flow = flowFor(dir, env);
  process.env.FAKE_AGENT_FAIL = '1';
  try {
    await flow.submit({ step: 'welcome', values: { agent: 'claude' } });
    const view = await settled(flow);
    assert.equal(view.step, 'apps');
    assert.match(view.title, /macbuild found 3 apps/);
    assert.match(view.notes.map((note) => note.text).join(' '), /Claude Code isn’t signed in.*claude/);
  } finally { delete process.env.FAKE_AGENT_FAIL; }
});

test('setup with an agent: finds apps, adds the chosen ones, fixes them, records signing, and starts a build', async () => {
  const { dir, env } = home();
  const started = [];
  const flow = flowFor(dir, env, { startBuild: async (request) => { started.push(request); return { id: '20261105-notes' }; } });
  let view = await flow.view();
  assert.equal(view.step, 'welcome');
  assert.equal(view.fields[0].value, 'claude');
  await flow.submit({ step: 'welcome', values: { agent: 'claude' } });
  assert.ok((await flow.view()).busy, 'the search runs in the background');
  view = await settled(flow);
  assert.match(view.title, /Claude Code found 4 apps/);
  assert.equal(view.by, 'Claude Code');
  const paths = view.fields.find((field) => field.id === 'apps').options.map((option) => option.value);
  assert.ok(paths.includes(join(dir, 'clients/field')), 'the agent finds apps outside the usual folders');
  // Everything except pulse, which has no eas.json; the switch to add one is turned off.
  await flow.submit({ step: 'apps', values: { apps: paths.filter((path) => !path.endsWith('pulse')), easjson: false } });
  assert.deepEqual(readProjects(join(dir, '.config/macbuild/projects.conf')).map((item) => item.name).sort(), ['field', 'notes', 'recipes']);
  view = await flow.view();
  assert.equal(view.step, 'tools');
  assert.deepEqual(view.commands.map((command) => command.display), ['brew install cocoapods']);
  await flow.submit({ step: 'tools', button: 'continue' });
  view = await settled(flow);
  assert.equal(view.step, 'review');
  const fixes = view.fields.find((field) => field.id === 'apply');
  assert.deepEqual(fixes.options.map((option) => `${option.tag}: ${option.label}`), ['recipes: Set the iOS bundle identifier']);
  const answer = view.fields.find((field) => field.attach);
  assert.equal(answer.attach.option, '0');
  await flow.submit({ step: 'review', button: 'apply', values: { ...values(view), [answer.id]: 'com.acme.recipes' } });
  view = await settled(flow);
  assert.equal(view.step, 'signing');
  assert.equal(JSON.parse(readFileSync(join(dir, 'Developer/kitchen/apps/mobile/app.json'), 'utf8')).expo.ios.bundleIdentifier, 'com.acme.recipes');
  const needed = view.commands.filter((command) => !command.optional);
  assert.deepEqual(needed.map((command) => command.label).sort(), ['field · iOS · development', 'notes · iOS · development', 'recipes · iOS · development']);
  assert.equal(needed[0].argv.join(' '), 'eas credentials:configure-build --platform ios --profile development');
  needed.sort((a, b) => (a.id === 'signing:notes:ios:development' ? -1 : b.id === 'signing:notes:ios:development' ? 1 : 0));
  // Run from Terminal, the command line ends by telling setup it finished.
  assert.match(flow.terminalLine(needed[0]), /&& eas credentials:configure-build --platform ios --profile development; .*macbuild setup --mark signing:notes:ios:development \$\?$/);
  flow.mark(needed[0].id, 0);
  assert.equal((await flow.view()).commands.find((command) => command.id === needed[0].id).status, 'done');
  await flow.submit({ step: 'signing' });
  await flow.submit({ step: 'mac', values: { appleId: 'not-an-email' } });
  assert.match((await flow.view()).notes[0].text, /doesn’t look like an Apple ID/);
  await flow.submit({ step: 'mac', values: { appleId: 'me@example.com', dashboard: false } });
  assert.match(readFileSync(join(dir, '.config/macbuild/env'), 'utf8'), /^MACBUILD_APPLE_ID=me@example.com$/m);
  view = await flow.view();
  assert.equal(view.step, 'phone');
  await flow.submit({ step: 'phone', button: 'continue' });
  view = await flow.view();
  assert.equal(view.step, 'build');
  await flow.submit({ step: 'build', button: 'build', values: { app: 'notes' } });
  assert.deepEqual(started, [{ app: 'notes', profile: 'development', install: false }]);
  view = await flow.view();
  assert.equal(view.step, 'done');
  assert.equal(view.buttons[0].href, '#/build/20261105-notes');
  assert.ok(flow.isDone());
  assert.equal(JSON.parse(readFileSync(join(dir, '.config/macbuild/ui.json'), 'utf8')).setupComplete, true);
  // The agent only ever got the two read-only tasks.
  assert.deepEqual(readFileSync(env.FAKE_AGENT_LOG, 'utf8').trim().split('\n').map((line) => JSON.parse(line).task), ['find', 'check']);
});

test('without an agent, setup uses its own checks, and a failed fix stays on screen with the answer to correct', async () => {
  const { dir, env } = home();
  const flow = flowFor(dir, env);
  await flow.submit({ step: 'welcome', values: { agent: 'none' } });
  let view = await settled(flow);
  assert.match(view.title, /macbuild found 3 apps/);
  assert.equal(view.by, null);
  await flow.submit({ step: 'apps', values: { apps: view.fields[0].value, easjson: true } });
  assert.ok(existsSync(join(dir, 'Projects/pulse/eas.json')), 'eas.json was added where it was missing');
  await flow.submit({ step: 'tools', button: 'continue' });
  view = await settled(flow);
  const labels = view.fields.find((field) => field.id === 'apply').options.map((option) => `${option.tag}: ${option.label}`);
  assert.deepEqual(labels, ['recipes: Set the iOS bundle identifier', 'pulse: Install expo-dev-client']);
  const answer = view.fields.find((field) => field.attach);
  await flow.submit({ step: 'review', button: 'apply', values: { ...values(view), [answer.id]: 'not valid!' } });
  view = await settled(flow);
  assert.equal(view.step, 'review');
  assert.match(view.notes.map((note) => note.text).join('\n'), /recipes: Set the iOS bundle identifier\. not valid! isn’t a valid iOS bundle identifier/);
  assert.match(view.notes.map((note) => note.text).join('\n'), /pulse: Install expo-dev-client/);
  assert.equal(view.fields.find((field) => field.attach).value, 'not valid!');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'Projects/pulse/package.json'), 'utf8')).dependencies['expo-dev-client'], '6');
});

test('the terminal setup walks every step with the keyboard, and running it again picks up where it left off', () => {
  const { dir, env } = home();
  const script = join(dir, 'tty.json');
  json(script, {
    argv: [join(ROOT, 'bin/macbuild'), 'setup'], cwd: dir, env: { ...env, MACBUILD_TAILSCALE: '', NO_COLOR: '' }, timeout: 40,
    steps: [
      ['Where do you want to set up', '\r'],
      ['Which agent should help', '\r'],
      ['Add which apps', '\r'],
      ['Add an eas.json', '\r'],
      ['What next', '\r'],
      ['Your tools are ready.*What next', '\r'],
      ['Fixes', '\r'],
      ['bundle identifier for Recipes', '\u0015com.acme.studio\r'],
      ['What next', '\r'],
      ['Run which now', '\r'],
      ['Run the dashboard at login', 'n\r'],
      ['Apple ID', '\r'],
      ['Use macbuild from your phone.*Run it now', '\r'],
      ['What next', '\u001b[B\r'], // Not now
      ['Build which app', '\r'],
      ['What next', '\u001b[B\r'],
      ['You.re set up', ''],
    ],
  });
  const run = spawnSync('python3', ['-I', join(ROOT, 'test/drive-tty.py'), script], { encoding: 'utf8', timeout: 90000 });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout.slice(-3000)}`);
  assert.match(run.stdout, /│ I found four Expo apps/);
  assert.match(run.stdout, /recipes › Set the iOS bundle identifier/);
  assert.match(run.stdout, /── eas credentials:configure-build --platform ios --profile development/);
  assert.match(run.stdout, /macbuild recipes --install +Build and install on your iPhone/);
  assert.equal(JSON.parse(readFileSync(join(dir, 'Developer/kitchen/apps/mobile/app.json'), 'utf8')).expo.ios.bundleIdentifier, 'com.acme.studio');
  const state = JSON.parse(readFileSync(join(dir, '.config/macbuild/setup.json'), 'utf8'));
  assert.ok(state.doneAt);
  assert.equal(state.signing['signing:notes:ios:development'].status, 'done');
  // Done: plain `macbuild` no longer offers setup, and `macbuild setup` without a terminal prints the status.
  const bare = spawnSync(join(ROOT, 'bin/macbuild'), [], { env, encoding: 'utf8' });
  assert.match(bare.stdout, /usage: macbuild <project>/);
  assert.match(spawnSync(join(ROOT, 'bin/macbuild'), ['setup'], { env, encoding: 'utf8' }).stdout, /^macbuild setup\n/);
});

test('plain macbuild offers setup the first time, and "Not now" stops it asking', () => {
  const { dir, env } = home();
  const script = join(dir, 'tty.json');
  json(script, { argv: [join(ROOT, 'bin/macbuild')], cwd: dir, env, expect: 0, steps: [['Not now', '\u001b[B\u001b[B\r'], ['macbuild setup', '']] });
  const run = spawnSync('python3', ['-I', join(ROOT, 'test/drive-tty.py'), script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
  assert.match(run.stdout, /Welcome\. macbuild builds your Expo apps/);
  json(script, { argv: [join(ROOT, 'bin/macbuild')], cwd: dir, env, expect: 2, steps: [['new here\\? macbuild setup', '']] });
  const again = spawnSync('python3', ['-I', join(ROOT, 'test/drive-tty.py'), script], { encoding: 'utf8', timeout: 60000 });
  assert.equal(again.status, 0, `${again.stderr}\n${again.stdout}`);
  assert.doesNotMatch(again.stdout, /Where do you want to set up/);
});

function request(port, path, { method = 'GET', body, csrf = true } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...(csrf ? { 'x-macbuild': '1' } : {}) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => { let data = null; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json: data }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('the dashboard serves the same steps at /api/setup/flow, and opens Terminal only for commands on the screen', { skip: !existsSync(join(ROOT, 'ui/node_modules')) && 'needs npm ci --prefix ui' }, async () => {
  const { dir, env } = home();
  const port = 30000 + Math.floor(Math.random() * 9000);
  writeFileSync(join(dir, 'bin/macbuild'), `#!/bin/sh\n[ "$1" = doctor ] && echo '${JSON.stringify(DOCTOR)}'\nexit 0\n`, { mode: 0o755 });
  const server = spawn(process.execPath, [join(ROOT, 'ui/server.mjs')], { env: { ...env, MACBUILD_UI_PORT: String(port), MACBUILD_BIN: join(dir, 'bin/macbuild'), MACBUILD_TAILSCALE: '', MACBUILD_DATA: join(dir, 'builds'), MACBUILD_NO_TERMINAL: '1' }, stdio: 'ignore' });
  try {
    let first;
    for (let n = 0; n < 100 && !first; n += 1) { first = await request(port, '/api/setup/flow').catch(() => null); if (!first) await new Promise((done) => { setTimeout(done, 100); }); }
    assert.equal(first.json.step, 'welcome');
    assert.equal((await request(port, '/api/setup/flow', { method: 'POST', body: { step: 'welcome', values: { agent: 'none' } }, csrf: false })).status, 403);
    let view = (await request(port, '/api/setup/flow', { method: 'POST', body: { step: 'welcome', values: { agent: 'none' } } })).json;
    for (let n = 0; n < 100 && view.busy; n += 1) { await new Promise((done) => { setTimeout(done, 100); }); view = (await request(port, '/api/setup/flow')).json; }
    assert.equal(view.step, 'apps');
    const stale = await request(port, '/api/setup/flow', { method: 'POST', body: { step: 'welcome', values: {} } });
    assert.equal(stale.status, 409);
    view = (await request(port, '/api/setup/flow', { method: 'POST', body: { step: 'apps', values: { apps: view.fields[0].value, easjson: true } } })).json;
    assert.equal(view.step, 'tools');
    assert.equal(view.commands[0].line, `cd ${dir} && brew install cocoapods`);
    const unknown = await request(port, '/api/setup/terminal', { method: 'POST', body: { id: 'tool:rm -rf' } });
    assert.equal(unknown.status, 404);
    const known = await request(port, '/api/setup/terminal', { method: 'POST', body: { id: 'tool:cocoapods' } });
    assert.equal(known.json.line, `cd ${dir} && brew install cocoapods`);
    assert.equal((await request(port, '/api/setup')).json.flow.step, 'tools');
  } finally { server.kill(); }
});

test('the Phone step walks through Tailscale: install, sign in, publish, then the link and its QR code', async () => {
  const { dir, env } = home();
  let state = { installed: false };
  const flow = flowFor(dir, env, { tailscale: async () => state });
  flow.state.step = 'phone'; flow.save();
  let view = await flow.view();
  assert.equal(view.title, 'Use macbuild from your phone');
  assert.deepEqual(view.commands.map((command) => command.display), ['brew install --cask tailscale']);
  assert.ok(view.commands.every((command) => command.optional), 'skipping the phone is fine');
  state = { installed: true, bin: '/usr/bin/tailscale', daemon: true, needsLogin: true, online: false, port: '4180', httpsPort: '8443' };
  await flow.submit({ step: 'phone', button: 'recheck' });
  view = await flow.view();
  assert.equal(view.title, 'Sign in to Tailscale');
  assert.equal(view.commands[0].display, '/usr/bin/tailscale up');
  state = { ...state, needsLogin: false, online: true, host: 'mac.tail1.ts.net', serving: false, url: 'https://mac.tail1.ts.net:8443' };
  await flow.submit({ step: 'phone', button: 'recheck' });
  view = await flow.view();
  assert.equal(view.commands[0].display, '/usr/bin/tailscale serve --bg --https=8443 http://127.0.0.1:4180');
  state = { ...state, serving: true };
  flow.mark(view.commands[0].id, 0); // running a command looks again
  view = await flow.view();
  assert.equal(view.title, 'Your phone is ready');
  assert.deepEqual(view.qr, { url: 'https://mac.tail1.ts.net:8443' });
  await flow.submit({ step: 'phone', button: 'continue' });
  assert.equal((await flow.view()).step, 'build');

  // Detection itself, against a stand-in for the tailscale CLI.
  const ts = join(dir, 'bin/ts');
  writeFileSync(ts, `#!/bin/sh\ncase "$1 $2" in\n  "status --json") echo '{"BackendState":"Running","Self":{"Online":true,"DNSName":"mac.tail1.ts.net."}}';;\n  "serve status") echo "|-- / proxy http://127.0.0.1:4555";;\nesac\n`, { mode: 0o755 });
  const saved = { ...process.env };
  Object.assign(process.env, { MACBUILD_TAILSCALE: ts, MACBUILD_UI_PORT: '4555', MACBUILD_UI_HTTPS_PORT: '9443' });
  try {
    const found = await detectTailscale({ home: dir });
    assert.equal(found.online, true);
    assert.equal(found.serving, true);
    assert.equal(found.url, 'https://mac.tail1.ts.net:9443');
    process.env.MACBUILD_TAILSCALE = '';
    assert.equal((await detectTailscale({ home: dir })).installed, false);
  } finally {
    for (const key of ['MACBUILD_TAILSCALE', 'MACBUILD_UI_PORT', 'MACBUILD_UI_HTTPS_PORT']) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test('describing a fix never needs the agent’s words', () => {
  assert.equal(describeAction({ type: 'set_config', key: 'android.package', value: 'com.a.b' }), 'Set the Android package to com.a.b');
  assert.equal(describeAction({ type: 'link_eas', app: 'x' }), 'Link it to an EAS project (eas init)');
  assert.equal(execFileSync('node', ['-e', 'import("./lib/setup.mjs").then(m=>console.log(m.quote("it\'s here")))'], { cwd: ROOT }).toString().trim(), `'it'\\''s here'`);
});
