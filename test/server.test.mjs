// Boots ui/server.mjs against throwaway projects, with a fake macbuild and a fake gh, and checks it over HTTP.
// Needs the UI's dependencies: npm ci --prefix ui
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueToken, revokeToken } from '../lib/remote-access.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'macbuild-server-'));
const home = join(dir, 'home');
const port = 40000 + Math.floor(Math.random() * 10000);
const TAILNET = 'mac.example.ts.net:8443';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const hooks = [];
let server; let hookServer;

function request(path, { method = 'GET', host = `127.0.0.1:${port}`, body, csrf = true, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const all = { host, 'content-type': 'application/json', ...(csrf ? { 'x-macbuild': '1' } : {}), ...headers };
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: all }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json, type: res.headers['content-type'] }); });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
}
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const builds = async () => (await request('/api/builds')).json.builds;
const done = (id) => until(async () => { const { json } = await request(`/api/builds/${id}`); return !['queued', 'running', 'cancelling'].includes(json?.status) && json; }, 20000);
const rules = () => JSON.parse(readFileSync(join(dir, 'ui.json'), 'utf8')).triggers;
function storeArtifact(name) {
  const id = `20260103010101-${name}`;
  const folder = join(dir, 'builds', id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'meta.json'), JSON.stringify({ id, project: 'my_app', platform: 'ios', profile: 'production', distribution: 'store', artifact: 'app.ipa', status: 'success', createdAt: Date.now() - 10000, source: 'working' }));
  writeFileSync(join(folder, 'app.ipa'), 'store artifact');
  return id;
}

test('a saved successful IPA can be submitted after a wrapper failure without rebuilding', async () => {
  const id = storeArtifact('wrapper-failure');
  const folder = join(dir, 'builds', id);
  const meta = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'));
  writeFileSync(join(folder, 'meta.json'), JSON.stringify({ ...meta, status: 'failed', action: 'submit', reason: '> 174 | throw session.error ?? EncodeFailed()' }));
  writeFileSync(join(folder, 'build.log'), "Build successful\n/bin/macbuild: line 697: syntax error near unexpected token `('\n");
  const recovered = await request(`/api/builds/${id}/log`);
  assert.equal(recovered.json.build.status, 'failed');
  assert.equal(recovered.json.build.buildCompleted, true);
  assert.match(recovered.json.build.reason, /syntax error near unexpected token/);
  const upload = await request(`/api/builds/${id}/submit`, { method: 'POST' });
  assert.equal(upload.status, 201);
  assert.equal(upload.json.submissionOnly, true);
  assert.equal((await done(upload.json.id)).status, 'success');
  const unproven = storeArtifact('native-failure');
  const unprovenMeta = join(dir, 'builds', unproven, 'meta.json');
  writeFileSync(unprovenMeta, JSON.stringify({ ...meta, id: unproven, status: 'failed', action: 'submit' }));
  writeFileSync(join(dir, 'builds', unproven, 'build.log'), 'Error: native build failed\n');
  assert.equal((await request(`/api/builds/${unproven}/submit`, { method: 'POST' })).status, 400);
});
// A project whose origin looks like GitHub (acme/<name>) but is a local bare repository, through insteadOf.
function project(name, { icon = '' } = {}) {
  const origin = join(dir, `${name}.git`);
  const app = join(dir, name);
  const url = `https://github.com/acme/${name}.git`;
  git(dir, 'init', '-q', '--bare', origin);
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  writeFileSync(join(app, 'eas.json'), JSON.stringify({ build: { development: { distribution: 'internal' }, production: { channel: 'production', environment: 'production' } } }));
  if (icon) {
    mkdirSync(join(app, 'assets'));
    writeFileSync(join(app, 'assets/icon.png'), 'not really a png');
    // 'outside' points ios.icon out of the project folder, which must never be served.
    writeFileSync(join(app, 'app.json'), JSON.stringify({ expo: { icon: './assets/icon.png', ...(icon === 'outside' ? { ios: { icon: '../../escape.png' } } : {}) } }));
  }
  git(app, 'add', '.');
  git(app, 'commit', '-qm', 'first');
  git(app, 'remote', 'add', 'origin', url);
  git(app, 'config', `url.${origin}.insteadOf`, url);
  git(app, 'push', '-q', 'origin', 'main');
  return app;
}
function pushCommit(app, subject) {
  writeFileSync(join(app, 'CHANGES'), `${subject}\n`, { flag: 'a' });
  git(app, 'add', 'CHANGES');
  git(app, 'commit', '-qm', subject);
  git(app, 'push', '-q', 'origin', 'main');
  return git(app, 'rev-parse', 'HEAD');
}

before(async () => {
  const names = ['my_app', 'pushed.app', 'fail.app', 'skip.app', 'slow.app', 'droid.app'];
  const apps = Object.fromEntries(names.map((name) => [name, project(name, { icon: { my_app: 'outside', 'pushed.app': 'inside' }[name] })]));
  for (const name of ['slow.app', 'droid.app', 'fail.app', 'skip.app']) writeFileSync(join(apps[name], 'CHANGES'), '');
  writeFileSync(join(dir, 'projects.conf'), names.map((name) => `${name}|${apps[name]}`).join('\n') + '\n');
  const pushedHead = git(apps['pushed.app'], 'rev-parse', 'HEAD');
  hookServer = createServer((req, res) => { let text = ''; req.on('data', (chunk) => { text += chunk; }); req.on('end', () => { hooks.push(JSON.parse(text)); res.end('ok'); }); });
  await new Promise((resolve) => { hookServer.listen(0, '127.0.0.1', resolve); });
  writeFileSync(join(dir, 'ui.json'), JSON.stringify({
    githubStatus: true,
    webhook: `http://127.0.0.1:${hookServer.address().port}/hook`,
    triggers: [
      // A rule for a project that has since been removed, ahead of one with a new commit to build.
      { project: 'gone', branch: 'main', profile: 'development', submit: false, sha: 'old' },
      { project: 'pushed.app', branch: 'main', profile: 'development', submit: false, sha: 'old' },
      { project: 'my_app', on: 'nightly', branch: 'main', at: '00:00', profile: 'development' },
      { project: 'pushed.app', on: 'pr', profile: 'development', prs: {} },
    ],
  }));
  // Fake gh: two open pull requests on pushed.app, one from a fork; commit statuses are recorded in gh-calls.
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/bash
echo "$*" >> "${dir}/gh-calls"
case "$1 $2" in
  "pr list") case " $* " in *" --head "*) echo '[]';; *) echo '[{"number":7,"headRefName":"feature/x","headRefOid":"${pushedHead}","isCrossRepository":false},{"number":8,"headRefName":"fork/y","headRefOid":"${pushedHead}","isCrossRepository":true},{"number":9,"headRefName":"no/commit"}]';; esac;;
  "api "*) echo '{"check_runs":[]}';;
  *) exit 1;;
