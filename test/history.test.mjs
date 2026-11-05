import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finish, readJob, start, writeJob } from '../lib/history.mjs';
import { jobSucceeded } from '../lib/build-result.mjs';

test('retained successful build remains failed when its wrapper prevents submission', () => {
  const data = mkdtempSync(join(tmpdir(), 'macbuild-wrapper-'));
  const { id, log } = start({ project: 'less', action: 'submit', data });
  const artifact = join(data, 'output.ipa');
  writeFileSync(artifact, 'IPA');
  const text = "> 174 | throw session.error ?? EncodeFailed()\nBuild successful\n/bin/macbuild: line 697: syntax error near unexpected token `('\n";
  writeFileSync(log, text);
  const build = finish(id, { status: 'failed', artifact, data });
  assert.equal(build.status, 'failed');
  assert.equal(build.buildCompleted, true);
  assert.equal(build.ipaBytes, 3);
  assert.match(build.reason, /syntax error near unexpected token/);
  assert.equal(jobSucceeded(build, text), false);
  assert.equal(jobSucceeded(build, `${text}macbuild: submission successful\n`), true);
  assert.equal(jobSucceeded({ action: 'build' }, text), true);
});

test('start preserves store eligibility from the original CLI build profile', () => {
  const root = mkdtempSync(join(tmpdir(), 'macbuild-history-store-'));
  writeFileSync(join(root, 'eas.json'), JSON.stringify({ build: { production: {}, development: { developmentClient: true, distribution: 'internal' } } }));
  const { build } = start({ project: 'myapp', profile: 'production', dir: root, data: join(root, 'builds') });
  assert.equal(build.distribution, 'store');
  assert.equal(build.devClient, false);
});

test('CLI submission-only jobs are distinguishable from builds with auto-upload', () => {
  const data = mkdtempSync(join(tmpdir(), 'macbuild-history-upload-'));
  const { build } = start({ project: 'upload', action: 'submit', submissionOnly: 'true', data });
  assert.equal(build.submissionOnly, true);
  assert.equal(build.action, 'submit');
});

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

test('finish can record success after a false CLI-stopped failure', () => {
  const data = mkdtempSync(join(tmpdir(), 'macbuild-history-'));
  const { id, log } = start({ project: 'myapp', profile: 'development', data });
  writeFileSync(log, 'Build successful\n');
  const stopped = readJob(id, data);
  writeJob({ ...stopped, status: 'failed', reason: 'The CLI build stopped', finishedAt: Date.now() }, data);
  const ipa = join(data, 'out.ipa');
  writeFileSync(ipa, 'IPA\n');
  const done = finish(id, { status: 'success', artifact: ipa, data });
  assert.equal(done.status, 'success');
  assert.equal(done.reason, undefined);
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
