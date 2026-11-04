// Send a failed build to T3 Code (or Codex) in the project folder.
//   node lib/ask.mjs [id|project] [--codex] [--wait] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { t3Bin } from './commit.mjs';
import { diagnose } from './diagnose.mjs';
import { loadJobs, pickJob } from './wait.mjs';
import { readJob, writeJob, logOf } from './history.mjs';
import { spawn } from 'node:child_process';

export const titleOfAsk = (id) => `macbuild fix ${id}`;

export function pickAskJob(items, query) {
  const failed = items.filter((item) => item.status === 'failed');
  if (!query) return failed[0] ?? items[0] ?? null;
  for (const item of items) {
    const id = item.id || '';
    if (id === query || id.startsWith(query)) return item;
  }
  return failed.find((item) => item.project === query) ?? pickJob(items, query);
}

export function projectDirOf(name) {
  const file = process.env.MACBUILD_PROJECTS ?? join(process.env.HOME || homedir(), '.config/macbuild/projects.conf');
  if (!existsSync(file)) return '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('|') || line.startsWith('#')) continue;
    const [project, dir] = line.split('|');
    if (project === name) return dir;
  }
  return '';
}

function logTail(text, max = 8000) {
  const lines = String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim().split('\n');
  const slice = lines.slice(-120).join('\n');
  return slice.length > max ? slice.slice(-max) : slice;
}

export function promptForAsk({ build, dir, log = '' }) {
  const hint = build.hint ?? diagnose(log);
  const commit = build.commit?.short ? `${build.commit.short} ${build.commit.subject ?? ''}`.trim() : (build.ref || 'working copy');
  return `A macbuild ${build.platform ?? 'ios'} build failed. Work in this project folder.

Project: ${build.project}
Folder: ${dir}
Profile: ${build.profile ?? 'development'}
Source: ${build.source === 'working' ? 'working copy' : `GitHub ${build.ref ?? ''}`.trim()}
Commit: ${commit}
Log: ${build.id ? logOf(build.id) : '(none)'}
${hint ? `Likely cause: ${hint.title}. ${hint.fix}` : ''}
Reason: ${build.reason ?? 'build failed'}

Log:
${logTail(log) || '(empty)'}

Do this:
1. Stay in this folder. Do not switch to ~/.cache/macbuild unless you need to inspect that checkout.
2. If the log is thin, run \`npx expo config --json\` and the package manager install to see the real error.
3. Fix the cause so \`macbuild ${build.project}\` can build.
4. Do not commit secrets. Prefer a focused fix; ask before committing or pushing.
`;
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

async function ensureProject(bin, repo, name) {
  await t3Json(bin, ['project', 'add', '--title', name, repo], { timeout: 20000 });
}

function slimAsk(thread, provider) {
  return {
    threadId: thread.threadId, title: thread.title, link: thread.link,
    status: thread.status, provider: provider || '', at: Date.now(),
  };
}

export const ASK_CHOICES = [
  { provider: 'grok', model: 'grok-4.6', label: 'Grok 4.6' },
  { provider: 'grok', model: 'grok-4.7', label: 'Grok 4.7' },
  { provider: 'grok', model: 'grok-4.5', label: 'Grok 4.5' },
  { provider: 'codex', model: 'gpt-6.1-sol', label: 'Codex' },
];
export const MODELS = { grok: 'grok-4.6', codex: 'gpt-6.1-sol' };
const MODEL_FALLBACKS = { grok: ['grok-4.6', 'grok-4.7', 'grok-4.5'], codex: ['gpt-6.1-sol'] };
const MODEL_REJECT = /no default model|modelSelection|did not accept the model|unknown model|invalid model/i;

export function parseAskChoice(provider = '', model = '') {
  if (!provider && !model) return { provider: '', model: '' };
  const known = ASK_CHOICES.find((item) => item.provider === provider && item.model === model)
    || ASK_CHOICES.find((item) => item.model === model)
    || (provider === 'codex' ? ASK_CHOICES.find((item) => item.provider === 'codex') : null);
  if (known) return { provider: known.provider, model: known.model };
  if (provider === 'codex') return { provider: 'codex', model: model || MODELS.codex };
  if (provider === 'grok' || !provider) return { provider: 'grok', model: model || MODELS.grok };
  return { error: 'Unknown agent model.' };
}

export function askConfig() {
  const file = process.env.MACBUILD_CONFIG ?? join(process.env.HOME || homedir(), '.config/macbuild/ui.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return parseAskChoice(saved.askProvider, saved.askModel);
  } catch { return { provider: '', model: '' }; }
}

function startArgs({ title, dir, provider, model, wait }) {
  const args = ['thread', 'start', '--json', '--title', title];
  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);
  if (wait) args.push('--wait');
  args.push(dir, '-');
  return args;
}

