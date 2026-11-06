// Dev servers: lib/devserver.mjs against a stand-in `expo start` (ui/demo/fake-expo.mjs), the dashboard's /api/dev,
// `macbuild dev`, the MCP tools and the remote API's dev scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevServers, cleanLine, commandFor, parseLine, parsePrompt, readiness } from '../lib/devserver.mjs';
import { DEV_TOOLS, devMain } from '../lib/dev-cli.mjs';
import { issueToken } from '../lib/remote-access.mjs';
import { REMOTE_TOOLS } from '../lib/remote-mcp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DEPS = existsSync(join(ROOT, 'ui/node_modules/qrcode'));
const json = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(data)}\n`); };
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(80);
  }
}

// A home with Expo apps: installed, not installed (pnpm monorepo), and not Expo at all; npx runs the stand-in.
function home() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'macbuild-dev-')));
  const app = (path, deps, installed = Object.keys(deps)) => {
    json(join(dir, path, 'package.json'), { name: path.split('/').pop(), version: '1.0.0', dependencies: deps });
    json(join(dir, path, 'app.json'), { expo: { name: 'App', slug: path.split('/').pop() } });
    for (const name of installed) json(join(dir, path, 'node_modules', name, 'package.json'), { name, version: name === 'expo' ? '54.0.12' : '1.0.0' });
  };
  app('code/habit', { expo: '~54.0.0', 'expo-dev-client': '~6.0.0', 'react-native-web': '~0.21.0', 'react-dom': '19.1.0' });
  app('code/go', { expo: '~54.0.0' });
  mkdirSync(join(dir, 'code/mono/.git'), { recursive: true });
  writeFileSync(join(dir, 'code/mono/pnpm-lock.yaml'), '');
  app('code/mono/apps/shop', { expo: '~54.0.0' }, []);
  json(join(dir, 'code/plain/package.json'), { name: 'plain', dependencies: { react: '19' } });
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin/npx'), `#!/bin/sh\n[ "$1 $2" = "expo start" ] && exec node ${JSON.stringify(join(ROOT, 'ui/demo/fake-expo.mjs'))} "$@"\nexit 1\n`, { mode: 0o755 });
  writeFileSync(join(dir, 'projects.conf'), ['habit|code/habit', 'go|code/go', 'shop|code/mono/apps/shop', 'plain|code/plain'].map((line) => line.replace('|', `|${dir}/`)).join('\n'));
  const env = { ...process.env, HOME: dir, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, FAKE_EXPO_SPEED: '6' };
  for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_')) delete env[name];
  const projects = () => readFileSync(join(dir, 'projects.conf'), 'utf8').split('\n').map((line) => { const [name, path] = line.split('|'); return { name, dir: path }; });
  return { dir, env, projects };
}

test('terminal output becomes plain lines: colours, redrawn progress and the QR code removed', () => {
  assert.equal(cleanLine('\x1b[1mbold\x1b[22m and \x1b[32mgreen\x1b[39m'), 'bold and green');
  assert.equal(cleanLine('\x1b[2K\x1b[1GiOS Bundling 10%\x1b[2K\x1b[1GiOS Bundling 90%'), 'iOS Bundling 90%');
  assert.equal(cleanLine('step 1\rstep 2\r'), 'step 2');
  assert.equal(cleanLine('█ ▄▄▄▄▄ █▀▀▄▄█ ▄'), '');
  assert.equal(cleanLine('   '), '');
});

