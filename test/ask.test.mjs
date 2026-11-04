import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../lib/diagnose.mjs';
import { listAskChoices, parseAskChoice, pickAskJob, promptForAsk, titleOfAsk } from '../lib/ask.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACBUILD = join(ROOT, 'bin/macbuild');

test('parseAskChoice fills a known Grok or Codex model', () => {
  assert.deepEqual(parseAskChoice('grok', 'grok-4.7'), { provider: 'grok', model: 'grok-4.7' });
  assert.deepEqual(parseAskChoice('codex', ''), { provider: 'codex', model: 'gpt-6.1-sol' });
  assert.deepEqual(parseAskChoice('', ''), { provider: '', model: '' });
});

test('listAskChoices reads T3’s enabled providers', () => {
  const home = mkdtempSync(join(tmpdir(), 'macbuild-t3-'));
  mkdirSync(join(home, 'userdata'), { recursive: true });
  mkdirSync(join(home, 'caches'), { recursive: true });
  writeFileSync(join(home, 'userdata/settings.json'), JSON.stringify({
    providerInstances: {
      grok: { driver: 'grok', displayName: 'Grok', enabled: true },
      claudeAgent_2: { driver: 'claudeAgent', displayName: 'Claude', enabled: true },
      cursor: { driver: 'cursor', displayName: 'Cursor', enabled: false },
    },
  }));
  writeFileSync(join(home, 'userdata/model-manifest.json'), JSON.stringify({
    manifest: { currentModels: { claudeAgent: ['claude-opus-5-5', 'claude-sonnet-5-5'] } },
  }));
  writeFileSync(join(home, 'caches/grok.json'), JSON.stringify({
    displayName: 'Grok', models: [
      { slug: 'grok-4.7', name: 'Grok 4.7', isDefault: true },
      { slug: 'grok-4.6', name: 'Grok 4.6' },
    ],
  }));
  writeFileSync(join(home, 'caches/claudeAgent_2.json'), JSON.stringify({
    displayName: 'Claude', models: [
      { slug: 'claude-opus-5-5', name: 'Claude Opus 5.5', isDefault: true },
      { slug: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { slug: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
    ],
  }));
  writeFileSync(join(home, 'caches/cursor.json'), JSON.stringify({
    displayName: 'Cursor', enabled: false, models: [{ slug: 'default', name: 'Cursor' }],
  }));
  const choices = listAskChoices(home);
  assert.ok(choices.some((item) => item.provider === 'grok' && item.model === 'grok-4.6' && item.group === 'Grok'));
  assert.ok(choices.some((item) => item.provider === 'claudeAgent_2' && item.model === 'claude-opus-5-5' && item.group === 'Claude'));
  assert.ok(choices.some((item) => item.provider === 'claudeAgent_2' && item.model === 'claude-sonnet-5-5'));
  assert.equal(choices.some((item) => item.model === 'claude-opus-4-6'), false);
  assert.equal(choices.some((item) => item.provider === 'cursor'), false);
  assert.deepEqual(parseAskChoice('claudeAgent_2', 'claude-opus-5-5'), { provider: 'claudeAgent_2', model: 'claude-opus-5-5' });
});

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
  writeFileSync(join(home, '.config/macbuild/ui.json'), JSON.stringify({ askProvider: 'grok', askModel: 'grok-4.7' }));
  writeFileSync(join(home, 't3-calls'), '');
  const remembered = spawnSync(MACBUILD, ['ask', id], { env: { ...env, MACBUILD_T3: join(home, 'bin/t3') }, encoding: 'utf8', timeout: 15000 });
  assert.equal(remembered.status, 0, remembered.stdout + remembered.stderr);
  assert.match(readFileSync(join(home, 't3-calls'), 'utf8'), /--provider grok --model grok-4\.7 /);
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