function attemptsFor({ provider = '', model = '' }) {
  if (provider === 'codex') return [{ provider: 'codex', model: model || MODELS.codex }];
  if (provider && provider !== 'grok') return [{ provider, model: model || MODELS[provider] || '' }];
  const grok = [];
  for (const name of [model || MODELS.grok, ...MODEL_FALLBACKS.grok]) {
    if (name && !grok.some((item) => item.model === name)) grok.push({ provider: 'grok', model: name });
  }
  if (provider === 'grok') return grok;
  return [...grok, { provider: 'codex', model: MODELS.codex }];
}

export async function startAsk({ build, dir, provider = '', model = '', wait = false, open = true }) {
  const bin = t3Bin();
  if (!bin) return { error: 'T3 Code isn’t installed. Open T3 Code once, then retry.' };
  if (!dir) return { error: 'unknown project folder' };
  const log = build.id && existsSync(logOf(build.id)) ? readFileSync(logOf(build.id), 'utf8') : '';
  const title = titleOfAsk(build.id || build.project);
  const prompt = promptForAsk({ build: { ...build, hint: build.hint ?? diagnose(log) }, dir, log });
  if (provider && !model) model = MODELS[provider] || '';
  const attempts = attemptsFor({ provider, model });
  let raw = { error: 'T3 did not start a thread.' };
  let used = attempts[0];
  const timeout = wait ? 0 : 15000;
  for (const attempt of attempts) {
    used = attempt;
    const args = startArgs({ title, dir, wait, ...attempt });
    raw = await t3Json(bin, args, { input: prompt, timeout });
    if (raw.error && /project|not found|unknown/i.test(raw.error) && !MODEL_REJECT.test(raw.error)) {
      await ensureProject(bin, dir, build.project || basename(dir));
      raw = await t3Json(bin, args, { input: prompt, timeout });
    }
    if (raw.threadId && !MODEL_REJECT.test(raw.error || '')) break;
    if (!raw.error) break;
    if (!MODEL_REJECT.test(raw.error)) break;
  }
  const thread = asThread(raw, { t3: true, provider: used.provider });
  if (thread.error && !thread.threadId) return { error: thread.error };
  if (thread.threadId && !thread.link) {
    const shown = await t3Json(bin, ['thread', 'show', '--json', '--messages', '0', thread.threadId], { timeout: 8000 });
    const extra = asThread(shown.thread ?? shown, {});
    if (extra.link) thread.link = extra.link;
  }
  if (open && thread.threadId) await runT3(bin, ['app', dir], { timeout: 8000 });
  if (thread.threadId && build.id) {
    try { writeJob({ ...readJob(build.id), ask: slimAsk(thread, used.provider) }); } catch {}
  }
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

function parseCli(argv) {
  const flags = new Set();
  const rest = [];
  let model = '';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--codex') flags.add('codex');
    else if (arg === '--wait') flags.add('wait');
    else if (arg === '--json') flags.add('json');
    else if (arg === '--model') { model = argv[i + 1] || ''; i += 1; }
    else if (arg.startsWith('--')) flags.add(arg.slice(2));
    else rest.push(arg);
  }
  return { query: rest[0] || '', wait: flags.has('wait'), json: flags.has('json'), provider: flags.has('codex') ? 'codex' : '', model };
}

export async function askCli(argv = process.argv.slice(2)) {
  const opts = parseCli(argv);
  const items = loadJobs();
  const build = pickAskJob(items, opts.query);
  if (!build) return { error: opts.query ? `no build matching ${opts.query}` : 'no builds yet' };
  const dir = projectDirOf(build.project);
  if (!dir) return { error: `unknown project: ${build.project}` };
  const defaults = askConfig();
  const provider = opts.provider || defaults.provider || '';
  const model = opts.model || (opts.provider ? '' : defaults.model) || '';
  return startAsk({ build, dir, provider, model, wait: opts.wait, open: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Set(process.argv.slice(2).filter((arg) => arg.startsWith('--')));
  const result = await askCli(process.argv.slice(2));
  if (flags.has('--json')) console.log(JSON.stringify(result));
  else printHuman(result);
  if (result.error && !result.threadId) process.exitCode = 1;
}
