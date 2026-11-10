import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
const header = source.slice(source.indexOf('function buildHead('), source.indexOf('function buildAlert('));
const badges = source.match(/^const (?:badge|buildBadge) = .*;$/gm).join('\n');
function render(build) {
  return runInNewContext(`${badges}\n${header}\nbuildHead(build)`, {
    build, hasFile: (item) => Boolean(item.action !== 'update' && item.ipaBytes && !item.expired && (item.status === 'success' || (item.status === 'failed' && item.buildCompleted))),
    active: (item) => ['queued', 'running', 'cancelling'].includes(item.status),
    storeName: (platform) => platform === 'android' ? 'Google Play' : 'TestFlight',
    submits: (item) => ['submit', 'testflight'].includes(item.action),
    esc: String, icon: () => '', fileKind: () => 'IPA', installUrl: () => '', askOpen: () => '',
    avatar: () => '', subject: () => '', STATUS: { failed: ['Failed'], success: ['Success'], running: ['Running'] }, platformTag: () => '', profileTag: () => '',
    took: () => '', ago: () => '',
  });
}
const storeBuild = { id: '20260101-app', project: 'app', status: 'success', distribution: 'store', artifact: 'app.ipa', ipaBytes: 100 };

test('store build headers offer submission for the correct platform', () => {
  assert.match(render(storeBuild), /data-submit="20260101-app".*Submit to TestFlight/);
  assert.match(render({ ...storeBuild, platform: 'android', artifact: 'app.aab' }), /Submit to Google Play/);
});

test('completed artifacts survive a failed post-build upload', () => {
  const recovered = { ...storeBuild, status: 'failed', action: 'submit', buildCompleted: true };
  assert.match(render(recovered), /data-submit=.*Submit to TestFlight/);
  assert.match(render(recovered), /Build ready · post-build step failed/);
  assert.doesNotMatch(render({ ...storeBuild, status: 'failed' }), /Build ready/);
  assert.doesNotMatch(render({ ...recovered, submission: 'already scheduled' }), /data-submit=/);
  assert.doesNotMatch(render({ ...recovered, submissionOnly: true }), /data-submit=/);
});

test('OTA jobs never offer a store rebuild or artifact submission', () => {
  const html = render({ id: 'ota-job', project: 'less', action: 'update', status: 'success', channel: 'production' });
  assert.doesNotMatch(html, /data-rebuild=|data-submit=/);
  assert.match(html, /#\/p\/less\/updates/);
});

test('OTA form has explicit destination, environment, pushed source, platform and message', () => {
  const formSource = source.slice(source.indexOf('function updateForm('), source.indexOf('const PROJECT_SECTIONS ='));
  const html = runInNewContext(`${formSource}\nupdateForm(data)`, {
    data: { profiles: [{ name: 'production', channel: 'production' }, { name: 'development', developmentClient: true, channel: 'development' }], branches: [{ name: 'main', short: 'abc123' }] },
    esc: String, icon: () => '',
  });
  for (const name of ['profile', 'channel', 'environment', 'ref', 'platform', 'message']) assert.match(html, new RegExp(`name="${name}"`));
  assert.doesNotMatch(html, /value="development" data-channel=/);
  assert.match(html, /compatible runtimes|compatible.*runtime/i);
  assert.match(html, /not uncommitted files/);
});

test('ineligible builds do not offer submission or rebuild a submission job', () => {
  for (const fields of [
    { distribution: 'internal' }, { devClient: true }, { simulator: true }, { expired: true },
    { ipaBytes: 0 }, { status: 'running' }, { status: 'failed' }, { submission: 'uploaded' },
    { platform: 'android', artifact: 'app.apk' }, { installable: true }, { action: 'submit' }, { action: 'testflight' },
  ]) assert.doesNotMatch(render({ ...storeBuild, ...fields }), /data-submit=/);
  const submission = render({ ...storeBuild, submissionOnly: true, submissionOf: 'original' });
  assert.doesNotMatch(submission, /data-submit=|data-rebuild=/);
  assert.match(submission, /Original build/);
});

test('live dashboard shows both a build and its independent upload lane', () => {
  const live = source.slice(source.indexOf('function liveCard('), source.indexOf('function updateLive('));
  const html = runInNewContext(`${live}\nliveCard(builds)`, {
    builds: [{ id: 'local-build', project: 'less', status: 'running' }, { id: 'upload', project: 'parley', status: 'running', submissionOnly: true }],
    esc: String, kindOf: () => 'production', avatar: () => '', subject: (build) => build.project,
    refOf: () => 'main', short: () => '', progress: () => '', icon: () => '',
  });
  assert.match(html, /Building and submitting/);
  assert.match(html, /data-live-job="local-build"/);
  assert.match(html, /data-live-job="upload"/);
  assert.match(html, /Upload · production/);
});

test('Settings device rows escape names and only offer revocation for authorized connections', () => {
  const renderSource = source.slice(source.indexOf('  const devicesPage = routing.token;'), source.indexOf('  const loadDevices = async () =>'));
  const escapeSource = source.match(/^const esc = .*;$/m)[0];
  const element = { innerHTML: '' };
  const render = (devices) => {
    runInNewContext(`${escapeSource}\n${renderSource}\ndrawDevices({ devices });`, {
      devices, routing: { token: 1 }, $: () => element,
      ago: () => 'a minute ago', day: () => 'Dec 10', empty: () => 'No connected devices',
    });
    return element.innerHTML;
  };
  const base = { id: 'abc', name: '<img src=x onerror=alert(1)>', device: true, allProjects: true, projects: [], profiles: ['development'], scopes: ['read', 'build'], expiresAt: null, lastSeenAt: 100 };
  const html = render([{ ...base, status: 'authorized' }]);
  assert.doesNotMatch(html, /<img|\bOnline\b/);
  assert.match(html, /&#60;img/);
  assert.match(html, /All Mac projects/);
  assert.match(html, /Until revoked/);
  assert.match(html, /Last activity a minute ago/);
  assert.match(html, /data-revoke-device="abc"/);
  for (const status of ['revoked', 'expired']) {
    assert.doesNotMatch(render([{ ...base, status }]), /data-revoke-device/);
  }
  const scoped = render([{ ...base, device: false, allProjects: false, projects: ['parley'], status: 'authorized', lastSeenAt: null, expiresAt: 100 }]);
  assert.match(scoped, /Scoped connection/);
  assert.match(scoped, /parley/);
  assert.match(scoped, /Not used yet/);
  assert.match(scoped, /Expires Dec 10/);
  assert.equal(render([]), 'No connected devices');
});
