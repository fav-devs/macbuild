// Runs bin/macbuild in a throwaway HOME with a fake eas on PATH, and checks everything macbuild does around eas.
// Runs on Linux too: the macOS-only steps (keychains, devicectl) are skipped or never reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Profiles for each kind of build: a development client (an APK on Android), a simulator build, and a store build.
const EAS_JSON = JSON.stringify({ build: { development: { developmentClient: true, distribution: 'internal' }, simulator: { extends: 'development', ios: { simulator: true } }, production: {} } });
const MACBUILD = join(ROOT, 'bin/macbuild');
// Asks one signing question the way eas does, colours included, then writes the IPA where --output says.
const FAKE_EAS = `#!/bin/bash
echo "$* cwd=$(pwd) env=$([ -f .env ] && echo yes || echo no)" >> "$HOME/eas-calls"
out=""; while [ $# -gt 0 ]; do [ "$1" = --output ] && out=$2; shift; done
printf '\\033[32m?\\033[39m \\033[1mReuse this distribution certificate?\\033[22m (Y/n) '
read -r reply
[ "$reply" = y ] || { echo "no answer: $reply"; exit 1; }
[ "\${FAKE_EAS:-}" = slow ] && sleep 3
[ "\${FAKE_EAS:-}" = fail ] && { echo "Error: build failed"; exit 1; }
[ "\${FAKE_EAS:-}" = provision ] && { echo "❌ error: Provisioning profile \"*[expo] com.acme.app AdHoc\" doesn't include the currently selected device \"Phone\"."; exit 1; }
echo IPA > "$out"
`;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim();

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'macbuild-cli-'));
  for (const folder of ['Library/Logs', 'tmp', 'bin']) mkdirSync(join(home, folder), { recursive: true });
  writeFileSync(join(home, 'bin/eas'), FAKE_EAS, { mode: 0o755 });
  const app = join(home, 'code/myapp');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'eas.json'), EAS_JSON);
  const env = { ...process.env, HOME: home, TMPDIR: join(home, 'tmp'), PATH: `${join(home, 'bin')}:${process.env.PATH}` };
  for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_')) delete env[name];
  const run = (args, extra = {}) => spawnSync(MACBUILD, args, { env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 });
  const start = (args, extra = {}) => new Promise((resolve) => {
    const child = spawn(MACBUILD, args, { env: { ...env, ...extra } });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('close', (status) => resolve({ status, stdout }));
  });
  const list = () => run(['list']).stdout.trim().split('\n').filter(Boolean).map((line) => line.split('|'));
  const calls = () => (existsSync(join(home, 'eas-calls')) ? readFileSync(join(home, 'eas-calls'), 'utf8') : '');
  return { home, app, run, start, list, calls, cache: join(home, '.cache/macbuild') };
}

test('add checks names and replaces only an exact match', () => {
  const { home, app, run, list } = sandbox();
  const result = run(['add', 'my app', app]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /bad name/);
  const other = join(home, 'code/other');
  mkdirSync(other);
  writeFileSync(join(other, 'eas.json'), '{}');
  assert.equal(run(['add', 'myxapp', other]).status, 0);
  assert.equal(run(['add', 'my.app', app]).status, 0);
  assert.equal(run(['add', 'my.app', app]).status, 0);
  assert.deepEqual(list().map(([name]) => name).sort(), ['my.app', 'myxapp']);
});

test('scan keeps both apps when two share a folder name', () => {
  const { home, run, list } = sandbox();
  for (const repo of ['shop', 'blog']) {
    mkdirSync(join(home, 'code', repo, 'apps/mobile'), { recursive: true });
    writeFileSync(join(home, 'code', repo, 'apps/mobile/eas.json'), '{}');
    git(join(home, 'code', repo), 'init', '-q');
  }
  run(['scan']);
  run(['scan']);
  const mobile = list().filter(([, dir]) => dir.endsWith('apps/mobile'));
  assert.equal(mobile.length, 2);
  assert.deepEqual(mobile.map(([, dir]) => dir.split('/').at(-3)).sort(), ['blog', 'shop']);
  assert.ok(mobile.some(([name]) => name === 'mobile'));
  assert.ok(mobile.some(([name, dir]) => name === `${dir.split('/').at(-3)}-mobile`));
});

