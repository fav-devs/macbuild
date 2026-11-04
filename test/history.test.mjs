import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finish, start } from '../lib/history.mjs';

test('start writes a running CLI job the dashboard can read', () => {
  const data = mkdtempSync(join(tmpdir(), 'macbuild-history-'));
  const { id, log, build } = start({ project: 'myapp', profile: 'development', platform: 'ios', data });
  assert.match(id, /^\d{14}-myapp$/);
  assert.equal(build.trigger, 'cli');
  assert.equal(build.status, 'running');
  assert.equal(readFileSync(log, 'utf8'), '');
  const ipa = join(data, 'out.ipa');
  writeFileSync(ipa, 'IPA\n');
  writeFileSync(log, 'Build successful\n');
  const done = finish(id, { status: 'success', artifact: ipa, data });
  assert.equal(done.status, 'success');
  assert.equal(readFileSync(join(data, id, 'app.ipa'), 'utf8'), 'IPA\n');
});

test('finish diagnoses a failed CLI log', () => {
  const data = mkdtempSync(join(tmpdir(), 'macbuild-history-'));
  const dir = join(data, 'app');
  mkdirSync(dir);
  const { id, log } = start({ project: 'myapp', profile: 'development', dir, data });
  writeFileSync(log, 'You are not logged in to EAS.\n');
  const done = finish(id, { status: 'failed', data });
  assert.equal(done.status, 'failed');
  assert.equal(done.hint.title, 'eas-cli isn’t signed in on this Mac');
});
