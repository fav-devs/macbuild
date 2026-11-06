#!/usr/bin/env node
// `macbuild dev`: start, watch and drive a project's Expo dev server from a terminal or an agent. The dashboard runs
// the dev servers (lib/devserver.mjs); this talks to it on 127.0.0.1, or to a remote Mac through the remote API with
// the same paths (bin/macbuild.mjs passes a remote transport). DEV_TOOLS are the same operations as MCP tools, for
// lib/mcp.mjs and lib/remote-mcp.mjs.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HELP = `macbuild dev: Expo dev servers, run by the dashboard

  macbuild dev                          every project: can it run a dev server, is one running, its port and link
  macbuild dev NAME [options]           start NAME's dev server (or show it, if it's running) and wait until it's ready
      --tailscale | --lan | --localhost | --tunnel    how a phone reaches it (default: Tailscale when it's on)
      --clear        clear Metro's cache        --port N      use port N (default: 8081, or the next free one)
      --follow       keep printing the log      --open        open the web app or link on this Mac when ready
      --here         run expo start in this terminal instead, without the dashboard
  macbuild dev stop NAME | restart NAME
  macbuild dev status NAME [--json]     links, bundling, any question Expo is asking, and the command
  macbuild dev log NAME [--tail N] [--since LINE] [--follow] [--json]
  macbuild dev key NAME KEY...          press keys: r reload, m menu, j debugger, i iOS, a Android, w web,
                                        s switch, ?, enter, up, down, yes, no, ctrl-c (or any one character)
  macbuild dev send NAME TEXT           type TEXT and press Enter (--no-enter to leave it typed)
  macbuild dev answer NAME yes|no|N     answer the question Expo is asking: yes, no, or option number N
  macbuild dev wait NAME [--for REGEX] [--since LINE] [--timeout SECONDS]
                                        wait for a log line. The default waits for the next bundle: exit 0 when it
                                        bundles, 1 when it fails or errors, 124 on timeout
  macbuild dev command NAME             print the command it runs, without starting it

Log lines are numbered. Pass the last number you saw as --since to read or wait for what came after it.
It's Expo's terminal, not a shell: keys and text go to expo start only.`;

const LIVE = ['starting', 'running', 'stopping'];
export const DEFAULT_WAIT = 'Bundled|Bundling failed|ERROR|Error:';
const FAILED = /Bundling failed|ERROR|Error:/;

// The dashboard on this Mac. x-macbuild is the header its POST requests need; x-macbuild-client says who's asking.
export function localTransport({ port = process.env.MACBUILD_UI_PORT ?? 4180, client = 'cli' } = {}) {
  const base = `http://127.0.0.1:${port}/api`;
  const call = async (path, options = {}) => {
    let response;
    try { response = await fetch(`${base}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-macbuild': '1', 'x-macbuild-client': client }, signal: options.signal ?? AbortSignal.timeout(90000) }); }
    catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw error;
      throw Object.assign(new Error(`The dashboard isn't running on 127.0.0.1:${port}, and it runs dev servers. Start it with \`macbuild setup --ui\`, or run Expo in this terminal with \`macbuild dev NAME --here\`.`), { code: 'NO_DASHBOARD' });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error ?? `HTTP ${response.status}`), { status: response.status });
    return result;
  };
  return { get: (path, options) => call(path, options), post: (path, body) => call(path, { method: 'POST', body: JSON.stringify(body ?? {}) }), local: true };
}
export function remoteTransport(client) {
  return { get: (path) => client.request(path), post: (path, body) => client.request(path, { method: 'POST', body: body ?? {} }), local: false };
}

const at = (name, rest = '') => `/dev/${encodeURIComponent(name)}${rest}`;
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
const ago = (time) => { const minutes = Math.round((Date.now() - time) / 60000); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`; };
const pad = (text, width) => String(text).padEnd(width);

export async function waitReady(transport, name, { timeout = 120000, signal } = {}) {
  const start = Date.now();
  for (;;) {
    signal?.throwIfAborted?.();
    const view = await transport.get(at(name));
    const session = view.session;
    if (!session || !LIVE.includes(session.status) || session.status === 'running' || session.prompt) return view;
    if (Date.now() - start > timeout) return view;
    await sleep(500);
  }
}
// Waits for a line matching pattern after line `since`, holding each request on the server (wait=25) rather than polling.
export async function waitFor(transport, name, { pattern = DEFAULT_WAIT, since, timeout = 300, signal, onLine } = {}) {
  let regex;
  try { regex = new RegExp(pattern); } catch { throw new Error(`Not a regular expression: ${pattern}`); }
  let cursor = since;
  if (cursor === undefined) cursor = (await transport.get(at(name, '/log?tail=1'))).next ?? 0;
  const start = Date.now();
  const seen = [];
  for (;;) {
    signal?.throwIfAborted?.();
    const left = timeout ? timeout - (Date.now() - start) / 1000 : 25;
    if (timeout && left <= 0) return { code: 124, matched: null, lines: seen, next: cursor, timedOut: true };
    const log = await transport.get(at(name, `/log?since=${cursor}&wait=${Math.max(1, Math.min(25, Math.ceil(left)))}`));
    for (const line of log.lines) {
      seen.push(line); onLine?.(line);
      if (regex.test(line.text)) return { code: pattern === DEFAULT_WAIT && FAILED.test(line.text) ? 1 : 0, matched: line, lines: seen.slice(-200), next: line.n, status: log.status, prompt: log.prompt };
    }
    cursor = log.next ?? cursor;
    if (!LIVE.includes(log.status)) return { code: 1, matched: null, lines: seen.slice(-200), next: cursor, status: log.status, stopped: true };
    if (log.prompt && !log.lines.length) return { code: 1, matched: null, lines: seen.slice(-200), next: cursor, status: log.status, prompt: log.prompt, waiting: true };
  }
}

function describe(view) {
  const session = view.session;
  const live = session && LIVE.includes(session.status);
  const lines = [];
  const ready = view.readiness;
  lines.push(`${view.project}: ${live ? `${session.status} on port ${session.port}` : session?.status === 'failed' ? `failed${session.reason ? `: ${session.reason}` : ''}` : 'not running'}`);
  if (live) {
    if (session.urls?.app) lines.push(`  Open on a phone: ${session.urls.app}`);
    if (session.urls?.web) lines.push(`  Web: ${session.urls.web}`);
    lines.push(`  Opens in: ${session.target}. Connection: ${session.connection}${session.host ? ` (${session.host})` : ''}`);
    for (const [platform, bundle] of Object.entries(session.bundles ?? {})) lines.push(`  ${{ ios: 'iOS', android: 'Android', web: 'Web' }[platform] ?? platform}: ${bundle.failed ? 'bundling failed' : bundle.done ? `bundled in ${bundle.ms} ms${bundle.modules ? ` (${bundle.modules} modules)` : ''}` : `bundling ${bundle.percent}%`}`);
    if (session.lastError) lines.push(`  Last error: ${session.lastError.text}`);
    if (session.prompt) lines.push(`  Expo is asking: ${session.prompt.text}${session.prompt.kind === 'confirm' ? ' (answer yes or no)' : session.prompt.options ? `\n${session.prompt.options.map((option, index) => `    ${index + 1}. ${option.label}${option.selected ? '  ←' : ''}`).join('\n')}` : ''}`);
    lines.push(`  Started ${ago(session.startedAt)} ago${session.by?.name ? ` by ${session.by.name}` : ''}. Log: ${session.lineCount} lines.`);
  } else {
    lines.push(`  Can run a dev server: ${ready.ok ? 'yes' : 'no'} (${ready.summary}, ${ready.passed}/${ready.total} checks)`);
    for (const check of ready.checks.filter((item) => item.level === 'bad' || item.level === 'warn')) lines.push(`  ${check.level === 'bad' ? '✗' : '!'} ${check.label}: ${check.detail}${check.fix ? `\n      ${check.fix}` : ''}`);
  }
  lines.push(`  Command: ${live ? session.command : view.command}`);
  return lines.join('\n');
}
const printLine = (line) => process.stdout.write(`${String(line.n).padStart(5)}  ${line.text}\n`);

function projectDir(name) {
  const file = process.env.MACBUILD_PROJECTS ?? join(homedir(), '.config/macbuild/projects.conf');
  const line = (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n').find((item) => item.split('|')[0] === name);
  return line?.split('|')[1] ?? null;
}

function parse(args) {
  const flags = new Set(['--follow', '--json', '--open', '--here', '--clear', '--no-enter', '--tailscale', '--lan', '--localhost', '--tunnel', '--help', '-h']);
  const values = new Set(['--tail', '--since', '--for', '--timeout', '--port']);
  const options = {}; const words = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (flags.has(arg)) options[arg.replace(/^-+/, '')] = true;
    else if (values.has(arg)) {
      if (args[index + 1] === undefined) throw new Error(`${arg} needs a value.`);
      options[arg.slice(2)] = args[++index];
    } else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}. See macbuild dev --help.`);
    else words.push(arg);
  }
  for (const key of ['tail', 'since', 'timeout', 'port']) if (options[key] !== undefined && !/^\d+$/.test(options[key])) throw new Error(`--${key} needs a whole number.`);
  const chosen = ['tailscale', 'lan', 'localhost', 'tunnel'].filter((key) => options[key]);
  if (chosen.length > 1) throw new Error('Choose one of --tailscale, --lan, --localhost, --tunnel.');
  options.connection = { tailscale: 'tailnet', lan: 'lan', localhost: 'localhost', tunnel: 'tunnel' }[chosen[0]];
  return { options, words };
}

