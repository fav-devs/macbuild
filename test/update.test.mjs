import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateOptions } from '../lib/update.mjs';
import { jobSucceeded } from '../lib/build-result.mjs';

const folder = mkdtempSync(join(tmpdir(), 'macbuild-update-options-'));
const file = join(folder, 'eas.json');
writeFileSync(file, JSON.stringify({ build: {
  base: { channel: 'production', environment: 'production', env: { APP_VARIANT: 'production' } },
  production: { extends: 'base' }, preview: { channel: 'preview' },
  development: { developmentClient: true, channel: 'development' }, custom: { channel: 'beta' },
} }));
const options = { channel: 'production', message: 'Fix keyboard', ref: 'main' };

test('OTA selects an explicit channel, inherited profile, environment, and platforms', () => {
  assert.deepEqual(updateOptions(file, options), { ...options, profile: 'production', environment: 'production', platform: 'all' });
  assert.equal(updateOptions(file, { ...options, profile: 'preview', channel: 'preview' }).environment, 'preview');
  assert.equal(updateOptions(file, { ...options, profile: 'custom', channel: 'beta', environment: 'preview' }).environment, 'preview');
});

test('OTA rejects missing inputs, mismatched channels, and development clients', () => {
  for (const fields of [
    { ref: '' }, { ref: '--help' }, { ref: '../secret' }, { message: '   ' }, { message: 'x'.repeat(1001) },
    { channel: '' }, { channel: 'preview' }, { channel: '--production' }, { environment: 'unknown' },
    { profile: 'missing' }, { profile: 'development', channel: 'development' }, { platform: 'web' },
    { profile: 'custom', channel: 'beta' },
  ]) assert.throws(() => updateOptions(file, { ...options, ...fields }));
});

test('OTA recovery requires its own publish success marker', () => {
  assert.equal(jobSucceeded({ action: 'update' }, 'Build successful\n'), false);
  assert.equal(jobSucceeded({ action: 'update' }, 'macbuild: update successful\n'), true);
});
