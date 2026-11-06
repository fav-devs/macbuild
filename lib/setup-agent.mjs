// Runs Claude Code or Codex in the background for `macbuild setup`, read-only, and returns its structured answer.
// The agent never changes anything: it reads the user's folders and answers with JSON. macbuild shows the questions,
// and runs only the actions the user approves, from a fixed list (lib/setup.mjs).
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_FILE = join(ROOT, 'skills/macbuild-setup/SKILL.md');

export const AGENTS = [
  { id: 'claude', label: 'Claude Code', bin: 'claude', login: 'claude' },
  { id: 'codex', label: 'Codex', bin: 'codex', login: 'codex login' },
];
export const agentLabel = (id) => AGENTS.find((agent) => agent.id === id)?.label ?? 'macbuild';

// The launchd dashboard has a short PATH, so look where installers usually put these too.
function searchDirs(home) {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const extra = [join(home, '.local/bin'), join(home, '.claude/local'), join(home, '.npm-global/bin'), join(home, '.bun/bin'),
    join(home, '.volta/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  try {
    for (const version of readdirSync(join(home, '.nvm/versions/node'))) extra.push(join(home, '.nvm/versions/node', version, 'bin'));
  } catch {}
  return [...new Set([...dirs, ...extra])];
}
export function findBin(name, home = process.env.HOME || homedir()) {
  for (const dir of searchDirs(home)) {
    const file = join(dir, name);
    try { if (statSync(file).isFile()) return file; } catch {}
  }
  return '';
}

export async function detectAgents(home = process.env.HOME || homedir()) {
  return Promise.all(AGENTS.map(async (agent) => {
    const bin = findBin(agent.bin, home);
    if (!bin) return { id: agent.id, label: agent.label, bin: '', version: '', found: false };
    const version = await run(bin, ['--version'], { timeout: 8000 })
      .then(({ stdout }) => (stdout.match(/\d+\.\d+(\.\d+)?/) ?? [''])[0]).catch(() => '');
    return { id: agent.id, label: agent.label, bin, version, found: true };
  }));
}

// One schema for every turn, strict enough for Codex's structured outputs: every property listed and required.
const text = { type: 'string' };
const maybe = { type: ['string', 'null'] };
export const ACTION_TYPES = ['create_eas_json', 'add_profile', 'set_config', 'link_eas', 'install_dev_client', 'add_metro_hook', 'set_setting'];
export const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['say', 'apps', 'questions', 'actions', 'done'],
  properties: {
    say: text,
    apps: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['path', 'name', 'title', 'framework', 'sdk', 'platforms', 'bundleId', 'androidPackage', 'repo', 'note', 'suggested'],
        properties: {
          path: text, name: text, title: text, framework: { type: 'string', enum: ['expo', 'react-native'] }, sdk: maybe,
          platforms: { type: 'array', items: { type: 'string', enum: ['ios', 'android'] } },
          bundleId: maybe, androidPackage: maybe, repo: maybe, note: maybe, suggested: { type: 'boolean' },
        },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'kind', 'label', 'help', 'options', 'default'],
        properties: {
          id: text, kind: { type: 'string', enum: ['text', 'select', 'multi', 'confirm'] }, label: text, help: maybe,
          options: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['value', 'label', 'detail'], properties: { value: text, label: text, detail: maybe } },
          },
          default: maybe,
        },
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['type', 'app', 'key', 'value', 'answer', 'why'],
        properties: { type: { type: 'string', enum: ACTION_TYPES }, app: maybe, key: maybe, value: maybe, answer: maybe, why: text },
      },
    },
    done: { type: 'boolean' },
  },
};