test('a build answers the prompt, delivers the IPA and cleans up', () => {
  const { home, app, run, calls, cache } = sandbox();
  run(['add', 'myapp', app]);
  const out = join(home, 'out.ipa');
  const result = run(['myapp', '--output', out]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /built: /);
  assert.equal(readFileSync(out, 'utf8'), 'IPA\n');
  assert.match(calls(), /^build --platform ios --profile development --local --output /);
  assert.deepEqual(readdirSync(cache).filter((file) => file.endsWith('.ipa') || file === 'build.lock'), []);
  assert.deepEqual(readdirSync(join(home, 'tmp')).filter((file) => file.startsWith('macbuild-')), []);
  assert.ok(existsSync(join(home, 'Library/Logs/myapp-ios-build-development.log')));
});

test('a failed build reports the failure', () => {
  const { home, app, run } = sandbox();
  run(['add', 'myapp', app]);
  const out = join(home, 'out.ipa');
  const result = run(['myapp', '--output', out], { FAKE_EAS: 'fail' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /build failed/);
  assert.equal(existsSync(out), false);
});

test('--install without a device stops before building', () => {
  const { app, run, calls } = sandbox();
  run(['add', 'myapp', app]);
  const result = run(['myapp', '--install']);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MACBUILD_DEVICE/);
  assert.equal(calls(), '');
});

test('a second build waits for the first', async () => {
  const { home, app, run, start } = sandbox();
  run(['add', 'myapp', app]);
  const first = start(['myapp', '--output', join(home, 'first.ipa')], { FAKE_EAS: 'slow' });
  await new Promise((resolve) => { setTimeout(resolve, 1000); });
  // The second build has a log of its own, the way the web UI starts builds, so the wait shows there too.
  const log = join(home, 'second.log');
  const second = await start(['myapp', '--output', join(home, 'second.ipa')], { MACBUILD_LOG: log });
  assert.equal((await first).status, 0);
  assert.equal(second.status, 0, second.stdout);
  assert.match(second.stdout, /waiting for the build already running/);
  assert.match(readFileSync(log, 'utf8'), /waiting for the build already running/);
  assert.ok(existsSync(join(home, 'first.ipa')) && existsSync(join(home, 'second.ipa')));
});

test('a lock left by a build that died is taken over', () => {
  const { home, app, run, cache } = sandbox();
  run(['add', 'myapp', app]);
  mkdirSync(cache, { recursive: true });
  symlinkSync(String(spawnSync('true').pid), join(cache, 'build.lock'));
  const result = run(['myapp', '--output', join(home, 'out.ipa')]);
  assert.equal(result.status, 0, result.stdout);
  assert.doesNotMatch(result.stdout, /waiting/);
});