const SUBCOMMANDS = ['start', 'stop', 'restart', 'status', 'log', 'logs', 'key', 'keys', 'send', 'answer', 'wait', 'command', 'list'];
export async function devMain(args, transport = localTransport(), out = process.stdout) {
  const { options, words } = parse(args);
  const print = (text) => out.write(`${typeof text === 'string' ? text : JSON.stringify(text, null, 2)}\n`);
  if (options.help || options.h) { print(HELP); return 0; }
  let [command, name, ...rest] = words;
  if (command && !SUBCOMMANDS.includes(command)) { rest = name === undefined ? [] : [name, ...rest]; name = command; command = 'start'; }
  if (!command || command === 'list') {
    const { servers } = await transport.get('/dev');
    if (options.json) { print(servers); return 0; }
    if (!servers.length) { print('No projects. Add one with macbuild add NAME PATH.'); return 0; }
    const width = Math.max(8, ...servers.map((item) => item.project.length)) + 2;
    print(`${pad('PROJECT', width)}${pad('CAN RUN', 26)}${pad('DEV SERVER', 22)}LINK`);
    for (const item of servers) {
      const live = LIVE.includes(item.status);
      print(`${pad(item.project, width)}${pad(item.readiness.ok ? `yes (${item.readiness.passed}/${item.readiness.total})` : `no: ${item.readiness.summary}`.slice(0, 25), 26)}${pad(live ? `${item.prompt ? 'asking' : item.status} :${item.port}` : 'stopped', 22)}${live ? item.urls?.web ?? item.urls?.app ?? '' : ''}`);
    }
    return 0;
  }
  if (!name) throw new Error(`macbuild dev ${command} needs a project name.`);
  if (command === 'start' && options.here) {
    if (!transport.local) throw new Error('--here runs Expo in this terminal, on the Mac. From here, start it on the Mac with macbuild dev NAME.');
    const dir = projectDir(name);
    if (!dir) throw new Error(`Unknown project ${name}. See macbuild list.`);
    const view = await transport.get(at(name)).catch(() => null);
    if (view?.session && LIVE.includes(view.session.status)) throw new Error(`${name}'s dev server is already running in the dashboard on port ${view.session.port}. Stop it first: macbuild dev stop ${name}`);
    const args = ['expo', 'start', ...(options.port ? ['--port', options.port] : []), ...(options.connection === 'localhost' ? ['--localhost'] : options.connection === 'tunnel' ? ['--tunnel'] : []), ...(options.clear ? ['--clear'] : [])];
    print(`cd ${dir} && npx ${args.join(' ')}`);
    return new Promise((done) => { const child = spawn('npx', args, { cwd: dir, stdio: 'inherit' }); child.on('close', (code) => done(code ?? 1)); child.on('error', (error) => { print(`macbuild: ${error.message}`); done(1); }); });
  }
  if (command === 'command') {
    const view = await transport.get(at(name));
    print(view.session && LIVE.includes(view.session.status) ? view.session.command : view.command); return 0;
  }
  if (command === 'status') {
    const view = await transport.get(at(name));
    print(options.json ? view : describe(view)); return 0;
  }
  if (command === 'start' || command === 'restart') {
    const body = { ...(options.connection ? { connection: options.connection } : {}), clear: Boolean(options.clear), ...(options.port ? { port: Number(options.port) } : {}) };
    const before = await transport.get(at(name));
    const already = command === 'start' && before.session && LIVE.includes(before.session.status);
    if (!already) await transport.post(at(name, `/${command}`), body);
    const view = await waitReady(transport, name);
    if (options.json) print(view); else print(`${already ? 'Already running. ' : ''}${describe(view)}`);
    const session = view.session;
    if (options.open && session?.status === 'running') {
      const link = session.urls?.web ?? session.urls?.app;
      if (link && transport.local && process.platform === 'darwin') spawn('open', [link], { stdio: 'ignore', detached: true }).unref();
      else if (link) print(`Open: ${link}`);
    }
    if (options.follow && session && LIVE.includes(session.status)) return follow(transport, name, (await transport.get(at(name, '/log?tail=1'))).next, options);
    return session && ['running', 'starting'].includes(session.status) ? 0 : 1;
  }
  if (command === 'stop') {
    const session = await transport.post(at(name, '/stop'));
    for (let waited = 0; session && LIVE.includes(session.status) && waited < 8000; waited += 250) {
      await sleep(250);
      const view = await transport.get(at(name));
      if (!view.session || !LIVE.includes(view.session.status)) { print(`Stopped ${name}'s dev server.`); return 0; }
    }
    print(session && LIVE.includes(session.status) ? `Stopping ${name}'s dev server.` : `${name}'s dev server isn't running.`); return 0;
  }
  if (command === 'log' || command === 'logs') {
    const since = options.since !== undefined ? Number(options.since) : undefined;
    const log = await transport.get(at(name, `/log?${since !== undefined ? `since=${since}` : `tail=${Number(options.tail ?? 80)}`}`));
    if (options.json && !options.follow) { print(log); return 0; }
    for (const line of log.lines) printLine(line);
    if (!log.lines.length && !log.session) print(`No dev server log for ${name} yet. Start one with macbuild dev ${name}.`);
    if (options.follow) return follow(transport, name, log.next, options);
    return 0;
  }
  if (command === 'key' || command === 'keys') {
    if (!rest.length) throw new Error('Name a key: r, m, j, i, a, w, s, ?, enter, up, down, yes, no, ctrl-c.');
    for (const key of rest) await transport.post(at(name, '/input'), { key });
    print(`Pressed ${rest.join(', ')}.`); return 0;
  }
  if (command === 'send') {
    if (!rest.length) throw new Error('Nothing to send.');
    await transport.post(at(name, '/input'), { text: rest.join(' '), enter: !options['no-enter'] });
    print(`Sent ${JSON.stringify(rest.join(' '))}${options['no-enter'] ? '' : ' and Enter'}.`); return 0;
  }
  if (command === 'answer') {
    const view = await transport.get(at(name));
    const prompt = view.session?.prompt;
    if (!prompt) throw new Error(`Expo isn't asking anything right now.`);
    const answer = (rest[0] ?? '').toLowerCase();
    if (prompt.kind === 'select') {
      const index = /^\d+$/.test(answer) ? Number(answer) - 1 : prompt.options.findIndex((option) => option.label.toLowerCase().includes(answer));
      if (!(index >= 0 && index < prompt.options.length)) throw new Error(`Choose 1 to ${prompt.options.length}:\n${prompt.options.map((option, item) => `  ${item + 1}. ${option.label}`).join('\n')}`);
      await transport.post(at(name, '/input'), { choose: index });
      print(`Chose ${prompt.options[index].label}.`); return 0;
    }
    if (prompt.kind === 'confirm') {
      if (!['yes', 'y', 'no', 'n'].includes(answer)) throw new Error(`${prompt.text}: answer yes or no.`);
      await transport.post(at(name, '/input'), { key: answer.startsWith('y') ? 'y' : 'n' });
      print(`Answered ${answer.startsWith('y') ? 'yes' : 'no'}.`); return 0;
    }
    await transport.post(at(name, '/input'), { text: rest.join(' ') });
    print('Answered.'); return 0;
  }
  if (command === 'wait') {
    const result = await waitFor(transport, name, { pattern: options.for ?? DEFAULT_WAIT, since: options.since !== undefined ? Number(options.since) : undefined, timeout: Number(options.timeout ?? 300), onLine: options.json ? undefined : printLine });
    if (options.json) print(result);
    else if (result.timedOut) print(`Timed out. Read on from line ${result.next}: macbuild dev log ${name} --since ${result.next}`);
    else if (result.stopped) print(result.lines.length ? `The dev server ${result.status === 'failed' ? 'failed' : 'stopped'}.` : `${name}'s dev server isn't running. Start it with macbuild dev ${name}.`);
    else if (result.waiting) print(`Expo is asking: ${result.prompt.text}. Answer with macbuild dev answer ${name} ...`);
    return result.code;
  }
  throw new Error(`Unknown command ${command}. See macbuild dev --help.`);
}
async function follow(transport, name, cursor, options) {
  const stopAt = options.timeout ? Date.now() + Number(options.timeout) * 1000 : 0;
  let asked = '';
  for (;;) {
    if (stopAt && Date.now() > stopAt) return 0;
    const log = await transport.get(at(name, `/log?since=${cursor}&wait=25`));
    for (const line of log.lines) { if (options.json) process.stdout.write(`${JSON.stringify(line)}\n`); else printLine(line); }
    cursor = log.next ?? cursor;
    // A question holds Expo, and the server answers at once while one is open: say so once, then check every second.
    if (log.prompt && !log.lines.length) {
      if (asked !== log.prompt.text && !options.json) process.stdout.write(`-- Expo is asking: ${log.prompt.text}. Answer with macbuild dev answer ${name} ...\n`);
      asked = log.prompt.text;
      await sleep(1000);
    }
    if (!LIVE.includes(log.status)) { process.stdout.write(`-- the dev server ${log.status === 'failed' ? 'failed' : 'stopped'}\n`); return log.status === 'failed' ? 1 : 0; }
  }
}