test('Expo output gives links, readiness, bundling progress per platform, errors and prompts', () => {
  const session = { status: 'starting', port: 8081, urls: {}, bundles: {}, prompt: null, lines: [] };
  parseLine(session, '› Metro waiting on exp+habit://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081');
  parseLine(session, '› Web is waiting on http://localhost:8081');
  assert.equal(session.status, 'running');
  assert.equal(session.urls.app, 'exp+habit://expo-development-client/?url=http%3A%2F%2F10.0.0.2%3A8081');
  assert.equal(session.urls.web, 'http://localhost:8081');
  parseLine(session, 'iOS Bundling ▓▓▓▓▓▓▓▓░░░░░░░░  52.3% (612/1012)', true);
  assert.equal(session.bundles.ios.percent, 52.3);
  parseLine(session, ' LOG  battery for iOS users at 40%');
  assert.equal(session.bundles.ios.percent, 52.3, 'a log line with a percentage is not progress');
  parseLine(session, '› Metro waiting on exp+cut://expo-dev', true);
  assert.equal(session.urls.app.startsWith('exp+habit'), true, 'a partial line never sets a link');
  parseLine(session, 'iOS Bundled 1834ms node_modules/expo-router/entry.js (1203 modules)');
  assert.deepEqual({ ...session.bundles.ios, at: 0 }, { percent: 100, done: true, ms: 1834, entry: 'node_modules/expo-router/entry.js', modules: 1203, at: 0 });
  parseLine(session, 'Android Bundling failed 120ms');
  assert.equal(session.bundles.android.failed, true);
  parseLine(session, 'ERROR  SyntaxError: App.tsx: Unexpected token (3:4)');
  assert.match(session.lastError.text, /Unexpected token/);
  const confirm = parsePrompt(session, '? The package @expo/ngrok@^4.1.0 is required to use tunnels, would you like to install it globally? › (Y/n)');
  assert.deepEqual(confirm, { kind: 'confirm', text: 'The package @expo/ngrok@^4.1.0 is required to use tunnels, would you like to install it globally?', default: 'yes' });
  session.lines = ['? Dev tools › - Use arrow-keys. Return to submit.', '❯   Open React devtools'].map((text, n) => ({ n, text }));
  assert.deepEqual(parsePrompt(session, '    Open Redux devtools'), { kind: 'select', text: 'Dev tools', options: [{ label: 'Open React devtools', selected: true }, { label: 'Open Redux devtools', selected: false }] });
  session.lines.push({ n: 3, text: '✔ Dev tools › Open React devtools' });
  assert.equal(parsePrompt(session, ''), null, 'an answered list is not asked again');
  assert.equal(parsePrompt(session, 'Logs for your project will appear below.'), null);
});

test('readiness: what each project needs before it can run a dev server', () => {
  const { dir } = home();
  const habit = readiness({ name: 'habit', dir: join(dir, 'code/habit') }, { builds: [{ project: 'habit', status: 'success', devClient: true, createdAt: Date.now() }] });
  assert.equal(habit.ok, true);
  assert.equal(habit.level, 'ready');
  assert.equal(habit.devClient, true);
  assert.equal(habit.web, true);
  assert.equal(habit.expo, '54.0.12');
  assert.equal(`${habit.passed}/${habit.total}`, '3/3');
  const go = readiness({ name: 'go', dir: join(dir, 'code/go') });
  assert.equal(go.ok, true);
  assert.equal(go.devClient, false);
  assert.equal(go.checks.find((check) => check.id === 'target').detail, 'Expo Go');
  const shop = readiness({ name: 'shop', dir: join(dir, 'code/mono/apps/shop') });
  assert.equal(shop.ok, false);
  assert.equal(shop.summary, 'Install dependencies first');
  assert.equal(shop.packageManager, 'pnpm');
  assert.equal(shop.checks.find((check) => check.id === 'expo').fix, `cd ${join(dir, 'code/mono')} && pnpm install`);
  const plain = readiness({ name: 'plain', dir: join(dir, 'code/plain') });
  assert.equal(plain.ok, false);
  assert.match(plain.summary, /expo isn’t in package.json/);
  assert.equal(readiness({ name: 'none', dir: join(dir, 'nowhere') }).ok, false);
});

