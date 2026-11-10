import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitCode, loadJobs, parseArgs, pickJob, summarize, waitFor } from '../lib/wait.mjs';
import { handle as mcpHandle, TOOLS } from '../lib/mcp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACBUILD = join(ROOT, 'bin/macbuild');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'macbuild-wait-'));
  const write = (id, meta, log = '') => {
    const folder = join(dir, id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'meta.json'), JSON.stringify({
      id, project: 'myapp', profile: 'development', platform: 'ios', ...meta,
    }));
    if (log !== null) writeFileSync(join(folder, 'build.log'), log);
  };
  return { dir, write };
}

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (chunk, ...rest) => {
    chunks.push(String(chunk));
    return orig.call(process.stdout, chunk, ...rest);
  };
  return Promise.resolve().then(fn).finally(() => { process.stdout.write = orig; }).then((value) => ({ value, stdout: chunks.join('') }));
}

describe('wait', { concurrency: 1 }, () => {
  test('pickJob matches id prefix then project, else latest', () => {
    const items = [
      { id: '20260102020202-other', project: 'other', createdAt: 2 },
      { id: '20260101010101-myapp', project: 'myapp', createdAt: 1 },
    ];
    assert.equal(pickJob(items, '').id, '20260102020202-other');
    assert.equal(pickJob(items, '20260101010101').id, '20260101010101-myapp');
    assert.equal(pickJob(items, 'myapp').id, '20260101010101-myapp');
    assert.equal(pickJob(items, 'nope'), null);
  });

  test('summarize diagnoses a failed log and skips success logs', () => {
    const { dir, write } = fixture();
    write('fail-job', { status: 'failed' }, 'You are not logged in to EAS.\n');
    write('ok-job', { status: 'success', createdAt: 2 }, 'You are not logged in to EAS.\nBuild successful\n');
    const jobs = loadJobs(dir);
    const failed = summarize(jobs.find((item) => item.id === 'fail-job'));
    assert.equal(failed.hint.title, 'eas-cli isn’t signed in on this Mac');
    const ok = summarize(jobs.find((item) => item.id === 'ok-job'));
    assert.equal(ok.hint, null);
    assert.equal(exitCode('success'), 0);
    assert.equal(exitCode('skipped'), 0);
    assert.equal(exitCode('failed'), 1);
    assert.equal(exitCode('cancelled'), 1);
    assert.equal(exitCode('running'), 2);
  });

  test('waitFor returns a finished job without writing stdout', async () => {
    const { dir, write } = fixture();
    write('20260101010101-myapp', { status: 'success', createdAt: 1 }, 'Build successful\n');
    const { value, stdout } = await captureStdout(() => waitFor({ data: dir, silent: true, poll: 20, appear: 200 }));
    assert.equal(value.code, 0);
    assert.equal(value.summary.status, 'success');
    assert.equal(value.summary.id, '20260101010101-myapp');
    assert.equal(stdout, '');
  });

  test('waitFor failed job exits 1 with a hint', async () => {
    const { dir, write } = fixture();
    write('fail-job', { status: 'failed', reason: 'signing' }, 'You are not logged in to EAS.\n');
    const { code, summary } = await waitFor({ data: dir, query: 'fail-job', silent: true, poll: 20 });
    assert.equal(code, 1);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.hint.title, 'eas-cli isn’t signed in on this Mac');
  });

  test('waitFor returns when a running job succeeds', async () => {
    const { dir, write } = fixture();
    write('live-job', { status: 'running', createdAt: 1 }, '[INSTALL_PODS] installing\n');
    setTimeout(() => write('live-job', { status: 'success', createdAt: 1 }, '[INSTALL_PODS] installing\nBuild successful\n'), 60);
    const events = [];
    const { code, summary } = await waitFor({
      data: dir, query: 'live-job', silent: true, follow: true, json: true, poll: 20, appear: 500,
      onEvent: (event) => events.push(event.event),
    });
    assert.equal(code, 0);
    assert.equal(summary.status, 'success');
    assert.ok(events.includes('status'));
    assert.ok(events.includes('phase'));
    assert.ok(events.includes('done'));
  });

  test('waitFor times out and reports a missing job', async () => {
    const { dir, write } = fixture();
    write('live-job', { status: 'running', createdAt: 1 });
    const timed = await waitFor({ data: dir, query: 'live-job', silent: true, timeout: 0.15, poll: 20, appear: 50 });
    assert.equal(timed.code, 124);
    assert.equal(timed.summary.status, 'running');
    assert.equal(timed.summary.error, 'timed out');
    const missing = await waitFor({ data: dir, query: 'nope', silent: true, timeout: 0.15, poll: 20, appear: 50 });
    assert.equal(missing.code, 2);
    assert.match(missing.summary.error, /no build matching nope/);
  });

  test('parseArgs reads flags', () => {
    assert.deepEqual(parseArgs(['myapp', '--json', '--follow', '--timeout', '12']), {
      query: 'myapp', json: true, follow: true, timeout: 12,
    });
    assert.throws(() => parseArgs(['--timeout', 'nope']), /--timeout/);
    assert.throws(() => parseArgs(['--wat']), /unknown option/);
  });

  test('macbuild wait --json exits with the job status', () => {
    const home = mkdtempSync(join(tmpdir(), 'macbuild-wait-cli-'));
    const data = join(home, '.local/share/macbuild/builds');
    const id = '20260101010101-myapp';
    mkdirSync(join(data, id), { recursive: true });
    writeFileSync(join(data, id, 'meta.json'), JSON.stringify({
      id, project: 'myapp', profile: 'development', status: 'success', createdAt: 1,
    }));
    writeFileSync(join(data, id, 'build.log'), 'Build successful\n');
    const env = { ...process.env, HOME: home };
    for (const name of Object.keys(env)) if (name.startsWith('MACBUILD_')) delete env[name];
    const ok = spawnSync(MACBUILD, ['wait', '--json'], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.equal(JSON.parse(ok.stdout).status, 'success');
    mkdirSync(join(data, '20260102020202-myapp'), { recursive: true });
    writeFileSync(join(data, '20260102020202-myapp', 'meta.json'), JSON.stringify({
      id: '20260102020202-myapp', project: 'myapp', profile: 'development', status: 'failed', createdAt: 2,
    }));
    const failed = spawnSync(MACBUILD, ['wait', '--json', '20260102020202'], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal(JSON.parse(failed.stdout).status, 'failed');
  });

  test('mcp wait does not write JSON-RPC-breaking stdout', async () => {
    const { dir, write } = fixture();
    write('mcp-job', { status: 'success', createdAt: 1 }, 'Build successful\n');
    const prev = process.env.MACBUILD_DATA;
    process.env.MACBUILD_DATA = dir;
    try {
      const listed = mcpHandle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      assert.deepEqual(listed.result.tools.map((tool) => tool.name), TOOLS.map((tool) => tool.name));
      const { value, stdout } = await captureStdout(() => mcpHandle({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'wait', arguments: { query: 'mcp-job', timeout: 1 } },
      }));
      assert.equal(stdout, '');
      assert.equal(value.result.isError, undefined);
      assert.match(value.result.content[0].text, /"status": "success"/);
      const show = await mcpHandle({
        jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'show', arguments: { query: 'mcp-job' } },
      });
      assert.match(show.result.content[0].text, /mcp-job/);
    } finally {
      if (prev === undefined) delete process.env.MACBUILD_DATA;
      else process.env.MACBUILD_DATA = prev;
    }
  });

  test('macbuild mcp answers tools/list over stdio', async () => {
    // This tests the local MCP protocol even when the developer has a saved Mac connection.
    const child = spawn(MACBUILD, ['mcp'], { env: { ...process.env, MACBUILD_LOCAL: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    const stdout = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error('mcp timed out')); }, 5000);
      let buf = '';
      child.stdout.on('data', (chunk) => {
        buf += chunk;
        if (buf.includes('"tools"')) {
          clearTimeout(timer);
          child.stdin.end();
          resolve(buf);
        }
      });
      child.on('error', reject);
    });
    assert.match(stdout, /Content-Length:/);
    assert.match(stdout, /"name":"wait"/);
    await new Promise((resolve) => child.on('close', resolve));
  });
});