esac
`, { mode: 0o755 });
  // Fake macbuild: fail.app fails with a known error, skip.app reuses its first build, slow.app takes three seconds.
  writeFileSync(join(bin, 'xcrun'), `#!/bin/bash
echo "$*" >> "${dir}/xcrun-calls"
if [ "$1" = devicectl ] && [ "$2" = list ]; then
  out=""; prev=""
  for a in "$@"; do [ "$prev" = --json-output ] && out=$a; prev=$a; done
  [ -n "$out" ] || exit 1
  cat > "$out" <<'JSON'
{"result":{"devices":[{"identifier":"phone-1","connectionProperties":{"pairingState":"paired","transportType":"localNetwork"},"deviceProperties":{"name":"Test iPhone"},"hardwareProperties":{"deviceType":"iPhone","udid":"udid-1","marketingName":"iPhone 14"}}]}}
JSON
  exit 0
fi
if [ "$1" = devicectl ] && [ "$2" = device ] && [ "$3" = install ]; then exit 0; fi
exit 1
`, { mode: 0o755 });
  writeFileSync(join(bin, 'macbuild'), `#!/bin/bash
case "$1" in
  update) echo "[UPDATE] $*" >> "$MACBUILD_LOG"; while [ -f "${dir}/hold-update" ]; do sleep 0.1; done; case " $* " in *" --message reject "*) echo 'Error: OTA rejected' >> "$MACBUILD_LOG"; exit 1;; esac; echo 'https://expo.dev/accounts/test/projects/app/updates/test-group' >> "$MACBUILD_LOG"; echo 'macbuild: update successful' >> "$MACBUILD_LOG"; exit 0;;
  doctor) echo '{"ok":true,"items":[{"id":"macos","label":"macOS","status":"ok","detail":"15.0"},{"id":"projects","label":"projects","status":"ok","detail":"6 listed"}]}'; exit 0;;
  scan) exit 0;;
