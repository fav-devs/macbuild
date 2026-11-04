import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../lib/diagnose.mjs';
import { pickAskJob, promptForAsk, titleOfAsk } from '../lib/ask.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACBUILD = join(ROOT, 'bin/macbuild');

test('pickAskJob prefers a failed job for a project name', () => {
  const items = [
    { id: '20260103030303-myapp', project: 'myapp', status: 'success', createdAt: 3 },
    { id: '20260102020202-myapp', project: 'myapp', status: 'failed', createdAt: 2 },
    { id: '20260101010101-other', project: 'other', status: 'failed', createdAt: 1 },
  ];
  assert.equal(pickAskJob(items, '').id, '20260102020202-myapp');
  assert.equal(pickAskJob(items, 'myapp').id, '20260102020202-myapp');
  assert.equal(pickAskJob(items, '20260103030303').id, '20260103030303-myapp');
});

test('expo config failures are a known cause', () => {
  const hint = diagnose('/Users/favmac/Documents/parley/node_modules/expo/bin/cli config --json exited with non-zero code: 1\n    Error: build command failed.\n');
  assert.equal(hint.title, 'Expo couldn’t read the app config');
  assert.match(hint.fix, /node_modules/);
});

test('the ask prompt stays in the project folder and includes the log', () => {
  const text = promptForAsk({
    build: {
      id: '20261104162904-parley', project: 'parley', platform: 'ios', profile: 'development',
      source: 'github', ref: 'main', commit: { short: '1f9ad5a', subject: 'Keyboard Lab' },
      reason: 'build failed (exit 1)',
    },
    dir: '/Users/favmac/Documents/parley',
    log: 'expo/bin/cli config --json exited with non-zero code: 1\n',
  });
  assert.equal(titleOfAsk('20261104162904-parley'), 'macbuild fix 20261104162904-parley');
  assert.match(text, /Folder: \/Users\/favmac\/Documents\/parley/);
  assert.match(text, /macbuild parley/);
  assert.match(text, /Do not switch to ~\/\.cache\/macbuild/);
  assert.match(text, /config --json/);
  assert.match(text, /1f9ad5a/);
});

test('macbuild ask starts a T3 thread in the project folder, and --codex selects Codex', () => {
  const home = mkdtempSync(join(tmpdir(), 'macbuild-ask-'));
  const app = join(home, 'code/myapp');
  mkdirSync(join(home, 'bin'), { recursive: true });
  mkdirSync(app, { recursive: true });
  mkdirSync(join(home, '.config/macbuild'), { recursive: true });
  writeFileSync(join(home, '.config/macbuild/projects.conf'), `myapp|${app}\n`);
  const id = '20260104162904-myapp';
  mkdirSync(join(home, '.local/share/macbuild/builds', id), { recursive: true });
  writeFileSync(join(home, '.local/share/macbuild/builds', id, 'meta.json'), JSON.stringify({
    id, project: 'myapp', platform: 'ios', profile: 'development', status: 'failed',
    reason: 'expo config --json exited with non-zero code: 1', createdAt: Date.now(),
  }));
  writeFileSync(join(home, '.local/share/macbuild/builds', id, 'build.log'), 'expo/bin/cli config --json exited with non-zero code: 1\n');
  const env = { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`, MACBUILD_T3: '' };
  for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_') && name !== 'MACBUILD_T3') delete env[name];
  const missing = spawnSync(MACBUILD, ['ask', id], { env, encoding: 'utf8', timeout: 15000 });
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stderr + missing.stdout, /T3 Code/);

  writeFileSync(join(home, 'bin/t3'), `#!/bin/bash
echo "$*" >> "$HOME/t3-calls"
if [ "$2" = start ]; then
  cat > "$HOME/t3-prompt"
  echo '{"threadId":"t-ask","title":"macbuild fix 20260104162904-myapp","link":"","status":"running"}'
  exit 0
fi
if [ "$2" = show ]; then
  echo '{"threadId":"t-ask","title":"macbuild fix 20260104162904-myapp","link":"http://127.0.0.1:3773/t-ask","status":"running"}'
  exit 0
fi
exit 0
`, { mode: 0o755 });
  const grok = spawnSync(MACBUILD, ['ask', id], { env: { ...env, MACBUILD_T3: join(home, 'bin/t3') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(grok.status, 0, grok.stdout + grok.stderr);
  assert.match(readFileSync(join(home, 't3-calls'), 'utf8'), /thread start --json --title macbuild fix 20260104162904-myapp --provider grok --model grok-4\.6 /);
  writeFileSync(join(home, 't3-calls'), '');
  const started = spawnSync(MACBUILD, ['ask', id, '--codex'], { env: { ...env, MACBUILD_T3: join(home, 'bin/t3') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(started.status, 0, started.stdout + started.stderr);
  assert.match(started.stdout, /127\.0\.0\.1:3773/);
  const calls = readFileSync(join(home, 't3-calls'), 'utf8');
  assert.match(calls, /thread start --json --title macbuild fix 20260104162904-myapp --provider codex --model gpt-6\.1-sol /);
  assert.match(calls, /thread show --json --messages 0 t-ask/);
  assert.match(calls, new RegExp(`^app ${app}$`, 'm'));
  const prompt = readFileSync(join(home, 't3-prompt'), 'utf8');
  assert.match(prompt, new RegExp(`Folder: ${app}`));
  assert.match(prompt, /macbuild myapp/);
  const saved = JSON.parse(readFileSync(join(home, '.local/share/macbuild/builds', id, 'meta.json'), 'utf8'));
  assert.equal(saved.ask.threadId, 't-ask');
  assert.equal(saved.ask.link, 'http://127.0.0.1:3773/t-ask');
  assert.equal(saved.ask.provider, 'codex');
});
