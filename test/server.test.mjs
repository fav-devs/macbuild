// Boots ui/server.mjs against throwaway projects, with a fake macbuild, and checks it over HTTP.
// Needs the UI's dependencies: npm ci --prefix ui
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'macbuild-server-'));
const port = 40000 + Math.floor(Math.random() * 10000);
const TAILNET = 'mac.example.ts.net:8443';
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim();
let server;

function request(path, { method = 'GET', host = `127.0.0.1:${port}`, body, csrf = true } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, 'content-type': 'application/json', ...(csrf ? { 'x-macbuild': '1' } : {}) };
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, json }); });
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
function project(name, { icon = '' } = {}) {
  const origin = join(dir, `${name}.git`);
  const app = join(dir, name);
  git(dir, 'init', '-q', '--bare', origin);
  mkdirSync(app);
  git(app, 'init', '-q', '-b', 'main');
  writeFileSync(join(app, 'eas.json'), JSON.stringify({ build: { development: { distribution: 'internal' } } }));
  if (icon) {
    mkdirSync(join(app, 'assets'));
    writeFileSync(join(app, 'assets/icon.png'), 'not really a png');
    // 'outside' points ios.icon out of the project folder, which must never be served.
    writeFileSync(join(app, 'app.json'), JSON.stringify({ expo: { icon: './assets/icon.png', ...(icon === 'outside' ? { ios: { icon: '../../escape.png' } } : {}) } }));
  }
  git(app, 'add', '.');
  git(app, 'commit', '-qm', 'first');
  git(app, 'remote', 'add', 'origin', origin);
  git(app, 'push', '-q', 'origin', 'main');
  return app;
}

before(async () => {
  writeFileSync(join(dir, 'projects.conf'), `my_app|${project('my_app', { icon: 'outside' })}\npushed.app|${project('pushed.app', { icon: 'inside' })}\n`);
  // Build on push: a rule for a project that has since been removed, ahead of one with a new commit to build.
  writeFileSync(join(dir, 'ui.json'), JSON.stringify({
    triggers: [
      { project: 'gone', branch: 'main', profile: 'development', submit: false, sha: 'old' },
      { project: 'pushed.app', branch: 'main', profile: 'development', submit: false, sha: 'old' },
    ],
  }));
  const bin = join(dir, 'macbuild');
  writeFileSync(bin, '#!/bin/sh\necho "[START_BUILD] fake build $*" >> "$MACBUILD_LOG"\n', { mode: 0o755 });
  server = spawn(process.execPath, ['--import', join(ROOT, 'test/fast-timers.mjs'), join(ROOT, 'ui/server.mjs')], {
    stdio: 'ignore',
    env: {
      ...process.env, MACBUILD_UI_PORT: String(port), MACBUILD_UI_URL: `https://${TAILNET}`, MACBUILD_BIN: bin,
      MACBUILD_DATA: join(dir, 'builds'), MACBUILD_PROJECTS: join(dir, 'projects.conf'), MACBUILD_CONFIG: join(dir, 'ui.json'),
    },
  });
  await until(async () => (await request('/api/builds')).status === 200);
});
after(() => server?.kill());

test('a project named with an underscore builds', async () => {
  const created = await request('/api/builds', { method: 'POST', body: { project: 'my_app', profile: 'development' } });
  assert.equal(created.status, 201);
  assert.match(created.json.id, /^\d{14}-my-app$/);
  const done = await until(async () => {
    const { json } = await request(`/api/builds/${created.json.id}`);
    return json?.status === 'success' && json;
  });
  assert.equal(done.project, 'my_app');
  const { json } = await request(`/api/builds/${created.json.id}/log`);
  assert.match(json.lines.join('\n'), /fake build my_app --profile development --fast --output /);
});

test('project list carries icons and latest builds', async () => {
  const { status, json } = await request('/api/projects');
  assert.equal(status, 200);
  assert.deepEqual(json.map((item) => [item.name, item.icon]), [['my_app', false], ['pushed.app', true]]);
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

test('one broken push rule does not stop the others', async () => {
  const build = await until(async () => (await request('/api/builds')).json.builds.find((item) => item.trigger === 'push'));
  assert.equal(build.project, 'pushed.app');
  const rules = await until(async () => {
    const { triggers } = JSON.parse(readFileSync(join(dir, 'ui.json'), 'utf8'));
    return triggers.every((rule) => rule.project !== 'pushed.app' || rule.sha !== 'old') && triggers;
  });
  const [gone, pushed] = rules;
  assert.match(gone.error, /no longer in projects.conf/);
  assert.equal(pushed.sha, git(join(dir, 'pushed.app'), 'rev-parse', 'HEAD'));
  assert.equal(pushed.error, undefined);
});

test('a rule for a removed project can be removed', async () => {
  const { json } = await request('/api/system');
  assert.equal(json.triggers.find((rule) => rule.project === 'gone').missing, true);
  assert.equal(json.triggers.find((rule) => rule.project === 'pushed.app').missing, false);
  const removed = await request('/api/triggers', { method: 'POST', body: { project: 'gone', branch: 'main', enabled: false } });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.triggers.map((rule) => rule.project), ['pushed.app']);
});
