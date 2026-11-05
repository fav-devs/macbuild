import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { authenticate, issueToken, loadAccess, publicToken, repositoryId, revokeToken } from '../lib/remote-access.mjs';
import { serverUrl, saveRemote, loadRemotes, selectedRemote, sourceState, pushSource } from '../lib/remote-client.mjs';
import { parseArgs } from '../bin/macbuild.mjs';
import { remoteTool, serveRemoteMcp } from '../lib/remote-mcp.mjs';
import { remoteApi } from '../lib/remote-api.mjs';

const folder = mkdtempSync(join(tmpdir(), 'macbuild-remote-'));
const file = join(folder, 'access.json');
process.env.MACBUILD_REMOTES = join(folder, 'remotes.json');
process.env.MACBUILD_REMOTE_ACCESS = file;
after(() => rmSync(folder, { recursive: true, force: true }));
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

test('remote tokens are scoped, hashed at rest, expiring, and immediately revocable', () => {
  const issued = issueToken({ name: 'windows', projects: ['parley'] }, file);
  const token = authenticate(`Bearer ${issued.token}`, file);
  assert.equal(token.name, 'windows');
  assert.deepEqual(token.profiles, ['development']);
  assert.deepEqual(token.scopes, ['read', 'build']);
  assert.equal('hash' in token, false);
  assert.equal(readFileSync(file, 'utf8').includes(issued.token), false);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(authenticate(`Bearer ${issued.token.slice(0, -1)}${issued.token.endsWith('0') ? '1' : '0'}`, file), null);
  assert.equal(authenticate('garbage', file), null);
  assert.equal('hash' in publicToken(loadAccess(file).tokens[0]), false);
  revokeToken(issued.id, file);
  assert.equal(authenticate(`Bearer ${issued.token}`, file), null);
  const expired = issueToken({ name: 'expires', projects: ['parley'] }, file);
  const config = loadAccess(file);
  config.tokens.find((item) => item.id === expired.id).expiresAt = 1;
  writeFileSync(file, JSON.stringify(config));
  assert.equal(authenticate(`Bearer ${expired.token}`, file), null);
  for (const options of [{ projects: ['*'] }, { profiles: [] }, { scopes: ['shell'] }, { expiresDays: 0 }, { requiredChecks: [42] }]) assert.throws(() => issueToken({ name: 'bad', projects: ['parley'], ...options }, file));
});

test('remote connections require HTTPS, keep tokens out of listing, and never expose URL credentials', () => {
  assert.equal(serverUrl('https://mac.example.ts.net:8443'), 'https://mac.example.ts.net:8443');
  assert.equal(serverUrl('http://127.0.0.1:4180'), 'http://127.0.0.1:4180');
  for (const url of ['http://mac.example.com', 'https://user:pass@mac.example.com', 'https://mac.example.com/path', 'https://mac.example.com?token=secret']) assert.throws(() => serverUrl(url));
  const issued = issueToken({ name: 'client', projects: ['parley'] }, file);
  saveRemote('mac', 'https://mac.example.ts.net:8443', issued.token);
  assert.equal(selectedRemote('mac').token, issued.token);
  assert.equal(loadRemotes().default, 'mac');
  if (process.platform !== 'win32') assert.equal(statSync(process.env.MACBUILD_REMOTES).mode & 0o777, 0o600);
  assert.equal(repositoryId('git@github.com:fav-devs/parley.git'), repositoryId('https://github.com/fav-devs/parley.git'));
  assert.throws(() => repositoryId('/Users/me/local.git'));
  const list = execFileSync(process.execPath, [join(ROOT, 'bin/macbuild.mjs'), 'remote', 'list'], { env: process.env, encoding: 'utf8' });
  assert.equal(list.includes(issued.token), false);
});

test('source gates reject dirty files, unpushed commits, stale HEAD, and repository ambiguity', async () => {
  const repo = join(folder, 'app'); const origin = join(folder, 'origin.git');
  mkdirSync(repo);
  git(folder, 'init', '-q', '--bare', origin);
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'app.js'), 'first');
  git(repo, 'add', 'app.js'); git(repo, 'commit', '-qm', 'first');
  git(repo, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
  git(repo, 'config', `url.${origin}.insteadOf`, 'https://github.com/acme/app.git');
  git(repo, 'push', '-q', 'origin', 'main');
  const first = await sourceState({ cwd: repo });
  assert.equal(first.repository, 'github.com/acme/app');
  assert.equal(first.commit, git(repo, 'rev-parse', 'HEAD'));
  writeFileSync(join(repo, 'app.js'), 'second');
  await assert.rejects(sourceState({ cwd: repo }), /Uncommitted/);
  await assert.rejects(sourceState({ cwd: repo, allowDirty: true }), /Uncommitted/);
  assert.equal((await sourceState({ cwd: repo, ref: 'main', allowDirty: true })).commit, first.commit);
  await assert.rejects(pushSource(repo), /Commit your selected/);
  git(repo, 'add', 'app.js'); git(repo, 'commit', '-qm', 'second');
  await assert.rejects(sourceState({ cwd: repo }), /differs from origin/);
  await assert.rejects(sourceState({ cwd: repo, ref: git(repo, 'rev-parse', 'HEAD') }), /not pushed/);
  assert.equal((await sourceState({ cwd: repo, ref: 'main' })).commit, first.commit);
  const pushed = await pushSource(repo);
  assert.equal((await sourceState({ cwd: repo })).commit, pushed.commit);
  await assert.rejects(sourceState({ cwd: repo, ref: '--help' }), /Choose a pushed/);
});