esac
project=$1; out=""; prev=""; for a in "$@"; do [ "$prev" = --output ] && out=$a; prev=$a; done
case " $* " in *" --submit-only "*) echo "[SUBMIT] Uploading existing artifact $*" >> "$MACBUILD_LOG"; while [ -f "${dir}/hold-submit" ]; do sleep 0.1; done; sleep 1; echo "Submitted your app" >> "$MACBUILD_LOG"; exit 0;; esac
echo "[START_BUILD] fake build $*" >> "$MACBUILD_LOG"
case "$project" in
  fail.app) echo "❌ error: Provisioning profile \\"x\\" doesn't include the currently selected device \\"Phone\\"." >> "$MACBUILD_LOG"; exit 1;;
  skip.app) echo "macbuild: fingerprint fp-1" >> "$MACBUILD_LOG"
    earlier=$(ls "$MACBUILD_DATA"/*-skip-app/app.ipa 2>/dev/null | head -n 1)
    [ -n "$earlier" ] && { echo "macbuild: unchanged since $earlier" >> "$MACBUILD_LOG"; exit 0; };;
  slow.app) while [ -f "${dir}/hold-build" ]; do sleep 0.1; done; sleep 3;;
esac
head -c 2048 /dev/zero > "$out"
`, { mode: 0o755 });
  mkdirSync(join(home, '.cache/macbuild'), { recursive: true });
  mkdirSync(join(home, 'Library/Caches/CocoaPods'), { recursive: true });
  writeFileSync(join(home, '.cache/macbuild/leftover'), 'x'.repeat(8192));
  writeFileSync(join(home, 'Library/Caches/CocoaPods/pod'), 'x'.repeat(8192));
  // A previous UI process died after eas had already written the IPA.
  const recovered = '20260101010101-my-app';
  mkdirSync(join(dir, 'builds', recovered), { recursive: true });
  writeFileSync(join(dir, 'builds', recovered, 'meta.json'), JSON.stringify({
    id: recovered, project: 'my_app', platform: 'ios', action: 'build', profile: 'development', artifact: 'app.ipa',
    status: 'failed', reason: 'The UI restarted during this build', createdAt: Date.now() - 120000, startedAt: Date.now() - 120000, finishedAt: Date.now() - 1000,
  }));
  writeFileSync(join(dir, 'builds', recovered, 'build.log'), '[RUN_FASTLANE] done\r\nBuild successful\r\n');
  writeFileSync(join(dir, 'builds', recovered, 'app.ipa'), Buffer.alloc(2048));
  // A CLI job the dashboard marked stopped after xcodebuild went quiet, even though eas succeeded.
  const cliFalse = '20260101020202-cli-app';
  mkdirSync(join(dir, 'builds', cliFalse), { recursive: true });
  writeFileSync(join(dir, 'builds', cliFalse, 'meta.json'), JSON.stringify({
    id: cliFalse, project: 'my_app', platform: 'ios', action: 'build', profile: 'development', artifact: 'app.ipa',
    trigger: 'cli', pid: 999999999, status: 'failed', reason: 'The CLI build stopped',
    createdAt: Date.now() - 120000, startedAt: Date.now() - 120000, finishedAt: Date.now() - 1000,
  }));
  writeFileSync(join(dir, 'builds', cliFalse, 'build.log'), 'macbuild: fingerprint abc\n\x1b[32mBuild successful\x1b[39m\r\n');
  writeFileSync(join(dir, 'builds', cliFalse, 'app.ipa'), Buffer.alloc(2048));
  server = spawn(process.execPath, ['--import', join(ROOT, 'test/fast-timers.mjs'), join(ROOT, 'ui/server.mjs')], {
    stdio: process.env.SERVER_LOG ? 'inherit' : 'ignore',
    env: {
      ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MACBUILD_UI_PORT: String(port), MACBUILD_UI_URL: `https://${TAILNET}`,
      MACBUILD_BIN: join(bin, 'macbuild'), MACBUILD_DATA: join(dir, 'builds'), MACBUILD_PROJECTS: join(dir, 'projects.conf'), MACBUILD_CONFIG: join(dir, 'ui.json'),
      MACBUILD_T3: join(bin, 't3'), MACBUILD_TAILSCALE: '',
    },
  });
  globalThis.apps = apps;
  await until(async () => (await request('/api/builds')).status === 200);
});
after(() => { server?.kill(); hookServer?.close(); });

test('remote API is opt-in, scoped, and isolated from dashboard administration', async () => {
  const path = '/api/remote/v1';
  assert.equal((await request(`${path}/info`)).status, 401);
  const file = join(home, '.config/macbuild/remote-server.json');
  const issued = issueToken({ name: 'windows-read', projects: ['my_app'], scopes: ['read'] }, file);
  const headers = { authorization: `Bearer ${issued.token}` };
  const info = await request(`${path}/info`, { headers, csrf: false });
  assert.equal(info.status, 200);
  assert.equal(info.json.client, 'windows-read');
  assert.equal(JSON.stringify(info.json).includes(issued.token), false);
  const list = await request(`${path}/projects`, { headers });
  assert.deepEqual(list.json.map((item) => item.name), ['my_app']);
  assert.equal(list.json[0].profiles.some((profile) => profile.name === 'production'), false);
  assert.equal((await request('/api/settings', { method: 'POST', headers, body: { autoInstall: 'always' } })).status, 403);
  assert.equal((await request(`${path}/info`, { headers: { ...headers, origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request(`${path}/jobs`, { method: 'POST', headers: { ...headers, 'idempotency-key': 'read-denied' }, body: { project: 'my_app', action: 'build' } })).status, 403);
  revokeToken(issued.id, file);
  assert.equal((await request(`${path}/info`, { headers })).status, 401);
});

test('remote jobs pin pushed commits, reject source mismatches, and retry idempotently', async (context) => {
  const originalProjects = readFileSync(join(dir, 'projects.conf'), 'utf8');
  context.after(() => writeFileSync(join(dir, 'projects.conf'), originalProjects));
  const app = project('remote-app');
  writeFileSync(join(dir, 'projects.conf'), `remote-app|${app}\n`, { flag: 'a' });
  const file = join(home, '.config/macbuild/remote-server.json');
  const issued = issueToken({ name: 'windows-build', projects: ['remote-app'], scopes: ['read', 'build', 'cancel'] }, file);
  const headers = { authorization: `Bearer ${issued.token}`, 'idempotency-key': 'remote-first-build' };
  const input = { project: 'remote-app', action: 'build', profile: 'development', platform: 'ios', ref: 'main', commit: git(app, 'rev-parse', 'HEAD'), repository: 'github.com/acme/remote-app' };
  const post = (body, key) => request('/api/remote/v1/jobs', { method: 'POST', headers: { ...headers, ...(key ? { 'idempotency-key': key } : {}) }, body, csrf: false });
  assert.equal((await post({ ...input, repository: 'github.com/acme/other' })).status, 409);
  assert.equal((await post({ ...input, commit: 'a'.repeat(40) })).status, 409);
  assert.equal((await post({ ...input, profile: 'production' })).status, 403);
  assert.equal((await post({ ...input, project: 'my_app' })).status, 403);
  assert.equal((await post({ ...input, submit: true, confirmRelease: true })).status, 403);
  const [first, retry] = await Promise.all([post(input), post(input)]);
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(first.json.id, retry.json.id);
  assert.equal(first.json.commit.hash, input.commit);
  assert.equal(first.json.source, 'github');
  assert.equal('remote' in first.json, false);
  const stored = JSON.parse(readFileSync(join(dir, 'builds', first.json.id, 'meta.json'), 'utf8'));
  assert.equal(stored.trigger, 'remote');
  assert.equal(stored.remote.tokenId, issued.id);
  assert.equal((await post({ ...input, platform: 'android' })).status, 409);
  assert.equal((await done(first.json.id)).status, 'success');
  const logs = await request(`/api/remote/v1/jobs/${first.json.id}/log`, { headers });
  assert.match(logs.json.text, /fake build remote-app/);
  const audit = readFileSync(`${file}.audit.jsonl`, 'utf8');
  assert.match(audit, /remote-first-build/);
  assert.equal(audit.includes(issued.token), false);
  const guarded = issueToken({ name: 'ci-gate', projects: ['remote-app'], requiredChecks: ['tests'] }, file);
  const gated = await request('/api/remote/v1/jobs', { method: 'POST', headers: { authorization: `Bearer ${guarded.token}`, 'idempotency-key': 'required-ci-build' }, body: input });
  assert.equal(gated.status, 409);
});

test('remote CLI queues, monitors, downloads, submits, and publishes through the real API with a fake worker', async (context) => {
  const originalProjects = readFileSync(join(dir, 'projects.conf'), 'utf8');
  context.after(() => writeFileSync(join(dir, 'projects.conf'), originalProjects));
  const app = project('client-app');
  writeFileSync(join(dir, 'projects.conf'), `client-app|${app}\n`, { flag: 'a' });
  const file = join(home, '.config/macbuild/remote-server.json');
  const issued = issueToken({ name: 'client-cli', projects: ['client-app'], profiles: ['development', 'production'], scopes: ['read', 'build', 'submit', 'update', 'cancel'] }, file);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [join(ROOT, 'bin/macbuild.mjs'), ...args], { cwd: app, encoding: 'utf8', timeout: 30000, env: { ...process.env, MACBUILD_SERVER_URL: `http://127.0.0.1:${port}`, MACBUILD_TOKEN: issued.token } }));
  assert.equal(cli('doctor').client, 'client-cli');
  assert.equal(cli('commits', 'client-app', '--ref', 'main')[0].hash, git(app, 'rev-parse', 'HEAD'));
  const job = cli('client-app', '--profile', 'production', '--ref', 'main', '--request-id', 'client-build-request');
  assert.equal(job.source, 'github');
  assert.equal(cli('client-app', '--profile', 'production', '--ref', 'main', '--request-id', 'client-build-request').id, job.id);
  assert.equal((await done(job.id)).status, 'success');
  assert.equal(cli('show', job.id).status, 'success');
  const output = join(dir, 'download.ipa');
  assert.equal(cli('download', job.id, '--output', output).id, job.id);
  assert.equal(readFileSync(output).length, 2048);
  const upload = cli('submit', job.id, '--confirm-release');
  assert.equal((await done(upload.id)).status, 'success');
  const update = cli('update', 'client-app', '--ref', 'main', '--channel', 'production', '--message', 'test only', '--confirm-release');
  assert.equal(update.action, 'update');
  assert.equal((await done(update.id)).status, 'success');
  writeFileSync(join(app, 'uncommitted'), 'do not publish');
  assert.throws(() => cli('client-app', '--ref', 'main'), /Uncommitted/);
});

test('a restart adopts a detached build that already succeeded', async () => {
  const finished = await until(async () => {
    const { json } = await request('/api/builds/20260101010101-my-app');
    return json?.status === 'success' && json;
  });
  assert.equal(finished.ipaBytes, 2048);
  assert.equal(finished.reason, undefined);
});

test('a CLI job the dashboard marked stopped is recovered if the log succeeded', async () => {
  const finished = await until(async () => {
    const { json } = await request('/api/builds/20260101020202-cli-app');
    return json?.status === 'success' && json;
  });
  assert.equal(finished.ipaBytes, 2048);
  assert.equal(finished.reason, undefined);
});

test('a CLI job on disk shows up in the dashboard', async () => {
  const id = '20260104121212-cli-app';
  mkdirSync(join(dir, 'builds', id), { recursive: true });
  writeFileSync(join(dir, 'builds', id, 'meta.json'), JSON.stringify({
    id, project: 'my_app', platform: 'ios', action: 'build', profile: 'development', artifact: 'app.ipa',
    trigger: 'cli', status: 'success', createdAt: Date.now(), startedAt: Date.now() - 1000, finishedAt: Date.now(),
  }));
  writeFileSync(join(dir, 'builds', id, 'build.log'), 'Build successful\n');
  const listed = await request('/api/builds');
  assert.ok(listed.json.builds.some((build) => build.id === id && build.trigger === 'cli'));
  const { json } = await request(`/api/builds/${id}`);
  assert.equal(json.trigger, 'cli');
  assert.equal(json.status, 'success');
});

test('a running CLI job is not failed while its process is still alive', async () => {
  const id = '20260104131313-cli-live';
  mkdirSync(join(dir, 'builds', id), { recursive: true });
  writeFileSync(join(dir, 'builds', id, 'meta.json'), JSON.stringify({
    id, project: 'my_app', platform: 'ios', action: 'build', profile: 'development', artifact: 'app.ipa',
    trigger: 'cli', pid: process.pid, status: 'running', createdAt: Date.now() - 180000, startedAt: Date.now() - 180000,
  }));
  const log = join(dir, 'builds', id, 'build.log');
  writeFileSync(log, '[RUN_FASTLANE] compiling\n');
  const stale = (Date.now() / 1000) - 120;
  utimesSync(log, stale, stale);
  await pause(4500);
  const { json } = await request(`/api/builds/${id}`);
  assert.equal(json.status, 'running');
  assert.equal(json.reason, undefined);
  rmSync(join(dir, 'builds', id), { recursive: true, force: true });
  await pause(2500);
});

test('a project named with an underscore builds', async () => {
  const created = await request('/api/builds', { method: 'POST', body: { project: 'my_app', profile: 'development' } });
  assert.equal(created.status, 201);
  assert.match(created.json.id, /^\d{14}-my-app$/);
  const finished = await done(created.json.id);
  assert.equal(finished.status, 'success');
  assert.equal(finished.project, 'my_app');
  const { json } = await request(`/api/builds/${created.json.id}/log`);
  assert.match(json.lines.join('\n'), /fake build my_app --platform ios --profile development --fast --output \S+\/app\.ipa/);
});

test('existing store artifacts submit without rebuilding and reject duplicates', async () => {
  const id = '20260103010101-store-source';
  const folder = join(dir, 'builds', id);
  mkdirSync(folder, { recursive: true });
  const source = { id, project: 'my_app', platform: 'ios', profile: 'production', distribution: 'store', artifact: 'app.ipa', status: 'success', createdAt: Date.now() - 10000, source: 'github', commit: { hash: 'saved-commit' } };
  writeFileSync(join(folder, 'meta.json'), JSON.stringify(source));
  writeFileSync(join(folder, 'app.ipa'), 'original store artifact');
  assert.equal((await request(`/api/builds/${id}/submit`, { method: 'POST', csrf: false })).status, 403);
  const created = await request(`/api/builds/${id}/submit`, { method: 'POST' });
  assert.equal(created.status, 201);
  assert.equal(created.json.submissionOf, id);
  assert.equal(created.json.submissionOnly, true);
  assert.equal(created.json.commit.hash, 'saved-commit');
  assert.equal(readFileSync(join(dir, 'builds', created.json.id, 'app.ipa'), 'utf8'), 'original store artifact');
  assert.equal((await request(`/api/builds/${id}/submit`, { method: 'POST' })).status, 409);
  assert.equal((await done(created.json.id)).status, 'success');
  const log = readFileSync(join(dir, 'builds', created.json.id, 'build.log'), 'utf8');
  assert.match(log, /--submit-only .*app\.ipa/);
  assert.doesNotMatch(log, /--output|--ref|START_BUILD/);
  assert.equal((await request(`/api/builds/${id}/submit`, { method: 'POST' })).status, 409);
  const uploadMeta = join(dir, 'builds', created.json.id, 'meta.json');
  writeFileSync(uploadMeta, JSON.stringify({ ...JSON.parse(readFileSync(uploadMeta, 'utf8')), status: 'failed', submission: 'https://expo.dev/accounts/test/projects/app/submissions/1234-abcd' }));
  assert.equal((await request(`/api/builds/${id}/submit`, { method: 'POST' })).status, 409);
});

test('OTA publishes a pinned pushed commit independently of a running local build', async () => {
  writeFileSync(join(dir, 'hold-build'), 'hold');
  let native;
  try {
    const created = await request('/api/builds', { method: 'POST', body: { project: 'slow.app', profile: 'production' } });
    native = created.json;
    await until(async () => (await request(`/api/builds/${native.id}`)).json.status === 'running');
    const options = { profile: 'production', channel: 'production', environment: 'production', message: 'Fix OTA', ref: 'main', platform: 'ios' };
    const update = await request('/api/projects/my_app/updates', { method: 'POST', body: options });
    assert.equal(update.status, 201, JSON.stringify(update.json));
    assert.equal(update.json.action, 'update');
    assert.equal(update.json.updateMessage, 'Fix OTA');
    assert.match(update.json.commit.hash, /^[0-9a-f]{40}$/);
    const published = await done(update.json.id);
    assert.equal(published.status, 'success');
    assert.match(published.updateUrl, /updates\/test-group/);
    assert.equal((await request(`/api/builds/${native.id}`)).json.status, 'running');
    const log = readFileSync(join(dir, 'builds', update.json.id, 'build.log'), 'utf8');
    assert.match(log, /update my_app --platform ios --profile production --channel production --message Fix OTA/);
    assert.match(log, new RegExp(`--ref ${update.json.commit.hash}`));
    assert.doesNotMatch(log, /--output|--submit-only|START_BUILD/);
    assert.equal((await request(`/api/builds/${update.json.id}/rebuild`, { method: 'POST' })).status, 400);
    assert.equal((await request('/api/projects/my_app/updates', { method: 'POST', body: options, csrf: false })).status, 403);
    for (const changed of [{ message: '' }, { channel: 'other' }, { ref: '' }, { profile: 'missing' }, { environment: 'other' }, { platform: 'web' }]) {
      assert.equal((await request('/api/projects/my_app/updates', { method: 'POST', body: { ...options, ...changed } })).status, 400);
    }
    const failed = await request('/api/projects/my_app/updates', { method: 'POST', body: { ...options, message: 'reject' } });
    assert.equal((await done(failed.json.id)).status, 'failed');
  } finally {
    rmSync(join(dir, 'hold-build'), { force: true });
    if (native) await done(native.id);
  }
});

test('OTA cancellation does not cancel the native build and upload queue stays serialized', async () => {
  writeFileSync(join(dir, 'hold-build'), 'hold');
  writeFileSync(join(dir, 'hold-update'), 'hold');
  let native; let first; let second;
  try {
    native = (await request('/api/builds', { method: 'POST', body: { project: 'slow.app', profile: 'production' } })).json;
    const options = { profile: 'production', channel: 'production', message: 'First OTA', ref: 'main', platform: 'ios' };
    first = (await request('/api/projects/my_app/updates', { method: 'POST', body: options })).json;
    await until(async () => (await request(`/api/builds/${first.id}`)).json.status === 'running');
    second = (await request('/api/projects/my_app/updates', { method: 'POST', body: { ...options, message: 'Second OTA' } })).json;
    assert.equal((await request(`/api/builds/${second.id}`)).json.status, 'queued');
    await request(`/api/builds/${first.id}/cancel`, { method: 'POST' });
    assert.equal((await done(first.id)).status, 'cancelled');
    assert.equal((await request(`/api/builds/${native.id}`)).json.status, 'running');
    rmSync(join(dir, 'hold-update'), { force: true });
    assert.equal((await done(second.id)).status, 'success');
  } finally {
    rmSync(join(dir, 'hold-build'), { force: true });
    rmSync(join(dir, 'hold-update'), { force: true });
    if (native) await done(native.id);
    if (first?.id) await done(first.id);
    if (second?.id) await done(second.id);
  }
});

test('submissions bypass a running build and cancellation leaves that build untouched', async () => {
  const hold = join(dir, 'hold-build');
  writeFileSync(hold, 'hold');
  let build;
  try {
    const created = await request('/api/builds', { method: 'POST', body: { project: 'slow.app', profile: 'production' } });
    assert.equal(created.status, 201);
    build = created.json;
    await until(async () => (await request(`/api/builds/${build.id}`)).json?.status === 'running');
    const source = storeArtifact('concurrent-source');
    writeFileSync(join(dir, 'hold-submit'), 'hold');
    const upload = await request(`/api/builds/${source}/submit`, { method: 'POST' });
    assert.equal(upload.status, 201);
    await until(async () => readFileSync(join(dir, 'builds', upload.json.id, 'build.log'), 'utf8').includes('[SUBMIT]'));
    assert.equal((await request(`/api/builds/${build.id}`)).json.status, 'running');
    assert.equal((await request(`/api/builds/${upload.json.id}`)).json.status, 'running');
    const second = await request(`/api/builds/${storeArtifact('second-upload')}/submit`, { method: 'POST' });
    assert.equal(second.status, 201);
    assert.equal((await request(`/api/builds/${second.json.id}`)).json.status, 'queued');
    await request(`/api/builds/${upload.json.id}/cancel`, { method: 'POST' });
    assert.equal((await done(upload.json.id)).status, 'cancelled');
    assert.equal((await request(`/api/builds/${build.id}`)).json.status, 'running');
    rmSync(join(dir, 'hold-submit'), { force: true });
    assert.equal((await done(second.json.id)).status, 'success');
    assert.equal((await request(`/api/builds/${build.id}`)).json.status, 'running');
  } finally {
    rmSync(hold, { force: true });
    rmSync(join(dir, 'hold-submit'), { force: true });
    if (build?.id) await done(build.id);
  }
});

test('uploads bypass CLI builds and do not block the next local build', async () => {
  const id = '20260103010301-live-cli';
  const folder = join(dir, 'builds', id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'meta.json'), JSON.stringify({ id, project: 'my_app', profile: 'production', status: 'running', trigger: 'cli', pid: process.pid, createdAt: Date.now(), startedAt: Date.now() }));
  writeFileSync(join(folder, 'build.log'), '[RUN_FASTLANE] compiling\n');
  await pause(2200);
  writeFileSync(join(dir, 'hold-submit'), 'hold');
  let queued;
  let upload;
  try {
    upload = await request(`/api/builds/${storeArtifact('cli-upload')}/submit`, { method: 'POST' });
    assert.equal(upload.status, 201);
    await until(async () => (await request(`/api/builds/${upload.json.id}`)).json?.status === 'running');
    queued = await request('/api/builds', { method: 'POST', body: { project: 'droid.app', platform: 'android', profile: 'development' } });
    assert.equal(queued.status, 201);
    assert.equal((await request(`/api/builds/${queued.json.id}`)).json.status, 'queued');
    const cli = JSON.parse(readFileSync(join(folder, 'meta.json'), 'utf8'));
    writeFileSync(join(folder, 'meta.json'), JSON.stringify({ ...cli, status: 'cancelled', finishedAt: Date.now() }));
    assert.equal((await done(queued.json.id)).status, 'success');
    assert.equal((await request(`/api/builds/${upload.json.id}`)).json.status, 'running');
  } finally {
    rmSync(join(dir, 'hold-submit'), { force: true });
    rmSync(folder, { recursive: true, force: true });
    if (upload?.json?.id) await done(upload.json.id);
  }
});

test('submission rejects development, simulator, missing, expired, and non-store artifacts', async () => {
  for (const [index, fields] of [
    { distribution: 'internal' }, { simulator: true }, { devClient: true }, { expired: true },
    { status: 'failed' }, { platform: 'android', artifact: 'app.apk' }, { missing: true }, { action: 'submit' },
  ].entries()) {
    const id = `2026010301020${index}-invalid-source`;
    const folder = join(dir, 'builds', id);
    mkdirSync(folder, { recursive: true });
    const source = { id, project: 'my_app', profile: 'production', distribution: 'store', artifact: 'app.ipa', status: 'success', createdAt: 1, ...fields };
    writeFileSync(join(folder, 'meta.json'), JSON.stringify(source));
    if (!fields.missing) writeFileSync(join(folder, source.artifact), 'invalid');
    assert.equal((await request(`/api/builds/${id}/submit`, { method: 'POST' })).status, 400);
    rmSync(folder, { recursive: true });
  }
});

test('project list carries icons and latest builds', async () => {
  const { status, json } = await request('/api/projects');
  assert.equal(status, 200);
  assert.deepEqual(json.slice(0, 2).map((item) => [item.name, item.icon]), [['my_app', false], ['pushed.app', true]]);
});

test('app icons come from app.json, and only from inside the project', async () => {
  assert.equal((await request('/api/projects/pushed.app/icon')).status, 200);
  assert.equal((await request('/api/projects/my_app/icon')).status, 404);
});

test('requests must name this server', async () => {
  assert.equal((await request('/api/builds', { host: 'evil.example:4180' })).status, 403);
  assert.equal((await request('/api/builds', { method: 'POST', host: `evil.example:${port}`, body: { project: 'my_app', profile: 'development' } })).status, 403);
  assert.equal((await request('/', { host: `localhost:${port}` })).status, 200);
  assert.equal((await request('/api/builds', { host: TAILNET })).status, 200);
});

test('changes need the x-macbuild header', async () => {
  assert.equal((await request('/api/builds', { method: 'POST', csrf: false, body: { project: 'my_app', profile: 'development' } })).status, 403);
});

test('a failed build carries its likely cause', async () => {
  const created = await request('/api/builds', { method: 'POST', body: { project: 'fail.app', profile: 'development' } });
  const finished = await done(created.json.id);
  assert.equal(finished.status, 'failed');
  assert.match(finished.hint.title, /provisioning profile is missing this device/);
  assert.match(finished.hint.fix, /eas device:create/);
});

test('a build with unchanged native code is skipped and points at the earlier one', async () => {
  const first = await done((await request('/api/builds', { method: 'POST', body: { project: 'skip.app', profile: 'development', skipUnchanged: true } })).json.id);
  assert.equal(first.status, 'success');
  assert.equal(first.fingerprint, 'fp-1');
  await pause(1100); // build ids are by the second
  const created = await request('/api/builds', { method: 'POST', body: { project: 'skip.app', profile: 'development', skipUnchanged: true } });
  const second = await done(created.json.id);
  assert.equal(second.status, 'skipped');
  assert.equal(second.reusedFrom, first.id);
  const { json } = await request(`/api/builds/${created.json.id}/log`);
  assert.match(json.lines.join('\n'), /--skip-unchanged/);
});

test('a later build of the same profile knows the size before it', async () => {
  await pause(1100);
  const created = await request('/api/builds', { method: 'POST', body: { project: 'my_app', profile: 'development' } });
  const finished = await done(created.json.id);
  assert.equal(finished.ipaBytes, 2048);
  assert.equal(finished.sizeBefore, 2048);
});

test('Android builds an APK, says who started it, and downloads as one', async () => {
  const created = await request('/api/builds', { method: 'POST', body: { project: 'droid.app', profile: 'development', platform: 'android' }, headers: { 'tailscale-user-name': 'Alex Rivera', 'tailscale-user-login': 'alex@example.com' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.artifact, 'app.apk');
  assert.deepEqual(created.json.by, { name: 'Alex Rivera', login: 'alex@example.com' });
  const finished = await done(created.json.id);
  assert.equal(finished.installable, true);
  const { json } = await request(`/api/builds/${created.json.id}/log`);
  assert.match(json.lines.join('\n'), /--platform android --profile development --fast --output \S+\/app\.apk/);
  assert.equal((await request(`/api/builds/${created.json.id}/artifact`)).type, 'application/vnd.android.package-archive');
  assert.equal((await request('/api/builds', { method: 'POST', body: { project: 'droid.app', profile: 'development', platform: 'windows' } })).status, 400);
});

test('one broken push rule does not stop the others', async () => {
  const build = await until(async () => (await builds()).find((item) => item.trigger === 'push' && item.project === 'pushed.app'));
  assert.equal(build.project, 'pushed.app');
  const [gone, pushed] = await until(async () => { const list = rules(); return list[1].sha !== 'old' && list; });
  assert.match(gone.error, /no longer in projects.conf/);
  assert.equal(pushed.sha, git(globalThis.apps['pushed.app'], 'rev-parse', 'HEAD'));
  assert.equal(pushed.error, undefined);
});

test('a nightly rule builds once a day', async () => {
  const nightly = await until(async () => (await builds()).find((item) => item.trigger === 'nightly'));
  assert.equal(nightly.project, 'my_app');
  await pause(1500);
  assert.equal((await builds()).filter((item) => item.trigger === 'nightly').length, 1);
  assert.match(rules().find((rule) => rule.on === 'nightly').lastRun, /^\d{4}-\d{2}-\d{2}$/);
});

test('pull requests from this repository are built, and forks are not', async () => {
  const pr = await until(async () => (await builds()).find((item) => item.trigger === 'pr'));
  assert.equal(pr.ref, 'feature/x');
  assert.equal((await builds()).some((item) => ['fork/y', 'no/commit'].includes(item.ref) || (item.trigger === 'pr' && item.source === 'working')), false);
  await until(async () => rules().find((rule) => rule.on === 'pr').prs?.['7']);
});

test('builds post their status to GitHub and to the webhook', async () => {
  const calls = await until(async () => { const text = readFileSync(join(dir, 'gh-calls'), 'utf8'); return /statuses\/.*state=success/.test(text) && text; });
  assert.match(calls, /api -X POST repos\/acme\/pushed\.app\/statuses\/[0-9a-f]{40} -f state=pending -f context=macbuild\/ios\/development/);
  assert.match(calls, /target_url=https:\/\/mac\.example\.ts\.net:8443\/#\/build\//);
  await until(async () => hooks.some((hook) => /fail\.app iOS development failed.*provisioning profile/i.test(hook.text)));
});

test('settings are checked, and the webhook stays secret', async () => {
  assert.equal((await request('/api/settings', { method: 'POST', body: { webhook: 'ftp://hooks.example/x' } })).status, 400);
  assert.equal((await request('/api/settings', { method: 'POST', body: { appleTeam: 'abc' } })).status, 400);
  const saved = await request('/api/settings', { method: 'POST', body: { appleTeam: 'ABCDE12345' } });
  assert.equal(saved.json.appleTeam, 'ABCDE12345');
  const { json } = await request('/api/system');
  const { askChoices, ...rest } = json.settings;
  assert.deepEqual(rest, {
    webhook: `127.0.0.1:${hookServer.address().port}`, githubStatus: true, appleTeam: 'ABCDE12345',
    autoInstall: 'off', askProvider: '', askModel: '',
  });
  assert.ok(askChoices.some((item) => item.model === 'grok-4.6'));
  assert.equal((await request('/api/settings', { method: 'POST', body: { askProvider: 'grok', askModel: 'nope' } })).status, 400);
  const ask = await request('/api/settings', { method: 'POST', body: { askProvider: 'grok', askModel: 'grok-4.7' } });
  assert.equal(ask.status, 200);
  assert.equal(ask.json.askProvider, 'grok');
  assert.equal(ask.json.askModel, 'grok-4.7');
});

test('a finished IPA can be installed on a paired iPhone', async () => {
  assert.equal((await request('/api/settings', { method: 'POST', body: { autoInstall: 'nope' } })).status, 400);
  const saved = await request('/api/settings', { method: 'POST', body: { autoInstall: 'wifi' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.autoInstall, 'wifi');
  const finished = await done((await request('/api/builds', { method: 'POST', body: { project: 'my_app', profile: 'development' } })).json.id);
  const src = join(dir, 'ipa-src');
  mkdirSync(join(src, 'Payload/App.app'), { recursive: true });
  writeFileSync(join(src, 'Payload/App.app/Info.plist'), 'ok');
  const ipa = join(dir, 'builds', finished.id, 'app.ipa');
  rmSync(ipa, { force: true });
  execFileSync('zip', ['-qr', ipa, 'Payload'], { cwd: src });
  const installed = await request(`/api/builds/${finished.id}/install`, { method: 'POST' });
  assert.equal(installed.status, 200, JSON.stringify(installed.json));
  assert.equal(installed.json.installed.name, 'Test iPhone');
  assert.equal(installed.json.installed.status, 'ok');
  assert.match(readFileSync(join(dir, 'xcrun-calls'), 'utf8'), /device install app --device phone-1/);
});

test('install: true tries the iPhone after a successful build', async () => {
  await pause(1100);
  const created = await request('/api/builds', { method: 'POST', body: { project: 'my_app', profile: 'development', install: true } });
  const finished = await done(created.json.id);
  const installed = await until(async () => (await request(`/api/builds/${finished.id}`)).json.installed);
  assert.ok(installed.error);
});

test('disk cleanup measures and clears only known folders', async () => {
  const { json } = await request('/api/disk?fresh');
  assert.ok(json.items.find((item) => item.key === 'work').bytes >= 8192);
  assert.equal(json.items.find((item) => item.key === 'history').cleanable, false);
  await until(async () => !(await builds()).some((item) => ['queued', 'running'].includes(item.status)), 30000);
  assert.equal((await request('/api/disk/clean', { method: 'POST', body: { key: 'pods' } })).status, 200);
  assert.equal(existsSync(join(home, 'Library/Caches/CocoaPods')), false);
  assert.equal((await request('/api/disk/clean', { method: 'POST', body: { key: 'history' } })).status, 400);
  assert.equal((await request('/api/disk/clean', { method: 'POST', body: { key: '../../etc' } })).status, 400);
});

test('rules are checked before they are saved', async () => {
  assert.equal((await request('/api/triggers', { method: 'POST', body: { project: 'my_app', on: 'nightly', branch: 'main', at: '25:00', enabled: true } })).status, 400);
  assert.equal((await request('/api/triggers', { method: 'POST', body: { project: 'my_app', on: 'weekly', branch: 'main', enabled: true } })).status, 400);
});

test('a newer push replaces a build of the same branch that has not started', async () => {
  const app = globalThis.apps['slow.app'];
  assert.equal((await request('/api/triggers', { method: 'POST', body: { project: 'slow.app', on: 'push', branch: 'main', profile: 'development', enabled: true } })).status, 200);
  pushCommit(app, 'second');
  await until(async () => (await builds()).find((item) => item.project === 'slow.app' && item.status === 'running'));
  pushCommit(app, 'third');
  await until(async () => (await builds()).find((item) => item.project === 'slow.app' && item.status === 'queued'));
  const fourth = pushCommit(app, 'fourth');
  const replaced = await until(async () => (await builds()).find((item) => item.project === 'slow.app' && /Replaced by a newer commit/.test(item.reason ?? '')));
  assert.equal(replaced.status, 'cancelled');
  await until(async () => (await builds()).find((item) => item.project === 'slow.app' && item.commit?.hash === fourth));
});

test('setup reports doctor and toggles open-at-login without a UI restart', async () => {
  const setup = await request('/api/setup');
  assert.equal(setup.status, 200);
  assert.equal(setup.json.doctor.ok, true);
  assert.ok(setup.json.projects.includes('my_app'));
  const agents = join(home, 'Library/LaunchAgents');
  mkdirSync(agents, { recursive: true });
  writeFileSync(join(agents, 'local.macbuild.ui.plist'), '<?xml version="1.0"?>\n<plist><dict><key>RunAtLoad</key><false/></dict></plist>\n');
  const saved = await request('/api/setup', { method: 'POST', body: { loginAtLogin: true, setupComplete: true } });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.setupComplete, true);
  assert.match(readFileSync(join(agents, 'local.macbuild.ui.plist'), 'utf8'), /<true\/>/);
  const bar = await request('/api/menubar');
  assert.equal(bar.status, 200);
  assert.ok(bar.json.projects.includes('my_app'));
  assert.equal(bar.json.loginAtLogin, true);
});

test('a dirty working copy lists files and starts a T3 commit thread', async () => {
  const app = globalThis.apps.my_app;
  writeFileSync(join(app, 'WIP'), 'local only\n');
  const detail = await request('/api/projects/my_app');
  assert.equal(detail.status, 200);
  assert.ok(detail.json.dirty >= 1);
  assert.equal(detail.json.changes.find((item) => item.path === 'WIP')?.label, 'untracked');
  const missing = await request('/api/projects/my_app/commit', { method: 'POST', body: { push: true } });
  assert.equal(missing.status, 400);
  assert.match(missing.json.error, /T3 Code/);
  const t3 = join(dir, 'bin/t3');
  writeFileSync(t3, `#!/bin/bash
echo "$*" >> "${dir}/t3-calls"
if [ "$2" = start ]; then
  cat > "${dir}/t3-prompt"
  echo '{"threadId":"t-ui","title":"macbuild commit my_app","link":"http://127.0.0.1:3773/t-ui","status":"running"}'
  exit 0
fi
echo '[]'
`, { mode: 0o755 });
  const started = await request('/api/projects/my_app/commit', { method: 'POST', body: { push: true } });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.threadId, 't-ui');
  assert.match(readFileSync(join(dir, 't3-prompt'), 'utf8'), /WIP/);
  assert.match(readFileSync(join(dir, 't3-prompt'), 'utf8'), /Do not dump unrelated work/);
});

test('a rule for a removed project can be removed', async () => {
  const { json } = await request('/api/system');
  assert.equal(json.triggers.find((rule) => rule.project === 'gone').missing, true);
  assert.equal(json.triggers.find((rule) => rule.project === 'pushed.app').missing, false);
  const removed = await request('/api/triggers', { method: 'POST', body: { project: 'gone', branch: 'main', enabled: false } });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.triggers.some((rule) => rule.project === 'gone'), false);
});

test('a failed build can be sent to T3 Code in the project folder', async () => {
  const t3 = join(dir, 'bin/t3');
  writeFileSync(t3, `#!/bin/bash
echo "$*" >> "${dir}/t3-ask-calls"
if [ "$2" = start ]; then
  cat > "${dir}/t3-ask-prompt"
  echo '{"threadId":"t-ask","title":"macbuild fix 20260104162904-my-app","link":"","status":"running"}'
  exit 0
fi
if [ "$2" = show ]; then
  echo '{"threadId":"t-ask","title":"macbuild fix 20260104162904-my-app","link":"http://127.0.0.1:3773/t-ask","status":"running"}'
  exit 0
fi
exit 0
`, { mode: 0o755 });
  const id = '20260104162904-my-app';
  mkdirSync(join(dir, 'builds', id), { recursive: true });
  writeFileSync(join(dir, 'builds', id, 'meta.json'), JSON.stringify({
    id, project: 'my_app', platform: 'ios', action: 'build', profile: 'development',
    status: 'failed', reason: 'expo config --json exited with non-zero code: 1', createdAt: Date.now(),
  }));
  writeFileSync(join(dir, 'builds', id, 'build.log'), '/app/node_modules/expo/bin/cli config --json exited with non-zero code: 1\n');
  const started = await request(`/api/builds/${id}/ask`, { method: 'POST', body: { provider: 'codex' } });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.threadId, 't-ask');
  assert.match(readFileSync(join(dir, 't3-ask-calls'), 'utf8'), /--provider codex/);
  assert.match(readFileSync(join(dir, 't3-ask-prompt'), 'utf8'), /Folder:/);
  assert.match(readFileSync(join(dir, 't3-ask-prompt'), 'utf8'), /my_app/);
  const saved = await request(`/api/builds/${id}`);
  assert.equal(saved.json.ask.threadId, 't-ask');
  assert.equal(saved.json.ask.link, 'http://127.0.0.1:3773/t-ask');
  const logged = await request(`/api/builds/${id}/log?from=0`);
  assert.equal(logged.json.build.ask.threadId, 't-ask');
  assert.equal(logged.json.build.ask.link, 'http://127.0.0.1:3773/t-ask');
  writeFileSync(join(dir, 't3-ask-calls'), '');
  assert.equal((await request('/api/settings', { method: 'POST', body: { askProvider: 'grok', askModel: 'grok-4.7' } })).status, 200);
  const again = await request(`/api/builds/${id}/ask`, { method: 'POST', body: {} });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.match(readFileSync(join(dir, 't3-ask-calls'), 'utf8'), /--provider grok --model grok-4\.7 /);
});

test('the dashboard starts Tailscale and publishes Serve', async () => {
  const tsPort = port + 1;
  const tsHome = join(dir, 'ts-home');
  const tsData = join(dir, 'ts-builds');
  mkdirSync(join(tsHome, 'bin'), { recursive: true });
  mkdirSync(tsData, { recursive: true });
  const ts = join(tsHome, 'bin/tailscale');
  writeFileSync(ts, `#!/bin/bash
echo "$*" >> "${dir}/ts-calls"
case "$1 $2" in
  "status --json")
    if [ -f "${dir}/ts-up" ]; then echo '{"BackendState":"Running","Self":{"Online":true,"DNSName":"mac.example.ts.net."}}'
    else echo '{"BackendState":"Stopped","Self":{}}'; fi;;
  "serve --bg")
    if [ -f "${dir}/ts-serve-once" ]; then touch "${dir}/ts-serve"; echo "Serve started"; exit 0; fi
    touch "${dir}/ts-serve-once"
    echo "failed" >&2
    exit 1;;
esac
[ "$1" = up ] && touch "${dir}/ts-up"
exit 0
`, { mode: 0o755 });
  const child = spawn(process.execPath, [join(ROOT, 'ui/server.mjs')], {
    stdio: 'ignore',
    env: {
      ...process.env,
      HOME: tsHome,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      MACBUILD_UI_PORT: String(tsPort),
      MACBUILD_UI_URL: `http://127.0.0.1:${tsPort}`,
      MACBUILD_BIN: join(dir, 'bin/macbuild'),
      MACBUILD_DATA: tsData,
      MACBUILD_PROJECTS: join(dir, 'projects.conf'),
      MACBUILD_CONFIG: join(dir, 'ui.json'),
      MACBUILD_TAILSCALE: ts,
    },
  });
  const hit = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: tsPort, path, headers: { host: `127.0.0.1:${tsPort}` } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.end();
  });
  try {
    await until(async () => (await hit('/api/builds').catch(() => null))?.status === 200);
    const setup = await until(async () => {
      const { json } = await hit('/api/setup');
      return json?.phoneUrl?.startsWith('https://') && json;
    }, 20000);
    assert.equal(setup.phoneUrl, 'https://mac.example.ts.net:8443');
    assert.ok(existsSync(join(dir, 'ts-serve')));
    const calls = readFileSync(join(dir, 'ts-calls'), 'utf8');
    assert.match(calls, /^up /m);
    assert.match(calls, /serve --bg --https=8443/);
    assert.ok(calls.split('\n').filter((line) => line.includes('serve --bg')).length >= 2);
  } finally {
    child.kill();
  }
});

test('the menu bar answers while Tailscale is waiting for the network', async () => {
  const tsPort = port + 2;
  const tsHome = join(dir, 'ts-slow-home');
  const tsData = join(dir, 'ts-slow-builds');
  mkdirSync(join(tsHome, 'bin'), { recursive: true });
  mkdirSync(tsData, { recursive: true });
  const ts = join(tsHome, 'bin/tailscale');
  writeFileSync(ts, `#!/bin/bash
echo "$*" >> "${dir}/ts-slow-calls"
case "$1 $2" in
  "status --json")
    if [ -f "${dir}/ts-slow-up" ]; then echo '{"BackendState":"Running","Self":{"Online":true,"DNSName":"mac.example.ts.net."}}'
    else echo '{"BackendState":"Stopped","Self":{}}'; fi;;
  "serve --bg") touch "${dir}/ts-slow-serve"; echo "Serve started";;
esac
if [ "$1" = up ]; then sleep 8; touch "${dir}/ts-slow-up"; fi
exit 0
`, { mode: 0o755 });
  const child = spawn(process.execPath, [join(ROOT, 'ui/server.mjs')], {
    stdio: 'ignore',
    env: {
      ...process.env,
      HOME: tsHome,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      MACBUILD_UI_PORT: String(tsPort),
      MACBUILD_UI_URL: `http://127.0.0.1:${tsPort}`,
      MACBUILD_BIN: join(dir, 'bin/macbuild'),
      MACBUILD_DATA: tsData,
      MACBUILD_PROJECTS: join(dir, 'projects.conf'),
      MACBUILD_CONFIG: join(dir, 'ui.json'),
      MACBUILD_TAILSCALE: ts,
    },
  });
  const hit = (path) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: tsPort, path, headers: { host: `127.0.0.1:${tsPort}` } }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => { req.destroy(); reject(new Error('timed out')); });
    req.end();
  });
  try {
    await until(async () => (await hit('/api/builds').catch(() => null))?.status === 200);
    const started = Date.now();
    const bar = await hit('/api/menubar');
    assert.equal(bar.status, 200);
    assert.ok(Date.now() - started < 2000, `menu bar waited ${Date.now() - started}ms for Tailscale`);
    await until(async () => existsSync(join(dir, 'ts-slow-serve')), 15000);
  } finally {
    child.kill();
  }
});