export function skill() {
  // The front matter is for Claude Code's skill loader; the agent only needs the body.
  return readFileSync(SKILL_FILE, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

export function promptFor(task, context) {
  return `TASK: ${task}\n\nCONTEXT (from macbuild, as JSON):\n${JSON.stringify(context, null, 2)}\n\nFollow the "${task}" section of your instructions. End with the JSON object only.`;
}

const tilde = (path, home) => (typeof path === 'string' && home && path.startsWith(home) ? `~${path.slice(home.length)}` : path ?? '');
const short = (value, max = 90) => { const line = String(value ?? '').replace(/\s+/g, ' ').trim(); return line.length > max ? `${line.slice(0, max - 1)}…` : line; };

// What the agent is doing, in a few words, for the spinner and the web page.
export function toolActivity(name, input = {}, home = '') {
  const at = (path) => tilde(path, home) || '~';
  switch (name) {
    case 'Read': return `Reading ${at(input.file_path)}`;
    case 'Glob': return `Looking for ${short(input.pattern, 40)} in ${at(input.path)}`;
    case 'Grep': return `Searching ${at(input.path)} for “${short(input.pattern, 30)}”`;
    case 'LS': return `Listing ${at(input.path)}`;
    case 'Bash': return `Running ${short(tilde(input.command, home), 70)}`;
    case 'StructuredOutput': return 'Writing up what it found';
    default: return short(name, 40);
  }
}
export function commandActivity(command, home = '') {
  let line = Array.isArray(command) ? command.join(' ') : String(command ?? '');
  line = line.replace(/^(\/bin\/|\/usr\/bin\/)?(ba|z)?sh\s+-l?c\s+/, '').replace(/^(['"])(.*)\1$/s, '$2');
  return `Running ${short(home ? line.split(home).join('~') : line, 70)}`;
}

// The last JSON object in a reply, for agents that wrap it in prose or a code fence.
export function lastJson(textOut) {
  const source = String(textOut ?? '');
  for (let end = source.lastIndexOf('}'); end > 0; end = source.lastIndexOf('}', end - 1)) {
    let depth = 0;
    for (let start = end; start >= 0; start -= 1) {
      if (source[start] === '}') depth += 1;
      else if (source[start] === '{') depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(source.slice(start, end + 1)); } catch { break; }
      }
    }
  }
  return null;
}

function friendly(agent, message) {
  const line = short(message, 240);
  const info = AGENTS.find((item) => item.id === agent);
  if (/log ?in|logged|auth|api key|401|unauthori[sz]ed|credential/i.test(line)) {
    return `${info.label} isn’t signed in. Run \`${info.login}\` once in a terminal, then try again. (${line})`;
  }
  return line || `${info.label} stopped without an answer.`;
}

let claudeFlags = null;
async function claudeHelp(bin) {
  if (claudeFlags?.bin === bin) return claudeFlags.help;
  const help = await run(bin, ['--help'], { timeout: 10000, maxBuffer: 1 << 20 }).then(({ stdout }) => stdout).catch(() => '');
  claudeFlags = { bin, help };
  return help;
}

async function claudeArgs(bin, instructions) {
  const help = await claudeHelp(bin);
  const has = (flag) => help.includes(flag);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', instructions,
    '--allowedTools', 'Read,Glob,Grep',
    '--disallowedTools', 'Bash,Edit,Write,NotebookEdit,WebFetch,WebSearch,Task,Agent'];
  if (has('--tools')) args.push('--tools', 'Read,Glob,Grep');
  if (has('--json-schema')) args.push('--json-schema', JSON.stringify(SCHEMA));
  if (has('--no-session-persistence')) args.push('--no-session-persistence');
  if (has('--strict-mcp-config')) args.push('--strict-mcp-config');
  if (process.env.MACBUILD_SETUP_MODEL) args.push('--model', process.env.MACBUILD_SETUP_MODEL);
  return args;
}

// Runs one turn. onActivity gets short lines like "Reading ~/code/notes/app.json".
export async function runAgent({ agent, bin, task, context, cwd, home = process.env.HOME || homedir(), onActivity = () => {}, signal, timeout }) {
  bin ||= findBin(AGENTS.find((item) => item.id === agent)?.bin ?? '', home);
  if (!bin) return { ok: false, error: `${agentLabel(agent)} isn’t installed.` };
  const instructions = skill();
  const prompt = promptFor(task, context);
  const limit = timeout ?? Number(process.env.MACBUILD_SETUP_TIMEOUT ?? 300) * 1000;
  let args; let input; let scratch = ''; let outFile = '';
  if (agent === 'claude') {
    args = await claudeArgs(bin, instructions);
    input = prompt;
  } else {
    scratch = mkdtempSync(join(tmpdir(), 'macbuild-setup-'));
    const schemaFile = join(scratch, 'schema.json');
    outFile = join(scratch, 'answer.json');
    writeFileSync(schemaFile, JSON.stringify(SCHEMA));
    args = ['exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', cwd ?? home, '--output-schema', schemaFile, '-o', outFile];
    if (process.env.MACBUILD_SETUP_MODEL) args.push('-m', process.env.MACBUILD_SETUP_MODEL);
    args.push('-');
    input = `${instructions}\n\n---\n\n${prompt}`;
  }
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: cwd ?? home, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let buffer = ''; let stderr = ''; let final = null; let lastText = ''; let failure = ''; let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abort);
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      resolve(result);
    };
    const stop = () => { try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000).unref(); };
    const abort = () => { stop(); finish({ ok: false, cancelled: true, error: 'Stopped.' }); };
    const timer = setTimeout(() => { stop(); finish({ ok: false, error: `${agentLabel(agent)} took longer than ${Math.round(limit / 60000)} minutes.` }); }, limit);
    signal?.addEventListener?.('abort', abort, { once: true });
    const event = (line) => {
      let item;
      try { item = JSON.parse(line); } catch { return; }
      if (agent === 'claude') {
        if (item.type === 'assistant') {
          for (const block of item.message?.content ?? []) {
            if (block.type === 'tool_use') onActivity(toolActivity(block.name, block.input, home));
            if (block.type === 'text' && block.text?.trim()) lastText = block.text;
          }
        }
        if (item.type === 'result') {
          if (item.is_error || (item.subtype && item.subtype !== 'success')) failure = item.result || item.subtype;
          final = item.structured_output ?? lastJson(item.result) ?? lastJson(lastText);
        }
      } else {
        const it = item.item ?? {};
        if (item.type === 'item.started' && it.type === 'command_execution') onActivity(commandActivity(it.command, home));
        if (item.type === 'item.completed' && it.type === 'agent_message' && it.text) lastText = it.text;
        if (item.type === 'item.completed' && it.type === 'reasoning' && it.text) onActivity(short(it.text.replace(/\*\*/g, ''), 80));
        if (item.type === 'turn.failed') failure = item.error?.message ?? 'turn failed';
        if (item.type === 'error' && !/reconnect|falling back/i.test(item.message ?? '')) failure = item.message;
      }
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) { event(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', (error) => finish({ ok: false, error: friendly(agent, error.message) }));
    child.on('close', (code) => {
      if (buffer.trim()) event(buffer);
      if (agent === 'codex' && existsSync(outFile)) final = lastJson(readFileSync(outFile, 'utf8')) ?? final;
      if (!final && lastText) final = lastJson(lastText);
      if (final && typeof final === 'object') return finish({ ok: true, data: final });
      const reason = failure || stderr.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) || (code ? `exited with code ${code}` : 'no answer');
      finish({ ok: false, error: friendly(agent, reason) });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}
