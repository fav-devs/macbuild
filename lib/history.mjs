// Record a CLI build in the dashboard history so the web UI can show it.
// The web UI already writes these folders; this is for `macbuild <name>` when MACBUILD_LOG is unset.
//   node lib/history.mjs start --project NAME --profile P --platform ios --dir DIR [--ref REF] [--action build] [--pid N]
//   node lib/history.mjs patch ID --artifact app.ipa --simulator 0
//   node lib/history.mjs finish ID --status success [--artifact PATH]
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { diagnose } from './diagnose.mjs';
import { dataDir } from './wait.mjs';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);

export function dirOf(id, data = dataDir()) {
  return join(data, id);
}
export function metaOf(id, data = dataDir()) {
  return join(dirOf(id, data), 'meta.json');
}
export function logOf(id, data = dataDir()) {
  return join(dirOf(id, data), 'build.log');
}

function git(dir, ...args) {
  if (!dir) return '';
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 8000 });
  return result.status === 0 ? (result.stdout || '').trim() : '';
}

function slug(name) {
  return String(name || 'app').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function newId(project, data) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const base = `${stamp}-${slug(project)}`;
  if (!existsSync(metaOf(base, data))) return base;
  let n = 1;
  while (existsSync(metaOf(`${base}-${n}`, data))) n += 1;
  return `${base}-${n}`;
}

function publicOf(build) {
  const copy = { ...build };
  delete copy._dir;
  return copy;
}

export function readJob(id, data = dataDir()) {
  return JSON.parse(readFileSync(metaOf(id, data), 'utf8'));
}

export function writeJob(build, data = dataDir()) {
  mkdirSync(dirOf(build.id, data), { recursive: true });
  const dest = metaOf(build.id, data);
  writeFileSync(`${dest}.tmp`, JSON.stringify(publicOf(build)));
  renameSync(`${dest}.tmp`, dest);
  return build;
}

export function start(opts = {}) {
  const data = opts.data ?? dataDir();
  const project = opts.project;
  if (!project) throw new Error('start needs --project');
  const dir = opts.dir || '';
  const ref = opts.ref || '';
  const platform = opts.platform === 'android' ? 'android' : 'ios';
  const repo = dir ? git(dir, 'rev-parse', '--show-toplevel') : '';
  const hash = ref
    ? (git(repo || dir, 'rev-parse', '--verify', '-q', `origin/${ref}^{commit}`) || git(repo || dir, 'rev-parse', '--verify', '-q', `${ref}^{commit}`))
    : git(dir, 'rev-parse', 'HEAD');
  const short = hash ? git(dir, 'rev-parse', '--short', hash) : '';
  const subject = hash ? git(dir, 'log', '-1', '--format=%s', hash) : '';
  const author = hash ? git(dir, 'log', '-1', '--format=%an', hash) : '';
  const date = hash ? Number(git(dir, 'log', '-1', '--format=%ct', hash)) * 1000 : 0;
  const branch = ref || git(dir, 'branch', '--show-current');
  const dirty = ref ? 0 : (git(dir, 'status', '--porcelain') || '').split('\n').filter(Boolean).length;
  const id = newId(project, data);
  const now = Date.now();
  const build = writeJob({
    id, project, platform, action: opts.action === 'submit' ? 'submit' : 'build',
    profile: opts.profile || 'development', artifact: 'app.ipa', simulator: false,
    source: ref ? 'github' : 'working', ref: branch || null,
    commit: hash ? { hash, short, subject, author, date } : null,
    trigger: 'cli', pid: opts.pid ? Number(opts.pid) : null,
    status: 'running', createdAt: now, startedAt: now, dirty,
  }, data);
  writeFileSync(logOf(id, data), '');
  return { id, log: logOf(id, data), dir: dirOf(id, data), build };
}

export function patch(id, fields = {}, data = dataDir()) {
  const build = { ...readJob(id, data), ...fields };
  if (fields.simulator !== undefined) build.simulator = Boolean(Number(fields.simulator) || fields.simulator === true || fields.simulator === 'true');
  if (fields.pid !== undefined) build.pid = Number(fields.pid) || build.pid;
  return writeJob(build, data);
}

function failureLine(text) {
  const lines = String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/)
    .map((line) => line.split('\r').filter((part) => part.trim()).pop() ?? '')
    .map((line) => line.trimEnd()).filter(Boolean);
  return lines.filter((line) => /❌|error:|Error:|failed|FAILURE|non-zero code/i.test(line) && !/build command failed/.test(line)).slice(-1)[0]?.trim() ?? '';
}

export function finish(id, { status, artifact, data = dataDir() } = {}) {
  const build = readJob(id, data);
  const incoming = status || 'failed';
  const alreadyDone = !ACTIVE.has(build.status) && build.finishedAt;
  // The dashboard may mark a quiet xcodebuild as "The CLI build stopped" while eas is still running.
  const falseStop = build.status === 'failed' && build.reason === 'The CLI build stopped';
  if (alreadyDone && !(falseStop && (incoming === 'success' || incoming === 'skipped'))) return build;
  const logPath = logOf(id, data);
  const text = existsSync(logPath) ? readFileSync(logPath, 'latin1') : '';
  build.status = incoming;
  build.finishedAt = Date.now();
  build.fingerprint = text.match(/^macbuild: fingerprint (\S+)/m)?.[1];
  if (build.status === 'failed' || build.status === 'cancelled') {
    build.reason = failureLine(text) || build.reason || null;
    build.hint = diagnose(text);
  } else {
    delete build.reason;
    delete build.hint;
  }
  if (artifact && existsSync(artifact)) {
    const dest = join(dirOf(id, data), build.artifact ?? 'app.ipa');
    if (resolve(artifact) !== resolve(dest)) copyFileSync(artifact, dest);
    if (existsSync(dest)) build.ipaBytes = statSync(dest).size;
  }
  const reused = text.match(/^macbuild: unchanged since (.+)$/m)?.[1]?.trim();
  if (reused) build.reusedFrom = reused;
  return writeJob(build, data);
}

function flags(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (!opts.id) opts.id = arg;
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '1';
    opts[key] = value;
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [cmd, ...rest] = process.argv.slice(2);
    const opts = flags(rest);
    if (cmd === 'start') {
      const result = start(opts);
      process.stdout.write(`id=${result.id}\nlog=${result.log}\n`);
    } else if (cmd === 'patch') {
      if (!opts.id) throw new Error('patch needs an id');
      const { id, ...fields } = opts;
      patch(id, fields);
    } else if (cmd === 'finish') {
      if (!opts.id) throw new Error('finish needs an id');
      finish(opts.id, opts);
    } else {
      throw new Error('usage: history start|patch|finish');
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