test('the command is fixed: npx expo start, a port, one connection flag, Tailscale through the packager hostname', () => {
  const tailnet = commandFor({ dir: '/work/habit', port: 8082, connection: 'tailnet', host: 'mac.tail.ts.net' });
  assert.deepEqual(tailnet.args, ['expo', 'start', '--port', '8082']);
  assert.deepEqual(tailnet.env, { REACT_NATIVE_PACKAGER_HOSTNAME: 'mac.tail.ts.net' });
  assert.equal(tailnet.shown, 'cd /work/habit && REACT_NATIVE_PACKAGER_HOSTNAME=mac.tail.ts.net npx expo start --port 8082');
  assert.deepEqual(commandFor({ dir: '/w', port: 8081, connection: 'localhost', clear: true }).args, ['expo', 'start', '--port', '8081', '--localhost', '--clear']);
  assert.deepEqual(commandFor({ dir: '/w', port: 8081, connection: 'tunnel' }).args, ['expo', 'start', '--port', '8081', '--tunnel']);
  assert.deepEqual(commandFor({ dir: '/w', port: 8081, connection: 'lan' }).env, {});
});

test('a dev server starts in a terminal, reports its link and bundles, takes keys and answers, and stops', async () => {
  const { dir, env, projects } = home();
  const busy = createServer(() => {});
  await new Promise((done) => { busy.once('error', done); busy.listen(8081, '0.0.0.0', done); });
  const dev = new DevServers({ dir: join(dir, 'dev'), projects, builds: () => [], tailnetHost: () => 'mac.tail.ts.net', env });
  try {
    await assert.rejects(dev.start('shop'), /Install dependencies first: cd .* && pnpm install/);
    await assert.rejects(dev.start('nope'), /Unknown project/);
    await assert.rejects(dev.start('habit', { connection: 'carrier-pigeon' }), /Connection is one of/);
    const started = await dev.start('habit', { cols: 100, rows: 30 }, { name: 'Sam' });
    assert.notEqual(started.port, 8081, 'a port in use is skipped');
    assert.equal(started.connection, 'tailnet', 'Tailscale is the default when it is on');
    assert.equal(started.by.name, 'Sam');
    assert.equal((await dev.start('habit')).id, started.id, 'starting a running server returns it');
    const running = await until(() => dev.view('habit').session.status === 'running' && dev.view('habit').session.urls.web && dev.view('habit').session);
    assert.equal(running.urls.app, `exp+habit://expo-development-client/?url=${encodeURIComponent(`http://mac.tail.ts.net:${started.port}`)}`);
    await until(() => dev.view('habit').session.bundles.ios?.done);
    assert.equal(dev.list().find((item) => item.project === 'habit').status, 'running');

    // Keys by name and as characters; a list answered by its option number.
    const before = (await dev.log('habit', { tail: 1 })).next;
    dev.input('habit', { key: 'reload' });
    const after = await dev.log('habit', { since: before, wait: 5000 });
    assert.equal(after.lines[0].text, '› Reloading apps');
    assert.equal(after.lines[0].n, before + 1, 'lines are numbered, so an agent reads on from the last one');
    dev.input('habit', { key: 'M' });
    const prompt = await until(() => dev.view('habit').session.prompt);
    assert.equal(prompt.kind, 'select');
    assert.equal(prompt.options.length, 3);
    dev.choose('habit', 1);
    assert.equal(dev.view('habit').session.prompt, null, 'answering clears the question at once');
    await until(async () => (await dev.log('habit', { tail: 5 })).lines.some((line) => line.text === '› Opening Redux devtools'));
    assert.equal(dev.view('habit').session.prompt, null);
    assert.throws(() => dev.input('habit', { key: 'launch-missiles' }), /Unknown key/);
    assert.throws(() => dev.input('habit', { text: 'a\x07b' }), /printable/);
    assert.throws(() => dev.input('habit', {}), /Send a key or text/);

    // An edited file bundles again: what an agent waits for after a change.
    const mark = (await dev.log('habit', { tail: 1 })).next;
    writeFileSync(join(dir, 'code/habit/App.tsx'), 'export default 1;\n');
    const change = await until(async () => (await dev.log('habit', { since: mark })).lines.find((line) => /Bundled .* App\.tsx/.test(line.text)), 10000).catch(() => null);
    if (process.platform === 'darwin' || process.platform === 'linux') assert.ok(change, 'the change was bundled');

    // Tunnel: Expo asks to install ngrok; the answer goes through.
    const second = await dev.start('go', { connection: 'tunnel' });
    assert.notEqual(second.port, started.port);
    const confirm = await until(() => dev.view('go').session.prompt);
    assert.equal(confirm.kind, 'confirm');
    assert.match(confirm.text, /ngrok/);
    assert.deepEqual((await dev.log('go', { since: 0, wait: 3000 })).prompt, confirm, 'a log request returns at once while Expo is asking');
    dev.input('go', { key: 'yes' });
    await until(() => dev.view('go').session.status === 'running');
    assert.equal(dev.running().length, 2);

    dev.stop('habit');
    assert.equal(dev.view('habit').session.status, 'stopping');
    const stopped = await until(() => ['stopped', 'failed'].includes(dev.view('habit').session.status) && dev.view('habit').session);
    assert.equal(stopped.status, 'stopped');
    assert.throws(() => dev.input('habit', { key: 'r' }), /isn’t running/);
    const saved = await dev.log('habit', { tail: 3 });
    assert.ok(saved.lines.length > 0);
    assert.match(dev.rawLog('habit').text, /Metro waiting on/);

    const restarted = await dev.restart('go');
    assert.notEqual(restarted.id, second.id);
    assert.equal(restarted.connection, 'tunnel', 'a restart keeps the connection');
    await until(() => dev.view('go').session.prompt);
    dev.stopAll();
    await until(() => !dev.running().length);
    assert.equal(JSON.parse(readFileSync(join(dir, 'dev/state.json'), 'utf8')).projects.habit.history[0].status, 'stopped');
  } finally { dev.stopAll(); busy.close(); }
});

test('a dev server recorded as live when the dashboard restarts is marked stopped, and its log is kept', () => {
  const { dir, projects } = home();
  json(join(dir, 'dev/state.json'), { projects: { habit: { options: { connection: 'lan' }, history: [{ id: 'dev-old1', project: 'habit', status: 'running', port: 8081, startedAt: Date.now() - 60000, pid: 999999 }] } } });
  mkdirSync(join(dir, 'dev/habit'), { recursive: true });
  writeFileSync(join(dir, 'dev/habit/dev-old1.log'), 'Starting Metro Bundler\n› Metro waiting on exp://10.0.0.2:8081\n');
  const dev = new DevServers({ dir: join(dir, 'dev'), projects, env: process.env });
  const session = dev.view('habit').session;
  assert.equal(session.status, 'stopped');
  assert.match(session.reason, /dashboard restarted/);
  assert.equal(session.pid, undefined);
  assert.equal(dev.view('habit').options.connection, 'lan', 'the last connection is remembered');
  return dev.log('habit', { tail: 10 }).then((log) => assert.deepEqual(log.lines.map((line) => line.text), ['Starting Metro Bundler', '› Metro waiting on exp://10.0.0.2:8081']));
});

function call(port, path, { method = 'GET', body, csrf = true, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...(csrf ? { 'x-macbuild': '1' } : {}), ...headers } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => { let data = null; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json: data, text, headers: res.headers }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('the dashboard runs dev servers for the page, macbuild dev, MCP and remote tokens with the dev scope', { skip: !UI_DEPS && 'needs npm ci --prefix ui', timeout: 90000 }, async () => {
  const { dir, env } = home();
  const port = 30000 + Math.floor(Math.random() * 9000);
  const access = join(dir, 'remote-server.json');
  const serverEnv = { ...env, MACBUILD_UI_PORT: String(port), MACBUILD_TAILSCALE: '', MACBUILD_DATA: join(dir, 'builds'), MACBUILD_PROJECTS: join(dir, 'projects.conf'), MACBUILD_NO_TERMINAL: '1', MACBUILD_REMOTE_ACCESS: access, MACBUILD_BIN: join(dir, 'bin/npx') };
  const server = spawn(process.execPath, [join(ROOT, 'ui/server.mjs')], { env: serverEnv, stdio: 'ignore' });
  const cli = (args) => spawnSync(process.execPath, [join(ROOT, 'lib/dev-cli.mjs'), ...args], { env: { ...env, MACBUILD_UI_PORT: String(port) }, encoding: 'utf8', timeout: 60000 });
  try {
    await until(() => call(port, '/api/dev').then((res) => res.status === 200, () => false));
    const list = (await call(port, '/api/dev')).json.servers;
    assert.deepEqual(list.map((item) => [item.project, item.readiness.ok]), [['habit', true], ['go', true], ['shop', false], ['plain', false]]);
    assert.equal((await call(port, '/api/dev/habit/start', { method: 'POST', body: {}, csrf: false })).status, 403);
    assert.equal((await call(port, '/api/dev/shop/start', { method: 'POST', body: {} })).status, 409);
    const started = await call(port, '/api/dev/habit/start', { method: 'POST', body: { connection: 'lan', cols: 90, rows: 28 } });
    assert.equal(started.status, 201);
    assert.equal(started.json.connection, 'lan');
    assert.equal(started.json.by, null);

    // The page's stream: what's on screen so far, then output and state.
    const stream = await new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/dev/habit/stream' }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; if (/event: state[\s\S]*"status":"running"/.test(text) && text.includes('data: ')) { req.destroy(); resolve({ headers: res.headers, text }); } });
      });
      req.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
      req.end();
    });
    assert.equal(stream.headers['content-type'], 'text/event-stream');
    const chunks = [...stream.text.matchAll(/^data: ([A-Za-z0-9+/=]+)$/gm)].map((match) => Buffer.from(match[1], 'base64').toString('utf8')).join('');
    assert.match(chunks, /Starting project at/);
    const view = (await call(port, '/api/dev/habit')).json;
    assert.equal(view.session.status, 'running');
    assert.match(view.qr, /^<svg/);
    assert.equal(view.session.urls.web, `http://localhost:${view.session.port}`);
    const projectsList = (await call(port, '/api/projects')).json;
    assert.deepEqual(projectsList.find((item) => item.name === 'habit').dev, { status: 'running', port: view.session.port, prompt: false });
    assert.equal((await call(port, '/api/system')).json.dev[0].project, 'habit');
    assert.equal((await call(port, '/vendor/xterm.js')).status, existsSync(join(ROOT, 'ui/node_modules/@xterm/xterm')) ? 200 : 404);

    // macbuild dev: the table, status, a key, and waiting for the bundle it causes.
    const table = cli([]);
    assert.equal(table.status, 0, table.stderr);
    assert.match(table.stdout, /habit\s+yes \(\d\/\d\)\s+running :\d+/);
    assert.match(table.stdout, /shop\s+no: Install dependencies/);
    const status = cli(['status', 'habit']);
    assert.match(status.stdout, /habit: running on port \d+/);
    assert.match(status.stdout, /Command: cd .*code\/habit && npx expo start --port \d+/);
    const next = (await call(port, '/api/dev/habit/log?tail=1')).json.next;
    assert.equal(cli(['key', 'habit', 'r']).stdout.trim(), 'Pressed r.');
    const waited = cli(['wait', 'habit', '--since', String(next), '--timeout', '20']);
    assert.equal(waited.status, 0, waited.stdout + waited.stderr);
    assert.match(waited.stdout, /Reloading apps[\s\S]*iOS Bundled/);
    const timedOut = cli(['wait', 'habit', '--for', 'never-printed', '--timeout', '1']);
    assert.equal(timedOut.status, 124);
    assert.equal(cli(['wait', 'go', '--timeout', '2']).status, 1, 'waiting on a stopped server ends at once');
    assert.equal(cli(['command', 'go']).stdout.trim().endsWith('npx expo start --port 8081'), true);
    cli(['key', 'habit', 'M']);
    await until(async () => (await call(port, '/api/dev/habit')).json.session.prompt);
    assert.match(cli(['answer', 'habit', '9']).stderr, /Choose 1 to 3/);
    assert.equal(cli(['answer', 'habit', 'tanstack']).stdout.trim(), 'Chose Open TanStack Query devtools.');
    const text = await call(port, '/api/dev/habit/log.txt');
    assert.match(text.headers['content-disposition'], /habit-dev-/);
    assert.match(text.text, /Opening TanStack Query devtools/);
    assert.doesNotMatch(text.text, /\x1b\[/);

    // Remote clients: read with the read scope, drive it only with dev; paths and pids stay on the Mac.
    const reader = issueToken({ name: 'laptop', projects: ['habit'], scopes: ['read'] }, access);
    const driver = issueToken({ name: 'agent', projects: ['habit'], scopes: ['read', 'dev'] }, access);
    const remote = (token, path, options = {}) => call(port, `/api/remote/v1${path}`, { csrf: false, headers: { authorization: `Bearer ${token.token}` }, ...options });
    const remoteList = (await remote(reader, '/dev')).json.servers;
    assert.deepEqual(remoteList.map((item) => item.project), ['habit']);
    const remoteView = (await remote(reader, '/dev/habit')).json;
    assert.equal(remoteView.dir, undefined);
    assert.equal(remoteView.session.pid, undefined);
    assert.equal(remoteView.session.status, 'running');
    assert.equal((await remote(reader, '/dev/go')).status, 403);
    assert.equal((await remote(reader, '/dev/habit/input', { method: 'POST', body: { key: 'r' } })).status, 403);
    const pressed = await remote(driver, '/dev/habit/input', { method: 'POST', body: { key: 'r' } });
    assert.equal(pressed.status, 200);
    assert.equal(pressed.json.session.pid, undefined);
    assert.equal((await remote(driver, '/dev/habit/input', { method: 'POST', body: { key: 'nope' } })).status, 400);
    assert.match(readFileSync(`${access}.audit.jsonl`, 'utf8'), /"operation":"dev\/habit\/input","project":"habit","key":"r"/);
    const remoteLog = (await remote(reader, `/dev/habit/log?since=${next}`)).json;
    assert.ok(remoteLog.lines.length > 0);

    const stopped = await call(port, '/api/dev/habit/stop', { method: 'POST', body: {} });
    assert.equal(stopped.json.status, 'stopping');
    await until(async () => (await call(port, '/api/dev/habit')).json.session.status === 'stopped');
    assert.equal(cli(['log', 'habit', '--tail', '2']).status, 0);
  } finally { server.kill(); }
  // No dashboard: say how to start it, and how to run Expo here instead.
  const none = cli(['status', 'habit']);
  assert.equal(none.status, 1);
  assert.match(none.stderr, /dashboard isn't running[\s\S]*macbuild setup --ui[\s\S]*--here/);
});