test('remote CLI rejects unsupported flags rather than pretending they worked', () => {
  assert.throws(() => parseArgs(['app', '--install']), /Unsupported/);
  assert.throws(() => parseArgs(['app', '--profile']), /requires a value/);
  assert.throws(() => parseArgs(['--local', '--remote', 'mac']), /not both/);
  assert.throws(() => parseArgs(['wait', '--timeout', 'NaN']), /Invalid/);
});

test('npm bin entry runs through a Unix symlink', { skip: process.platform === 'win32' }, () => {
  const link = join(folder, 'macbuild');
  symlinkSync(join(ROOT, 'bin/macbuild.mjs'), link);
  const output = execFileSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
  assert.match(output, /Connect: macbuild remote add/);
});

test('remote MCP validates arguments and requires explicit release confirmation', async () => {
  const client = { request: async () => [], pick: async () => ({ id: 'job' }) };
  await assert.rejects(remoteTool(client, 'update', { project: 'app', ref: 'main', channel: 'production', message: 'fix', confirmRelease: false }), /confirmation/);
  await assert.rejects(remoteTool(client, 'submit', { query: 'job', confirmRelease: false }), /confirmation/);
  await assert.rejects(remoteTool(client, 'build', { project: 'app', platform: 'all' }), /ios or android/);
  await assert.rejects(remoteTool(client, 'builds', { shell: 'rm' }), /Invalid/);
  await assert.rejects(remoteTool(client, 'wait', { timeout: -1 }), /Invalid/);
});

test('server CI gate accepts only the latest successful checks for the pinned SHA', async () => {
  const commit = 'a'.repeat(40);
  const issued = issueToken({ name: 'ci', projects: ['app'], requiredChecks: ['tests', 'lint'] }, file);
  let checks = [{ id: 1, name: 'tests', head_sha: commit, status: 'completed', conclusion: 'success' }];
  let statuses = [{ id: 1, context: 'lint', state: 'success' }];
  let unreadable = false;
  const handler = remoteApi({
    projects: () => [{ name: 'app', dir: '/app' }], profiles: () => [{ name: 'development' }],
    git: async (cwd, command) => command === 'config' ? 'https://github.com/acme/app.git' : command === 'rev-parse' ? commit : 'refs/remotes/origin/main',
    run: async (command, args) => { if (unreadable) throw new Error('offline'); return { stdout: command === 'git' ? '' : JSON.stringify(args.at(-1).includes('check-runs') ? [{ check_runs: checks }] : [statuses]) }; },
    json: (res, code, body) => { res.statusCode = code; res.body = body; },
  });
  const preflight = async () => {
    const request = new PassThrough();
    request.method = 'POST'; request.headers = { authorization: `Bearer ${issued.token}` };
    request.end(JSON.stringify({ project: 'app', profile: 'development', ref: 'main', commit, repository: 'github.com/acme/app' }));
    const response = {};
    await handler(request, response, new URL('http://local/api/remote/v1/preflight'));
    return response;
  };
  assert.equal((await preflight()).statusCode, 200);
  checks.push({ id: 2, name: 'tests', head_sha: commit, status: 'in_progress', conclusion: null });
  assert.equal((await preflight()).statusCode, 409);
  checks = [{ id: 3, name: 'tests', head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success' }];
  assert.equal((await preflight()).statusCode, 409);
  checks = [{ id: 4, name: 'tests', head_sha: commit, status: 'completed', conclusion: 'success' }];
  statuses.push({ id: 2, context: 'lint', state: 'pending' });
  assert.equal((await preflight()).statusCode, 409);
  statuses = [{ id: 3, context: 'lint', state: 'success' }];
  unreadable = true;
  assert.equal((await preflight()).statusCode, 409);
});

test('remote MCP uses newline-delimited JSON and a wait does not block other tools', async () => {
  const input = new PassThrough(); const output = new PassThrough();
  let text = ''; output.on('data', (chunk) => { text += chunk; });
  let finishWait;
  const client = { pick: async () => ({ id: 'job' }), request: async () => [], wait: () => new Promise((resolve) => { finishWait = resolve; }) };
  serveRemoteMcp(client, input, output);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'wait', arguments: {} } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' })}\n`);
  await new Promise((resolve) => setImmediate(resolve));
  const replies = text.trim().split('\n').map(JSON.parse);
  assert.ok(replies.some((reply) => reply.id === 1 && reply.result.protocolVersion === '2025-06-18'));
  assert.ok(replies.some((reply) => reply.id === 3 && reply.result.tools.some((item) => item.name === 'build')));
  assert.equal(replies.some((reply) => reply.id === 2), false);
  finishWait({ code: 0, job: { id: 'job', status: 'success' } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(text.trim().split('\n').map(JSON.parse).some((reply) => reply.id === 2));
  input.end();
});
