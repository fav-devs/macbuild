// Split a dirty working copy into focused git commits through the T3 CLI, then optionally push.
// T3 inspects the diffs so unrelated files are not dumped into one `git add .`.
//   node lib/commit.mjs status <dir>
//   node lib/commit.mjs start <dir> --name NAME [--push] [--wait] [--json]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ACTIVE = new Set(['preparing', 'queued', 'starting', 'running', 'waiting']);
export const titleOf = (name) => `macbuild commit ${name}`;

const LABEL = {
  '??': 'untracked', A: 'added', C: 'copied', D: 'deleted', M: 'modified', R: 'renamed', U: 'conflict', T: 'typechange',
};

export function parsePorcelain(text) {
  return String(text || '').split('\n').filter(Boolean).map((line) => {
    const code = line.slice(0, 2);
    let rest = line.slice(2);
    if (rest.startsWith(' ')) rest = rest.slice(1);
    if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1).replace(/\\"/g, '"');
    const path = rest.includes(' -> ') ? rest.slice(rest.lastIndexOf(' -> ') + 4) : rest;
    const letter = [...code].find((ch) => LABEL[ch]) || (code === '??' ? '??' : 'M');
    return { path, code, label: LABEL[letter] ?? 'modified' };
  }).filter((item) => item.path);
}

export function t3Bin() {
  if ('MACBUILD_T3' in process.env) {
    const file = process.env.MACBUILD_T3;
    return file && existsSync(file) ? file : '';
  }
  const home = join(homedir(), '.t3/bin/t3');
  if (existsSync(home)) return home;
  for (const dir of (process.env.PATH || '').split(':')) {
    if (!dir) continue;
    const file = join(dir, 't3');
    if (existsSync(file)) return file;
  }
  return '';
}

export function promptFor({ name, branch, changes, ahead = 0, push = true }) {
  const files = (changes ?? []).map((item) => `${item.code} ${item.path}`).join('\n') || '(clean)';
  return `Commit local git changes in this repository so a macbuild GitHub-branch build can include them.

Project: ${name}
Branch: ${branch || '(detached)'}
Unpushed commits: ${ahead}
Files:
${files}

Do this:
1. Inspect git status and the diffs. Split related files into focused commits. Do not dump unrelated work into one commit.
2. Follow this repository's commit message style.
3. Do not commit secrets, .env, credentials, or obvious local-only scratch.
4. Do not rewrite history, amend published commits, or force-push.
5. ${push ? 'After committing, push the current branch to origin (fast-forward).' : 'Commit only. Do not push.'}
6. Do not edit source files except as needed for those commits.
7. When finished, list each new commit hash and subject, and whether the push succeeded.
`;
}

function runGit(dir, args) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('close', (code) => resolve(code === 0 ? out.replace(/\n+$/, '') : ''));
  });
}

export async function inspectRepo(dir) {
  const repo = (await runGit(dir, ['rev-parse', '--show-toplevel'])) || dir;
  const branch = await runGit(repo, ['branch', '--show-current']);
  const changes = parsePorcelain(await runGit(repo, ['status', '--porcelain']));
  const ahead = branch ? Number(await runGit(repo, ['rev-list', '--count', `origin/${branch}..HEAD`])) || 0 : 0;
  const behind = branch ? Number(await runGit(repo, ['rev-list', '--count', `HEAD..origin/${branch}`])) || 0 : 0;
  return { repo, branch, changes, dirty: changes.length, ahead, behind };
}

