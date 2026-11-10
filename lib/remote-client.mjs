import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { privateJson, repositoryId } from './remote-access.mjs';

const run = promisify(execFile);
export const clientFile = () => process.env.MACBUILD_REMOTES ?? join(homedir(), '.config/macbuild/remotes.json');
export const loadRemotes = () => existsSync(clientFile()) ? JSON.parse(readFileSync(clientFile(), 'utf8')) : { version: 1, servers: {} };
export function serverUrl(raw) {
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Server URL must contain only scheme, host, and optional port.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('Remote servers require HTTPS. HTTP is only allowed on loopback for testing.');
  return url.origin;
}
export function saveRemote(name, url, token) {
  if (!/^[\w-]{1,60}$/.test(name)) throw new Error('Remote name must contain letters, numbers, underscores, or hyphens.');
  if (!/^mb_[a-f0-9]{20}_[a-f0-9]{64}$/.test(token)) throw new Error('Invalid remote token.');
  const config = loadRemotes();
  config.servers[name] = { url: serverUrl(url), token };
  config.default ??= name;
  privateJson(clientFile(), config);
}
export function folderLink(cwd = process.cwd()) {
  const links = loadRemotes().links ?? {};
  let folder = realpathSync(cwd);
  for (;;) {
    if (links[folder]) return { folder, ...links[folder] };
    const parent = dirname(folder);
    if (parent === folder) return null;
    folder = parent;
  }
}
export async function linkFolder(project, remote, cwd = process.cwd()) {
  const folder = realpathSync(resolve(cwd));
  if (!statSync(folder).isDirectory()) throw new Error('Choose a local project folder.');
  const config = loadRemotes();
  const name = remote || config.default;
  if (!name || !config.servers[name]) throw new Error('Connect this device to a Mac first.');
  const server = selectedRemote(name);
  const projects = await new RemoteClient(server).request('/projects');
  const chosen = projects.find((item) => item.name === project);
  if (!chosen) throw new Error('The Mac does not allow this project. Run macbuild list.');
  const origin = repositoryId(await git(folder, 'config', '--get', 'remote.origin.url'));
  if (!chosen.repository) throw new Error('The Mac must support folder links and the project must have a repository origin.');
  if (chosen.repository !== origin) throw new Error('Local folder and Mac project repository origins do not match.');
  config.links ??= {};
  config.links[folder] = { remote: name, project };
  privateJson(clientFile(), config);
  return { folder, remote: name, project };
}
export function unlinkFolder(cwd = process.cwd()) {
  const folder = realpathSync(resolve(cwd));
  const config = loadRemotes();
  delete config.links?.[folder];
  privateJson(clientFile(), config);
  return { folder, unlinked: true };
}
export function selectedRemote(name) {
  if (!name && process.env.MACBUILD_SERVER_URL) {
    if (!process.env.MACBUILD_TOKEN) throw new Error('MACBUILD_TOKEN is required with MACBUILD_SERVER_URL.');
    return { url: serverUrl(process.env.MACBUILD_SERVER_URL), token: process.env.MACBUILD_TOKEN };
  }
  const config = loadRemotes();
  const chosen = name || folderLink()?.remote || config.default;
  if (!chosen) return null;
  if (!config.servers[chosen]) throw new Error(`Unknown remote: ${chosen}`);
  return { ...config.servers[chosen], url: serverUrl(config.servers[chosen].url) };
}
export class RemoteClient {
  constructor(server) { this.server = server; }
  async request(path, { method = 'GET', body, key, raw = false } = {}) {
    const requestId = body ? key ?? randomUUID() : undefined;
    let response;
    try {
      response = await fetch(`${this.server.url}/api/remote/v1${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { authorization: `Bearer ${this.server.token}`, ...(body ? { 'content-type': 'application/json', 'idempotency-key': requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error(`Cannot reach the Mac. No local fallback.${requestId ? ` The request may have been accepted; retry with --request-id ${requestId} and identical arguments.` : ''}`);
    }
    if (raw && response.ok) return response;
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`Invalid response from the Mac (HTTP ${response.status}).${requestId ? ` Retry identical arguments with --request-id ${requestId}.` : ''}`); }
    if (!response.ok) throw Object.assign(new Error(result.error ?? `HTTP ${response.status}`), { status: response.status });
    return requestId && !Array.isArray(result) ? { ...result, requestId } : result;
  }
  async pick(query) {
    const jobs = await this.request('/jobs');
    const job = !query ? jobs[0] : jobs.find((item) => item.id === query) || jobs.find((item) => item.id.startsWith(query)) || jobs.find((item) => item.project === query);
    if (!job) throw new Error(`No remote job matching ${query || 'latest'}.`);
    return job;
  }
  async wait(id, { timeout = 0, signal, onLog } = {}) {
    const start = Date.now();
    let lastLog = '';
    for (;;) {
      signal?.throwIfAborted();
      const job = await this.request(`/jobs/${encodeURIComponent(id)}`);
      if (onLog) {
        const { text } = await this.request(`/jobs/${encodeURIComponent(id)}/log?tail=2000`);
        if (text !== lastLog) { onLog(text.startsWith(lastLog) ? text.slice(lastLog.length) : text); lastLog = text; }
      }
      if (!['queued', 'running', 'cancelling'].includes(job.status)) return { code: ['success', 'skipped'].includes(job.status) ? 0 : 1, job };
      if (timeout && Date.now() - start >= timeout * 1000) return { code: 124, job };
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
async function git(cwd, ...args) {
  return (await run('git', ['-C', cwd, ...args], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}
export async function sourceState({ cwd = process.cwd(), ref, allowDirty = false } = {}) {
  const dirty = await git(cwd, 'status', '--porcelain');
  const branch = await git(cwd, 'branch', '--show-current');
  const head = await git(cwd, 'rev-parse', 'HEAD');
  const repository = repositoryId(await git(cwd, 'config', '--get', 'remote.origin.url'));
  const chosen = ref || branch;
  if (!chosen || !/^[\w./-]{1,200}$/.test(chosen) || chosen.startsWith('-') || chosen.includes('..')) throw new Error('Choose a pushed --ref (required for detached HEAD).');
  if (dirty && !(allowDirty && ref)) throw new Error('Uncommitted files found. Commit and push intentionally, or use --ref BRANCH --allow-dirty to build only that pushed source. Nothing was sent.');
  await git(cwd, 'fetch', '-q', '--prune', 'origin');
  let commit;
  try { commit = await git(cwd, 'rev-parse', '--verify', `origin/${chosen}^{commit}`); }
  catch { commit = await git(cwd, 'rev-parse', '--verify', `${chosen}^{commit}`); }
  if (!/^[a-f0-9]{40}$/.test(commit) || !(await git(cwd, 'for-each-ref', `--contains=${commit}`, '--format=%(refname)', 'refs/remotes/origin'))) throw new Error('Source commit is not pushed to origin. Run git push explicitly, then retry.');
  if (!ref && head !== commit) throw new Error('Local HEAD differs from origin. Push your commits or explicitly choose --ref to build the pushed version.');
  return { ref: chosen, commit, repository, branch, head, dirty: dirty ? dirty.split('\n').length : 0 };
}
export async function pushSource(cwd = process.cwd()) {
  if (await git(cwd, 'status', '--porcelain')) throw new Error('Commit your selected changes before pushing. macbuild never stages files automatically.');
  const branch = await git(cwd, 'branch', '--show-current');
  if (!branch || branch.startsWith('-')) throw new Error('Cannot push detached HEAD.');
  await git(cwd, 'push', 'origin', `HEAD:refs/heads/${branch}`);
  return { pushed: true, branch, commit: await git(cwd, 'rev-parse', 'HEAD') };
}
