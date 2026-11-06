#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmodSync, createWriteStream, readFileSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import { issueToken, loadAccess, publicToken, revokeToken, privateJson } from '../lib/remote-access.mjs';
import { clientFile, loadRemotes, saveRemote, selectedRemote, RemoteClient, sourceState, pushSource } from '../lib/remote-client.mjs';

const HELP = `macbuild: local Mac builds, remote clients on Windows/Linux/macOS

Connect: macbuild remote add NAME https://your-mac.ts.net:8443 --token-stdin
         macbuild remote list | use NAME | remove NAME
On Mac:  macbuild server token create --name windows --projects parley --profiles development --scopes read,build
         macbuild server token list | revoke ID

Remote:  macbuild [build] PROJECT [--profile development] [--ref BRANCH] [--wait] [--json]
         macbuild update PROJECT --channel CHANNEL --message MESSAGE --environment ENV --ref BRANCH --confirm-release
         macbuild submit ID --confirm-release
         macbuild list | commits PROJECT [--ref BRANCH] | builds [PROJECT] | show [ID|PROJECT] | log [ID|PROJECT]
         macbuild wait [ID|PROJECT] [--timeout SECONDS] [--follow]
         macbuild cancel ID | download ID --output FILE | doctor | mcp
Dev:     macbuild dev [PROJECT] | dev stop PROJECT | dev log PROJECT [--follow] | dev key PROJECT r
         macbuild dev wait PROJECT | dev answer PROJECT yes   (the Mac's dev servers; see macbuild dev --help)
Source:  macbuild source [--ref BRANCH] | push --confirm-push
         Commit deliberately with git add <paths> && git commit, then push.

Global: --remote NAME selects a server; --local uses this Mac only.
Remote source is pinned and must be pushed. No implicit commit, push, or cloud build.
--allow-dirty requires an explicit --ref and excludes all local edits.
--request-id KEY makes retries idempotent. --no-wait queues without waiting (default).
`;
export function parseArgs(args) {
  const values = {}; const positionals = [];
  const booleans = new Set(['json', 'wait', 'no-wait', 'follow', 'allow-dirty', 'confirm-release', 'confirm-push', 'token-stdin', 'local', 'submit', 'android', 'help']);
  const strings = new Set(['remote', 'profile', 'ref', 'platform', 'channel', 'message', 'environment', 'timeout', 'tail', 'output', 'name', 'projects', 'profiles', 'scopes', 'required-checks', 'expires-days', 'request-id']);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) { positionals.push(item); continue; }
    const key = item.slice(2);
    if (booleans.has(key)) values[key] = true;
    else if (strings.has(key)) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${item} requires a value.`);
      values[key] = args[++index];
    } else throw new Error(`Unsupported option: ${item}`);
  }
  if (values.local && values.remote) throw new Error('Choose --local or --remote, not both.');
  for (const key of ['timeout', 'tail', 'expires-days']) if (values[key] !== undefined && (!Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) throw new Error(`Invalid --${key}.`);
  return { values, positionals };
}
const emit = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
export async function main(args = process.argv.slice(2)) {
  const explicitLocal = args.includes('--local');
  const reserved = ['remote', 'server', 'source', 'push', '--help'];
  const hasRemoteFlag = args.includes('--remote');
  if (!reserved.includes(args[0]) && !hasRemoteFlag && (explicitLocal || !selectedRemote())) {
    if (process.platform !== 'darwin') throw new Error('Local builds require macOS. Connect first: macbuild remote add NAME https://your-mac.ts.net:8443 --token-stdin');
    return await new Promise((resolveExit, reject) => {
      const child = spawn(fileURLToPath(new URL('./macbuild', import.meta.url)), args.filter((arg) => arg !== '--local'), { stdio: 'inherit', env: { ...process.env, MACBUILD_LOCAL: '1' } });
      child.on('error', reject);
      child.on('close', (code) => resolveExit(code ?? 1));
    });
  }
  // dev has its own options (lib/dev-cli.mjs): pass everything but --remote NAME through.
  const remoteAt = args.indexOf('--remote');
  const devArgs = args.filter((_, index) => remoteAt < 0 || (index !== remoteAt && index !== remoteAt + 1));
  if (devArgs[0] === 'dev') {
    const server = selectedRemote(remoteAt >= 0 ? args[remoteAt + 1] : undefined);
    if (!server) throw new Error('Connect a remote first. See macbuild --help.');
    const { devMain, remoteTransport } = await import('../lib/dev-cli.mjs');
    return devMain(devArgs.slice(1), remoteTransport(new RemoteClient(server)));
  }
  const { values, positionals } = parseArgs(args);
  let [command, target, extra] = positionals;
  if (values.help || command === '--help' || !command) { emit(HELP); return 0; }
  if (command === 'remote') {
    const config = loadRemotes();
    if (target === 'list') { emit(Object.entries(config.servers).map(([name, item]) => ({ name, url: item.url, default: config.default === name }))); return 0; }
    if (target === 'add') {
      if (!values['token-stdin'] || positionals.length !== 4) throw new Error('Usage: macbuild remote add NAME URL --token-stdin');
      saveRemote(extra, positionals[3], readFileSync(0, 'utf8').trim());
      emit(`Saved remote ${extra}. On Windows, restrict access to ${clientFile()} with your account ACL.`); return 0;
    }
    if (!config.servers[extra]) throw new Error('Unknown remote.');
    if (target === 'use') config.default = extra;
    else if (target === 'remove') { delete config.servers[extra]; if (config.default === extra) delete config.default; }
    else throw new Error('remote: add, list, use, remove');
    privateJson(clientFile(), config); emit(`${target}: ${extra}`); return 0;
  }
  if (command === 'server') {
    if (values.remote) throw new Error('Token administration is local to the Mac; do not select a remote.');
    if (process.platform !== 'darwin') throw new Error('Server administration runs on the Mac.');
    if (target !== 'token') throw new Error('Usage: macbuild server token create|list|revoke');
    if (extra === 'list') emit(loadAccess().tokens.map(publicToken));
    else if (extra === 'revoke') emit(revokeToken(positionals[3]));
    else if (extra === 'create') {
      const list = (key, fallback) => values[key] ? values[key].split(',').map((item) => item.trim()) : fallback;
      emit(issueToken({ name: values.name, projects: list('projects', []), profiles: list('profiles', ['development']), scopes: list('scopes', ['read', 'build']), requiredChecks: list('required-checks', []), expiresDays: Number(values['expires-days'] ?? 90) }));
    } else throw new Error('Usage: macbuild server token create|list|revoke');
    return 0;
  }
  if (command === 'source') { emit(await sourceState({ ref: values.ref, allowDirty: values['allow-dirty'] })); return 0; }
  if (command === 'push') {
    if (!values['confirm-push']) throw new Error('Push changes origin. Review commits, then use macbuild push --confirm-push.');
    emit(await pushSource()); return 0;
  }
  const server = selectedRemote(values.remote);
  if (!server) throw new Error('Connect a remote first. See macbuild --help.');
  const client = new RemoteClient(server);
  if (command === 'mcp') { const { serveRemoteMcp } = await import('../lib/remote-mcp.mjs'); serveRemoteMcp(client); return null; }
  if (command === 'list') { emit(await client.request('/projects')); return 0; }
  if (command === 'doctor') { emit(await client.request('/info')); return 0; }
  if (command === 'commits') {
    if (!target) throw new Error('commits requires a project name.');
    emit(await client.request(`/projects/${encodeURIComponent(target)}/commits?ref=${encodeURIComponent(values.ref || 'main')}`)); return 0;
  }
  if (command === 'builds') { const jobs = await client.request('/jobs'); emit(target ? jobs.filter((job) => job.project === target || job.id.startsWith(target)) : jobs); return 0; }
  if (['show', 'log', 'wait', 'cancel', 'download', 'submit'].includes(command)) {
    const job = await client.pick(target);
    const path = `/jobs/${encodeURIComponent(job.id)}`;
    if (command === 'show') emit(job);
    if (command === 'log') emit((await client.request(`${path}/log?tail=${Number(values.tail) || 80}`)).text);
    if (command === 'cancel') emit(await client.request(`${path}/cancel`, { method: 'POST', body: {}, key: values['request-id'] }));
    if (command === 'submit') {
      if (!values['confirm-release']) throw new Error('Store submission requires --confirm-release.');
      const state = await sourceState({ ref: job.commit?.hash, allowDirty: values['allow-dirty'] });
      const result = await client.request(`${path}/submit`, { method: 'POST', body: { confirmRelease: true, repository: state.repository }, key: values['request-id'] });
      emit(result);
      if (values.wait) { const done = await client.wait(result.id, { timeout: Number(values.timeout) || 0 }); emit(done.job); return done.code; }
    }
    if (command === 'download') {
      if (!values.output) throw new Error('download requires --output FILE. Existing files are never overwritten.');
      const response = await client.request(`${path}/artifact`, { raw: true });
      const file = resolve(values.output);
      const stream = createWriteStream(file, { flags: 'wx', mode: 0o600 });
      let created = false;
      stream.once('open', () => { created = true; });
      try { await pipeline(Readable.fromWeb(response.body), stream); }
      catch (error) { if (created) rmSync(file, { force: true }); throw error; }
      chmodSync(file, 0o600); emit({ downloaded: file, id: job.id });
    }
    if (command === 'wait') {
      const done = await client.wait(job.id, { timeout: Number(values.timeout) || 0, onLog: values.follow ? (text) => process.stderr.write(text) : undefined });
      emit(done.job); return done.code;
    }
    return 0;
  }
  if (['setup', 'add', 'scan', 'commit', 'ask'].includes(command)) throw new Error(`${command} is local administration. Use git to commit selected files on this machine; use --local for Mac administration.`);
  if (command === 'build') command = 'build';
  else if (command !== 'update' && command !== 'ota') { target = command; command = 'build'; }
  if (!target) throw new Error('A project name is required.');
  const update = command !== 'build';
  if ((update || values.submit) && !values['confirm-release']) throw new Error('Publishing requires --confirm-release.');
  const state = await sourceState({ ref: values.ref, allowDirty: values['allow-dirty'] });
  const body = { action: update ? 'update' : 'build', project: target, profile: values.profile || (update || values.submit ? 'production' : 'development'), platform: values.platform || (values.android ? 'android' : update ? 'all' : 'ios'), ref: state.ref, commit: state.commit, repository: state.repository,
    ...(update ? { channel: values.channel, message: values.message, environment: values.environment } : {}), submit: Boolean(values.submit), confirmRelease: Boolean(values['confirm-release']) };
  const job = await client.request('/jobs', { method: 'POST', body, key: values['request-id'] });
  emit(job);
  if (values.wait && !values['no-wait']) {
    const done = await client.wait(job.id, { timeout: Number(values.timeout) || 0, onLog: values.follow ? (text) => process.stderr.write(text) : undefined });
    emit(done.job); return done.code;
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().then((code) => { if (code !== null) process.exitCode = code; }).catch((error) => { console.error(`macbuild: ${error.message}`); process.exitCode = 1; });
}