test('--ref builds a clean checkout of a monorepo app reached through a symlink', () => {
  const { home, run, calls, cache } = sandbox();
  const repo = join(home, 'code/mono');
  const app = join(repo, 'apps/mobile');
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  mkdirSync(app, { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n.env\n');
  writeFileSync(join(repo, 'package-lock.json'), '{}\n');
  writeFileSync(join(app, 'eas.json'), EAS_JSON);
  git(home, 'init', '-q', '--bare', 'origin.git');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'first');
  git(repo, 'remote', 'add', 'origin', join(home, 'origin.git'));
  git(repo, 'push', '-q', 'origin', 'main');
  writeFileSync(join(app, '.env'), 'KEY=1\n');
  writeFileSync(join(app, 'uncommitted.txt'), 'local only\n');
  symlinkSync(repo, join(home, 'linked'));
  run(['add', 'mobile', join(home, 'linked/apps/mobile')]);
  const result = run(['mobile', '--ref', 'main', '--output', join(home, 'out.ipa')]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(calls(), new RegExp(`cwd=${cache}/src/mobile/apps/mobile env=yes`));
  assert.equal(existsSync(join(cache, 'src/mobile')), false);
});

test('Android builds an APK for development and refuses to install an AAB', () => {
  const { home, app, run, calls } = sandbox();
  run(['add', 'myapp', app]);
  const result = run(['myapp', '--android', '--output', join(home, 'out.apk')]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(calls(), /^build --platform android --profile development --local --output .*\.apk /);
  assert.ok(existsSync(join(home, 'out.apk')));
  const aab = run(['myapp', '--android', '--profile', 'production', '--install']);
  assert.equal(aab.status, 2);
  assert.match(aab.stdout, /AAB/);
  assert.equal(run(['myapp', '--android', '--testflight']).status, 2);
});

test('a simulator profile builds a .tar.gz, and an unknown profile is refused', () => {
  const { home, app, run, calls } = sandbox();
  run(['add', 'myapp', app]);
  const result = run(['myapp', '--profile', 'simulator', '--output', join(home, 'sim.tar.gz')]);
  assert.equal(result.status, 0, result.stdout);
  assert.match(calls(), /--profile simulator --local --output .*\.tar\.gz /);
  const missing = run(['myapp', '--profile', 'nope']);
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /no build profile "nope"/);
});

test('--skip-unchanged reuses a build whose native code is the same', () => {
  const { home, app, run, calls } = sandbox();
  // A stand-in for the project's own @expo/fingerprint: the hash comes from FAKE_FP.
  mkdirSync(join(app, 'node_modules/@expo/fingerprint'), { recursive: true });
  writeFileSync(join(app, 'node_modules/@expo/fingerprint/package.json'), '{"name":"@expo/fingerprint","main":"index.js"}');
  writeFileSync(join(app, 'node_modules/@expo/fingerprint/index.js'), 'exports.createFingerprintAsync = async (dir, options) => ({ hash: `${process.env.FAKE_FP}-${options.platforms[0]}` });');
  run(['add', 'myapp', app]);
  const builds = () => calls().split('\n').filter((line) => line.startsWith('build ')).length;
  assert.equal(run(['myapp', '--skip-unchanged', '--output', join(home, 'one.ipa')], { FAKE_FP: 'aaa' }).status, 0);
  const again = run(['myapp', '--skip-unchanged', '--output', join(home, 'two.ipa')], { FAKE_FP: 'aaa' });
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /native code unchanged/);
  assert.equal(builds(), 1);
  assert.equal(existsSync(join(home, 'two.ipa')), false);
  assert.equal(run(['myapp', '--skip-unchanged', '--output', join(home, 'three.ipa')], { FAKE_FP: 'bbb' }).status, 0);
  assert.equal(builds(), 2);
  assert.match(readFileSync(join(home, '.local/share/macbuild/fingerprints'), 'utf8'), /myapp\|development\|ios\|bbb-ios\|/);
  assert.equal(run(['myapp', '--skip-unchanged', '--submit'], { FAKE_FP: 'bbb' }).status, 2);
});

test('a failed build names a known cause and its fix', () => {
  const { app, run } = sandbox();
  run(['add', 'myapp', app]);
  const result = run(['myapp'], { FAKE_EAS: 'provision' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /likely cause: The provisioning profile is missing this device/);
  assert.match(result.stdout, /eas device:create/);
});

test('the eas guard blocks cloud builds only', () => {
  const { home } = sandbox();
  const bin = join(home, 'guard');
  mkdirSync(bin);
  copyFileSync(join(ROOT, 'bin/eas-guard'), join(bin, 'eas'));
  writeFileSync(join(bin, 'eas.real'), '#!/bin/sh\necho real eas "$@"\n', { mode: 0o755 });
  const eas = (...args) => spawnSync('bash', [join(bin, 'eas'), ...args], { encoding: 'utf8' });
  assert.equal(eas('build', '--platform', 'ios').status, 64);
  assert.equal(eas('build:resign').status, 64);
  assert.equal(eas('workflow:run', 'x.yml').status, 64);
  assert.equal(eas('build', '--platform', 'ios', '--local').stdout, 'real eas build --platform ios --local\n');
  assert.equal(eas('build:list').status, 0);
  assert.equal(eas('whoami').status, 0);
});
