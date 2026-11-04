// Wait until a dashboard job finishes. Agents run this instead of polling `macbuild show`.
//   node lib/wait.mjs [id|project] [--json] [--follow] [--timeout SEC]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnose } from './diagnose.mjs';

const ACTIVE = new Set(['queued', 'running', 'cancelling']);
const EXIT = { success: 0, skipped: 0, failed: 1, cancelled: 1 };

export function dataDir() {
  return process.env.MACBUILD_DATA ?? join(homedir(), '.local/share/macbuild/builds');
}

export function loadJobs(data = dataDir()) {
  if (!existsSync(data)) return [];
  const items = [];
  for (const name of readdirSync(data)) {
    const path = join(data, name, 'meta.json');
    if (!existsSync(path)) continue;
    try {
      const meta = JSON.parse(readFileSync(path, 'utf8'));
      meta._dir = join(data, name);
      items.push(meta);
    } catch {}
  }
  return items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function pickJob(items, query) {
  if (!query) return items[0] ?? null;
  for (const item of items) {
    const id = item.id || '';
    if (id === query || id.startsWith(query)) return item;
  }
  return items.find((item) => item.project === query) ?? null;
}

export function summarize(item) {
  const dir = item._dir ?? join(dataDir(), item.id);
  const logPath = join(dir, 'build.log');
  const hasLog = existsSync(logPath);
  let hint = item.hint ?? null;
  if (!hint && hasLog && (item.status === 'failed' || item.status === 'cancelled')) {
    hint = diagnose(readFileSync(logPath, 'latin1'));
  }
  return {
    id: item.id,
    status: item.status,
    project: item.project,
    profile: item.profile,
    platform: item.platform ?? 'ios',
    reason: item.reason || null,
    hint: hint ?? null,
    installed: item.installed ?? null,
    log: hasLog ? logPath : null,
  };
}

export function exitCode(status) {
  return EXIT[status] ?? 2;
}

function printHuman(summary, write) {
  if (summary.error && !summary.id) {
    write(`${summary.error}\n`);
    return;
  }
  const reason = (summary.reason || summary.error || '').replace(/\n/g, ' ');
  write(`${summary.id}\t${summary.status}\t${summary.project}\t${summary.profile ?? ''}${reason ? `\t${reason}` : ''}\n`);
  if (summary.hint) write(`likely cause: ${summary.hint.title}\n${summary.hint.fix}\n`);
}

function emit(opts, event) {
  if (typeof opts.onEvent === 'function') opts.onEvent(event);
  if (opts.silent) return;
  const write = (text) => process.stdout.write(text);
  if (opts.json) {
    if (opts.follow) write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.event === 'error') {
    process.stderr.write(`${event.error}\n`);
    return;
  }
  if (event.event === 'log' && event.chunk) write(event.chunk);
}

function finish(opts, code, summary, eventName) {
  const event = { event: eventName, ...summary };
  emit(opts, event);
  if (!opts.silent) {
    if (opts.json && !opts.follow) process.stdout.write(`${JSON.stringify(summary)}\n`);
    else if (!opts.json) printHuman(summary, (text) => process.stdout.write(text));
  }
  return { code, summary };
}

function phasesIn(text, seen) {
  const found = [];
  for (const match of text.matchAll(/\[([A-Z][A-Z_]{3,})\]/g)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    found.push(match[1]);
  }
  return found;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function waitFor({
  query = '', json = false, follow = false, timeout = 0, appear = 15000, poll = 400, silent = false, onEvent, data,
} = {}) {
  const opts = { json, follow, silent, onEvent };
  const jobs = () => loadJobs(data);
  const started = Date.now();
  const deadline = timeout > 0 ? started + timeout * 1000 : 0;
  const appearUntil = started + (timeout > 0 ? Math.min(appear, timeout * 1000) : appear);
  let lastStatus = '';
  let logOffset = 0;
  let logEndedNl = true;
  const seenPhases = new Set();

  for (;;) {
    const now = Date.now();
    if (deadline && now > deadline) {
      const item = pickJob(jobs(), query);
      const summary = item ? { ...summarize(item), error: 'timed out' } : { status: 'timeout', error: 'timed out' };
      return finish(opts, 124, summary, 'timeout');
    }
    const item = pickJob(jobs(), query);
    if (!item) {
      if (now > appearUntil) {
        const message = `no build matching ${query || 'latest'}`;
        emit(opts, { event: 'error', error: message });
        if (!opts.silent && opts.json && !opts.follow) process.stdout.write(`${JSON.stringify({ error: message })}\n`);
        return { code: 2, summary: { error: message } };
      }
      await sleep(poll);
      continue;
    }
    const summary = summarize(item);
    if (follow) {
      const path = summary.log;
      if (path && existsSync(path)) {
        const size = statSync(path).size;
        if (size > logOffset) {
          const chunk = readFileSync(path).subarray(logOffset, size).toString('utf8');
          logOffset = size;
          logEndedNl = chunk.endsWith('\n');
          for (const name of phasesIn(chunk, seenPhases)) emit(opts, { event: 'phase', name, id: item.id });
          if (json) {
            for (const line of chunk.split(/\r?\n/).filter(Boolean)) emit(opts, { event: 'log', line, id: item.id });
          } else emit(opts, { event: 'log', chunk, id: item.id });
        }
      }
    }
    if (item.status !== lastStatus) {
      lastStatus = item.status;
      emit(opts, { event: 'status', ...summary });
    }
    if (!ACTIVE.has(item.status)) {
      if (follow && !json && !silent && !logEndedNl) process.stdout.write('\n');
      return finish(opts, exitCode(item.status), summary, 'done');
    }
    await sleep(poll);
  }
}

export function parseArgs(argv) {
  const opts = { query: '', json: false, follow: false, timeout: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--follow') opts.follow = true;
    else if (arg === '--timeout') opts.timeout = Number(argv[++i]);
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else opts.query = arg;
  }
  if (Number.isNaN(opts.timeout) || opts.timeout < 0) throw new Error('--timeout needs a number of seconds');
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log('macbuild wait [id|project] [--json] [--follow] [--timeout SEC]');
      process.exit(0);
    }
    const { code } = await waitFor(opts);
    process.exit(code);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
