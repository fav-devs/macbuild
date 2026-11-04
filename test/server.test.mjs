// Boots ui/server.mjs against throwaway projects, with a fake macbuild and a fake gh, and checks it over HTTP.
// Needs the UI's dependencies: npm ci --prefix ui
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// A project whose origin looks like GitHub (acme/<name>) but is a local bare repository, through insteadOf.
function project(name, { icon = '' } = {}) {
  const origin = join(dir, `${name}.git`);
  const app = join(dir, name);
  const url = `https://github.com/acme/${name}.git`;
  git(dir, 'init', '-q', '--bare', origin);
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  writeFileSync(join(app, 'eas.json'), JSON.stringify({ build: { development: { distribution: 'internal' }, production: {} } }));
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
  writeFileSync(join(bin, 'macbuild'), `#!/bin/bash
project=$1; out=""; prev=""; for a in "$@"; do [ "$prev" = --output ] && out=$a; prev=$a; done
echo "[START_BUILD] fake build $*" >> "$MACBUILD_LOG"
case "$project" in
  fail.app) echo "❌ error: Provisioning profile \\"x\\" doesn't include the currently selected device \\"Phone\\"." >> "$MACBUILD_LOG"; exit 1;;
  skip.app) echo "macbuild: fingerprint fp-1" >> "$MACBUILD_LOG"
    earlier=$(ls "$MACBUILD_DATA"/*-skip-app/app.ipa 2>/dev/null | head -n 1)
    [ -n "$earlier" ] && { echo "macbuild: unchanged since $earlier" >> "$MACBUILD_LOG"; exit 0; };;
  slow.app) sleep 3;;
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
  server = spawn(process.execPath, ['--import', join(ROOT, 'test/fast-timers.mjs'), join(ROOT, 'ui/server.mjs')], {
    stdio: process.env.SERVER_LOG ? 'inherit' : 'ignore',
    env: {
      ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, MACBUILD_UI_PORT: String(port), MACBUILD_UI_URL: `https://${TAILNET}`,
      MACBUILD_BIN: join(bin, 'macbuild'), MACBUILD_DATA: join(dir, 'builds'), MACBUILD_PROJECTS: join(dir, 'projects.conf'), MACBUILD_CONFIG: join(dir, 'ui.json'),
    },
  });
  globalThis.apps = apps;
  await until(async () => (await request('/api/builds')).status === 200);
});
after(() => { server?.kill(); hookServer?.close(); });

test('a restart adopts a detached build that already succeeded', async () => {
  const finished = await until(async () => {
    const { json } = await request('/api/builds/20260101010101-my-app');
    return json?.status === 'success' && json;
  });
  assert.equal(finished.ipaBytes, 2048);
  assert.equal(finished.reason, undefined);
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
  assert.deepEqual(json.settings, { webhook: `127.0.0.1:${hookServer.address().port}`, githubStatus: true, appleTeam: 'ABCDE12345' });
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

test('a rule for a removed project can be removed', async () => {
  const { json } = await request('/api/system');
  assert.equal(json.triggers.find((rule) => rule.project === 'gone').missing, true);
  assert.equal(json.triggers.find((rule) => rule.project === 'pushed.app').missing, false);
  const removed = await request('/api/triggers', { method: 'POST', body: { project: 'gone', branch: 'main', enabled: false } });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.triggers.some((rule) => rule.project === 'gone'), false);
});
