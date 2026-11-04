import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRepo, parsePorcelain, promptFor, titleOf } from '../lib/commit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACBUILD = join(ROOT, 'bin/macbuild');
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' }).toString().trim();

test('porcelain maps status letters and rename targets', () => {
  const changes = parsePorcelain(' M src/a.ts\n?? pnpm-lock.yaml\nR  old.ts -> new.ts\nD  gone.ts\nA  added.ts\nM  staged.ts\n');
  assert.deepEqual(changes.map((item) => [item.code, item.path, item.label]), [
    [' M', 'src/a.ts', 'modified'],
    ['??', 'pnpm-lock.yaml', 'untracked'],
    ['R ', 'new.ts', 'renamed'],
    ['D ', 'gone.ts', 'deleted'],
    ['A ', 'added.ts', 'added'],
    ['M ', 'staged.ts', 'modified'],
  ]);
});

test('inspectRepo keeps a leading unstaged space so the first path stays intact', async () => {
  const home = mkdtempSync(join(tmpdir(), 'macbuild-porcelain-'));
  git(home, 'init', '-q', '-b', 'main');
  writeFileSync(join(home, 'keep.ts'), 'one\n');
  git(home, 'add', 'keep.ts');
  git(home, 'commit', '-qm', 'first');
  writeFileSync(join(home, 'keep.ts'), 'two\n');
  const copy = await inspectRepo(home);
  assert.equal(copy.changes[0].path, 'keep.ts');
  assert.equal(copy.changes[0].code, ' M');
});

test('the T3 prompt lists files and forbids a mixed dump commit', () => {
  const text = promptFor({
    name: 'less', branch: 'main', push: true, ahead: 0,
    changes: parsePorcelain(' M src/lib/telemetry.ts\n?? pnpm-lock.yaml\n'),
  });
  assert.match(text, /less/);
  assert.match(text, / M src\/lib\/telemetry\.ts/);
  assert.match(text, /\?\? pnpm-lock\.yaml/);
  assert.match(text, /Do not dump unrelated work/);
  assert.match(text, /push the current branch/);
  assert.equal(titleOf('less'), 'macbuild commit less');
});

test('macbuild commit uses T3 and refuses a naive dump when T3 is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'macbuild-commit-'));
  mkdirSync(join(home, 'bin'), { recursive: true });
  mkdirSync(join(home, '.config/macbuild'), { recursive: true });
  const app = join(home, 'code/myapp');
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, 'eas.json'), '{"build":{"development":{}}}');
  git(app, 'init', '-q', '-b', 'main');
  git(app, 'add', '.');
  git(app, 'commit', '-qm', 'first');
  writeFileSync(join(app, 'WIP'), 'x');
  writeFileSync(join(home, '.config/macbuild/projects.conf'), `myapp|${app}\n`);
  const env = { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`, MACBUILD_T3: '' };
  for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_') && name !== 'MACBUILD_T3') delete env[name];
  const missing = spawnSync(MACBUILD, ['commit', 'myapp', '--push'], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr + missing.stdout, /T3 Code/);
  assert.doesNotMatch(missing.stdout + missing.stderr, /git add \./);

  writeFileSync(join(home, 'bin/t3'), `#!/bin/bash
echo "$*" >> "$HOME/t3-calls"
if [ "$2" = start ]; then
  cat > "$HOME/t3-prompt"
  echo '{"threadId":"t-1","title":"macbuild commit myapp","link":"http://127.0.0.1:3773/t-1","status":"running"}'
  exit 0
fi
echo '[]'
`, { mode: 0o755 });
  const started = spawnSync(MACBUILD, ['commit', 'myapp', '--push'], { env: { ...env, MACBUILD_T3: join(home, 'bin/t3') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.match(started.stdout, /t-1|127\.0\.0\.1:3773/);
  const prompt = execFileSync('cat', [join(home, 't3-prompt')], { encoding: 'utf8' });
  assert.match(prompt, /WIP/);
  assert.match(prompt, /Do not dump unrelated work/);
  assert.match(prompt, /push the current branch/);
});