function runT3(bin, args, { input = '', timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = timeout ? setTimeout(() => child.kill('SIGTERM'), timeout) : null;
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parseJson(text) {
  const start = text.indexOf('{') >= 0 && (text.indexOf('[') < 0 || text.indexOf('{') < text.indexOf('[')) ? text.indexOf('{') : text.indexOf('[');
  if (start < 0) return null;
  try { return JSON.parse(text.slice(start)); } catch { return null; }
}

function asThread(raw, extra = {}) {
  if (!raw) return extra;
  const thread = raw.thread ?? (raw.threadId ? raw : null);
  if (!thread) return { ...extra, error: extra.error ?? raw.error ?? 'T3 did not start a thread.' };
  return {
    threadId: thread.threadId, title: thread.title ?? extra.title, link: thread.link ?? '',
    status: thread.status ?? 'running', settled: Boolean(thread.settled),
    ...extra,
  };
}

async function t3Json(bin, args, opts) {
  const { code, stdout, stderr } = await runT3(bin, args, opts);
  const parsed = parseJson(stdout);
  if (parsed) return parsed;
  const err = (stderr || stdout).split('\n').map((line) => line.trim()).filter((line) => line && !/^\(node:/.test(line) && !/NO_COLOR/.test(line))[0];
  return { error: err || (code ? `t3 exited ${code}` : 'T3 returned no JSON.') };
}

const jobs = new Map();

async function listThreads(bin, repo) {
  const raw = await t3Json(bin, ['thread', 'list', '--json', '--project', repo], { timeout: 8000 });
  return Array.isArray(raw) ? raw : [];
}

async function findActive(bin, repo, name) {
  const title = titleOf(name);
  const threads = await listThreads(bin, repo).catch(() => []);
  return threads.find((item) => item.title === title && ACTIVE.has(item.status)) ?? null;
}

export function rememberedCommit(name) {
  return jobs.get(name) ?? null;
}

export async function currentCommit(dir, name) {
  const bin = t3Bin();
  const known = jobs.get(name);
  if (!bin) return { t3: false, ...known };
  if (!known?.threadId) return { t3: true, ...known };
  if (!ACTIVE.has(known.status)) return { t3: true, ...known };
  const raw = await t3Json(bin, ['thread', 'show', '--json', '--messages', '0', known.threadId], { timeout: 8000 });
  const next = asThread(raw.thread ?? raw, { t3: true });
  if (next.threadId) jobs.set(name, next);
  return jobs.get(name) ?? { t3: true };
}

async function ensureProject(bin, repo, name) {
  const added = await t3Json(bin, ['project', 'add', '--title', name, repo], { timeout: 20000 });
  return added;
}

export async function startCommit({ dir, name, push = true, wait = false }) {
  const bin = t3Bin();
  if (!bin) return { error: 'T3 Code isn’t installed. Open T3 Code once, then retry.' };
  const copy = await inspectRepo(dir);
  if (!copy.dirty && !(push && copy.ahead)) return { error: 'Nothing to commit.' };
  const live = asThread(await findActive(bin, copy.repo, name), { t3: true });
  if (live.threadId && ACTIVE.has(live.status)) {
    jobs.set(name, live);
    return live;
  }
  const prompt = promptFor({ name, branch: copy.branch, changes: copy.changes, ahead: copy.ahead, push });
  const args = ['thread', 'start', '--json', '--title', titleOf(name)];
  if (wait) args.push('--wait');
  args.push(copy.repo, '-');
  let raw = await t3Json(bin, args, { input: prompt, timeout: wait ? 0 : 30000 });
  if (raw.error && /project|not found|unknown/i.test(raw.error)) {
    await ensureProject(bin, copy.repo, name);
    raw = await t3Json(bin, args, { input: prompt, timeout: wait ? 0 : 30000 });
  }
  const thread = asThread(raw, { t3: true });
  if (thread.error && !thread.threadId) return { error: thread.error };
  if (thread.threadId) jobs.set(name, thread);
  return thread;
}

function printHuman(result) {
  if (result.error && !result.threadId) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  if (result.link) console.log(result.link);
  else if (result.threadId) console.log(result.threadId);
  if (result.status) console.log(result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const cmd = args.shift();
  const flags = new Set(args.filter((arg) => arg.startsWith('--')));
  const rest = args.filter((arg) => !arg.startsWith('--'));
  const json = flags.has('--json');
  const out = (value) => { if (json) console.log(JSON.stringify(value)); else printHuman(value); };
  if (cmd === 'status') {
    const copy = await inspectRepo(rest[0] || '.');
    console.log(JSON.stringify({ ...copy, t3: Boolean(t3Bin()) }));
  } else if (cmd === 'start') {
    const nameFlag = args.indexOf('--name');
    const name = nameFlag >= 0 ? args[nameFlag + 1] : rest[1];
    if (!rest[0] || !name) {
      console.error('usage: node lib/commit.mjs start <dir> --name NAME [--push] [--wait] [--json]');
      process.exit(2);
    }
    const result = await startCommit({ dir: rest[0], name, push: flags.has('--push'), wait: flags.has('--wait') });
    out(result);
    if (result.error && !result.threadId) process.exitCode = 1;
  } else {
    console.error('usage: node lib/commit.mjs status <dir> | start <dir> --name NAME [--push] [--wait]');
    process.exit(2);
  }
}