// The same operations for agents, as MCP tools.
const string = { type: 'string' };
const tool = (name, description, properties = {}, required = [], readOnly = true) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } });
export const DEV_TOOLS = [
  tool('dev_servers', 'Every project’s Expo dev server: whether it can run one here, whether it is running, its port and link.'),
  tool('dev_status', 'One project’s dev server: readiness checks, links, bundling per platform, the last error, any question Expo is asking, and the exact command.', { project: string }, ['project']),
  tool('dev_start', 'Start a project’s dev server (npx expo start, run by the dashboard on the Mac). Does nothing if it is running. Returns once Metro is ready or Expo asks something.', { project: string, connection: { type: 'string', enum: ['tailnet', 'lan', 'localhost', 'tunnel'] }, clear: { type: 'boolean' } }, ['project'], false),
  tool('dev_stop', 'Stop a project’s dev server. Only stop one you started, or when the user asks.', { project: string }, ['project'], false),
  tool('dev_log', 'Numbered lines of the dev server’s log. Pass since (the last line number you read) for only what came after it; next is the number to pass next time.', { project: string, since: { type: 'number', minimum: 0 }, tail: { type: 'number', minimum: 1 } }, ['project']),
  tool('dev_wait', 'Wait for a dev server log line matching pattern (a regular expression; default: the next bundle finishing, failing or erroring) after line since. Use after editing code to see whether it bundled. code 0 is a match (or a good bundle), 1 a failed bundle or a stopped server, 124 a timeout.', { project: string, pattern: string, since: { type: 'number', minimum: 0 }, timeout: { type: 'number', minimum: 1 } }, ['project']),
  tool('dev_send', 'Press a key in the dev server’s terminal (key: r reload, m menu, j debugger, i iOS Simulator, a Android, w web, s switch, enter, up, down, yes, no, ctrl-c, or one character), type text (with Enter unless enter is false), or pick option number choose (from 0) of a list Expo shows. It is Expo’s terminal, not a shell.', { project: string, key: string, text: string, enter: { type: 'boolean' }, choose: { type: 'number', minimum: 0 } }, ['project'], false),
];
export async function devTool(transport, name, args = {}, signal) {
  const project = args.project;
  if (name === 'dev_servers') return (await transport.get('/dev')).servers;
  if (typeof project !== 'string' || !project) throw new Error('project is required.');
  if (name === 'dev_status') return transport.get(at(project));
  if (name === 'dev_start') {
    const view = await transport.get(at(project));
    if (!view.session || !LIVE.includes(view.session.status)) await transport.post(at(project, '/start'), { connection: args.connection, clear: args.clear === true });
    const ready = await waitReady(transport, project, { timeout: 90000, signal });
    return { session: ready.session, readiness: ready.readiness, command: ready.session?.command ?? ready.command };
  }
  if (name === 'dev_stop') return transport.post(at(project, '/stop'));
  if (name === 'dev_log') return transport.get(at(project, `/log?${Number.isFinite(args.since) ? `since=${Math.trunc(args.since)}` : `tail=${Math.trunc(args.tail ?? 80)}`}`));
  if (name === 'dev_wait') return waitFor(transport, project, { pattern: args.pattern || DEFAULT_WAIT, since: Number.isFinite(args.since) ? Math.trunc(args.since) : undefined, timeout: args.timeout ?? 120, signal });
  if (name === 'dev_send') {
    if (Number.isFinite(args.choose)) return transport.post(at(project, '/input'), { choose: Math.trunc(args.choose) });
    if (typeof args.key === 'string' && args.key) return transport.post(at(project, '/input'), { key: args.key });
    if (typeof args.text === 'string') return transport.post(at(project, '/input'), { text: args.text, enter: args.enter !== false });
    throw new Error('Send a key, text, or choose.');
  }
  throw new Error(`Unknown tool ${name}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  devMain(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => { console.error(`macbuild: ${error.message}`); process.exitCode = 1; });
}