test('agents get the same operations as MCP tools, locally and through a remote Mac', async () => {
  const names = DEV_TOOLS.map((tool) => tool.name);
  assert.deepEqual(names, ['dev_servers', 'dev_status', 'dev_start', 'dev_stop', 'dev_log', 'dev_wait', 'dev_send']);
  for (const name of names) assert.ok(REMOTE_TOOLS.some((tool) => tool.name === name));
  const local = spawnSync(process.execPath, [join(ROOT, 'lib/mcp.mjs')], { input: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n', encoding: 'utf8' });
  for (const name of names) assert.match(local.stdout, new RegExp(`"name":"${name}"`));
  assert.equal(DEV_TOOLS.find((tool) => tool.name === 'dev_log').annotations.readOnlyHint, true);
  assert.equal(DEV_TOOLS.find((tool) => tool.name === 'dev_send').annotations.readOnlyHint, false);
  // devMain with a transport: the remote client's paths are the same.
  const seen = [];
  const transport = { local: false, get: async (path) => { seen.push(path); return { servers: [{ project: 'habit', status: 'running', port: 8081, urls: { app: 'exp://x' }, readiness: { ok: true, passed: 3, total: 3, summary: '' } }] }; }, post: async () => ({}) };
  let output = '';
  const code = await devMain([], transport, { write: (text) => { output += text; } });
  assert.equal(code, 0);
  assert.deepEqual(seen, ['/dev']);
  assert.match(output, /habit\s+yes \(3\/3\)\s+running :8081\s+exp:\/\/x/);
  await assert.rejects(devMain(['habit', '--here'], transport, { write() {} }), /runs Expo in this terminal, on the Mac/);
  await assert.rejects(devMain(['habit', '--tailscale', '--lan'], transport, { write() {} }), /Choose one of/);
});
