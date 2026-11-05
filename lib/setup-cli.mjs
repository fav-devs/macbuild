#!/usr/bin/env node
// `macbuild setup` in a terminal: asks whether to set up here or in the browser, then walks through the steps in
// lib/setup.mjs. In the browser it's the dashboard's #/setup page, served for the length of setup if it isn't running.
//   node lib/setup-cli.mjs [--cli|--web] [--agent claude|codex|none] [--reset] [--first-run]
//   node lib/setup-cli.mjs --mark ID CODE    record a command run from the dashboard (signing), used by the terminal line
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { request } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetupFlow, quote } from './setup.mjs';
import { createTui, wrapText } from './tui.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin/macbuild');
const PORT = Number(process.env.MACBUILD_UI_PORT ?? 4180);
const FIRST_RUN_DONE = 3; // bin/macbuild prints its usage instead

function parse(argv) {
  const opts = { mode: '', agent: '', reset: false, firstRun: false, mark: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--cli' || arg === '--terminal' || arg === '--tui') opts.mode = 'cli';
    else if (arg === '--web' || arg === '--browser') opts.mode = 'web';
    else if (arg === '--agent') { opts.agent = argv[i + 1] ?? ''; i += 1; }
    else if (arg === '--reset') opts.reset = true;
    else if (arg === '--first-run') opts.firstRun = true;
    else if (arg === '--mark') { opts.mark = { id: argv[i + 1] ?? '', code: argv[i + 2] ?? '1' }; i += 2; }
    else { console.error(`unknown option ${arg}`); process.exit(2); }
  }
  return opts;
}

const opts = parse(process.argv.slice(2));
const flow = new SetupFlow({ surface: 'cli' });

if (opts.mark) {
  if (/^(signing|tool):[\w.:-]+$/.test(opts.mark.id)) flow.mark(opts.mark.id, opts.mark.code);
  process.exit(0);
}
if (opts.firstRun && (flow.isDone() || flow.state.skipped)) process.exit(FIRST_RUN_DONE);
if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error('macbuild setup asks questions, so it needs a terminal. Agents: see AGENTS.md, or run macbuild setup --status.');
  process.exit(2);
}
if (opts.reset) flow.reset();
if (opts.agent) {
  if (!['claude', 'codex', 'none'].includes(opts.agent)) { console.error('--agent is claude, codex or none'); process.exit(2); }
  flow.state.agent = opts.agent;
  flow.save();
}

const tui = createTui();
const { t, pad } = tui;
tui.onInterrupt = () => {
  flow.skipAgent();
  tui.restore();
  tui.line();
  tui.line(`${pad}${t.dim('Setup paused. Run')} macbuild setup ${t.dim('to pick up where you left off.')}`);
  process.exit(130);
};

const brand = () => `${pad}${t.accent('◆')} ${t.bold('macbuild')}  ${t.dim('setup')}`;
function header(view) {
  tui.clear();
  tui.line();
  tui.line(brand());
  tui.line();
  const steps = view.steps.map((step) => (step.state === 'done' ? `${t.ok('✓')} ${t.dim(step.label)}` : step.state === 'current' ? `${t.accent('●')} ${t.bold(step.label)}` : t.dim(`○ ${step.label}`)));
  tui.line(`${pad}${steps.join('  ')}`);
  tui.line();
}

const NOTE = { ok: () => t.ok('✓'), bad: () => t.bad('✗'), warn: () => t.warn('!'), info: () => t.dim('·') };
function notes(items) {
  if (!items.length) return;
  const codeWidth = Math.max(0, ...items.filter((note) => note.code).map((note) => note.code.length)) + 3;
  for (const note of items) {
    if (note.code) { tui.line(`${pad}${t.accent(note.code.padEnd(codeWidth))}${t.dim(note.text)}`); continue; }
    const [first, ...rest] = wrapText(note.text, tui.cols() - 8);
    tui.line(`${pad}${NOTE[note.tone]?.() ?? ' '} ${note.tone === 'info' ? t.dim(first) : first}`);
    for (const line of rest) tui.line(`${pad}  ${note.tone === 'info' ? t.dim(line) : line}`);
  }
  tui.line();
}

function body(view) {
  tui.line(`${pad}${t.bold(view.title)}`);
  if (view.lead) {
    if (view.by) {
      // The agent's own words, set apart, with who said them.
      tui.line();
      for (const line of wrapText(view.lead, tui.cols() - 8)) tui.line(`${pad}${t.accent('│')} ${line}`);
      tui.line(`${pad}${t.accent('│')} ${t.dim(`— ${view.by}`)}`);
    } else tui.paragraph(view.lead, t.dim);
  }
  tui.line();
  notes(view.notes);
}

function commandList(commands) {
  const labelWidth = Math.min(32, Math.max(...commands.map((command) => command.label.length))) + 2;
  for (const command of commands) {
    const mark = command.status === 'done' ? t.ok('✓') : command.status === 'failed' ? t.bad('✗') : t.dim('○');
    tui.line(`${pad}${mark} ${command.label.padEnd(labelWidth)}${t.dim(command.display)}`);
  }
  tui.line();
}

function ask(field) {
  const options = (field.options ?? []).map((option) => ({ ...option }));
  if (field.kind === 'select') return tui.select({ label: field.label, help: field.help, options, value: field.value });
  if (field.kind === 'multi') return tui.multi({ label: field.label, help: field.help, options, value: field.value ?? [] });
  if (field.kind === 'confirm') return tui.confirm({ label: field.label, help: field.help, value: field.value !== false });
  return tui.text({ label: field.label, help: field.help, value: field.value ?? '', placeholder: field.placeholder ?? '' });
}

const pastTense = (busy) => {
  const who = busy.agent ?? 'macbuild';
  if (busy.kind === 'find') return `${who} looked for your apps`;
  if (busy.kind === 'check') return `${who} checked your apps`;
  return 'Applied the fixes';
};

async function waitBusy(view) {
  const skippable = view.buttons.some((button) => button.id === 'skip');
  let latest = view;
  const refresh = async () => { latest = await flow.view(); };
  flow.on('change', refresh);
  const spin = tui.spinner({
    label: () => latest.busy?.label ?? view.busy.label,
    lines: () => latest.busy?.activity ?? [],
    hint: skippable ? 'esc skips the agent and uses macbuild’s own checks' : '',
    onKey: skippable ? (str, key) => { if (key.name === 'escape') flow.skipAgent(); } : null,
  });
  if (!flow.current) {
    // Another process (the dashboard) is running this step: follow along until it's done.
    while ((await flow.view()).busy) await new Promise((done) => { setTimeout(done, 1000); });
  }
  await flow.wait();
  flow.off('change', refresh);
  spin.stop(pastTense(view.busy));
  tui.line();
}

const offered = new Set();
async function runCommands(view) {
  const todo = view.commands.filter((command) => command.status !== 'done');
  // Asked once per step; after that, only again while something needed is left.
  if (!todo.length || (offered.has(view.step) && todo.every((command) => command.optional))) return false;
  const again = offered.has(view.step);
  offered.add(view.step);
  const picked = await tui.multi({
    label: todo.length === 1 ? 'Run it now?' : 'Run which now?',
    help: 'Each one gets this terminal until it’s done.',
    options: todo.map((command) => ({ value: command.id, label: command.label, detail: command.display })),
    value: again ? [] : todo.filter((command) => !command.optional).map((command) => command.id), // asked again: tick nothing, so enter moves on
  });
  tui.line();
  if (!picked.length) return false;
  for (const id of picked) {
    const command = todo.find((item) => item.id === id);
    const code = await tui.handoff({ argv: command.argv, cwd: command.cwd, display: command.display });
    flow.mark(command.id, code);
  }
  return true;
}

async function terminal() {
  let shown = null;
  for (;;) {
    const view = await flow.view();
    if (view.step !== shown) { header(view); shown = view.step; } else tui.line();
    if (view.busy) { await waitBusy(view); continue; }
    body(view);
    if (view.step === 'done') break;
    if (view.commands.length) commandList(view.commands);
    const values = {};
    for (const field of view.fields.filter((item) => !item.for && !item.attach)) {
      values[field.id] = await ask(field);
      // A value a fix needs (a bundle identifier) is asked right after, and only if that fix is ticked.
      for (const extra of view.fields.filter((item) => item.attach?.field === field.id)) {
        const picked = [].concat(values[field.id]).includes(extra.attach.option);
        values[extra.id] = picked ? await ask(extra) : extra.value;
      }
    }
    if (view.commands.length && (await runCommands(view))) {
      if (view.step === 'tools') await flow.doctor(true);
      continue;
    }
    const buttons = view.buttons.filter((button) => !button.href);
    let button = buttons[0];
    if (buttons.length > 1) {
      const id = await tui.select({ label: 'What next?', options: buttons.map((item) => ({ value: item.id, label: item.label })), value: buttons.find((item) => item.primary)?.id });
      button = buttons.find((item) => item.id === id);
    }
    for (const field of view.fields.filter((item) => item.for === button.id)) { values[field.id] = await ask(field); }
    if (view.step === 'tools' && button.id === 'recheck') {
      const spin = tui.spinner({ label: 'Checking your tools' });
      await flow.submit({ step: view.step, button: button.id, values });
      spin.stop('Checked your tools');
      continue;
    }
    const result = await flow.submit({ step: view.step, button: button.id, values });
    if (result.error) tui.line(`${pad}${t.bad('✗')} ${result.error}`);
    if (view.step === 'mac' && flow.state.installUi) {
      flow.state.installUi = false; // done here, not by the browser's leftover server
      flow.save();
      await tui.handoff({ argv: [join(ROOT, 'install-ui.sh')], cwd: ROOT, display: 'install-ui.sh  (dashboard and menu bar)' });
    }
  }
  const request = flow.state.buildRequest;
  if (request && !flow.state.buildId) {
    flow.state.buildRequest = null;
    flow.save();
    const argv = [BIN, request.app, '--profile', request.profile, ...(request.install ? ['--install'] : [])];
    const code = await tui.handoff({ argv, cwd: homedir(), display: argv.slice(1).map(quote).join(' ').replace(/^/, 'macbuild ') });
    process.exit(code);
  }
}

// ---------- in the browser ----------

function ping() {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/api/setup/flow', timeout: 1500, headers: { host: `127.0.0.1:${PORT}` } }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}
function post(path, data) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(data);
    const req = request({ host: '127.0.0.1', port: PORT, path, method: 'POST', timeout: 10000, headers: { host: `127.0.0.1:${PORT}`, 'content-type': 'application/json', 'x-macbuild': '1', 'content-length': Buffer.byteLength(payload) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => { try { resolve(JSON.parse(text)); } catch { resolve({}); } });
    });
    req.on('error', () => resolve({ error: 'dashboard not reachable' }));
    req.end(payload);
  });
}
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
const quiet = (argv, cwd) => new Promise((resolve) => { const child = spawn(argv[0], argv.slice(1), { cwd, stdio: 'ignore' }); child.on('error', () => resolve(1)); child.on('close', (code) => resolve(code ?? 1)); });

async function browser() {
  const url = `http://127.0.0.1:${PORT}/#/setup`;
  let server = null;
  if (!(await ping())) {
    if (!existsSync(join(ROOT, 'ui/node_modules'))) {
      const spin = tui.spinner({ label: 'Getting the dashboard ready' });
      const code = await quiet(['npm', 'install', '--omit=dev', '--no-audit', '--no-fund'], join(ROOT, 'ui'));
      spin.stop(code === 0 ? 'Dashboard ready' : 'Couldn’t install the dashboard’s packages (npm install in ui/)', code === 0 ? 'ok' : 'bad');
      if (code !== 0) process.exit(1);
    }
    const logs = join(homedir(), 'Library/Logs');
    mkdirSync(logs, { recursive: true });
    const log = openSync(join(logs, 'macbuild-ui.log'), 'a');
    server = spawn(process.execPath, [join(ROOT, 'ui/server.mjs')], { stdio: ['ignore', log, log], env: { ...process.env, MACBUILD_UI_PORT: String(PORT), MACBUILD_SETUP_TEMP: '1' } });
    for (let n = 0; n < 40 && !(await ping()); n += 1) await sleep(250);
  }
  if (process.platform === 'darwin') await quiet(['open', url]);
  tui.line(`${pad}${t.bold('Setup is open in your browser')}`);
  tui.line(`${pad}${t.accent(url)}`);
  tui.line();
  if (!server) {
    tui.paragraph('The dashboard is already running, so you can close this window.', t.dim);
    return;
  }
  tui.paragraph('Keep this window open until you finish: it’s serving the page. Ctrl-C stops it.', t.dim);
  tui.onInterrupt = () => { server.kill(); tui.restore(); tui.line(); tui.line(`${pad}${t.dim('Setup paused. Run')} macbuild setup ${t.dim('to pick up where you left off.')}`); process.exit(130); };
  const spin = tui.spinner({ label: () => `Waiting for you in the browser · ${flow.load().step}` });
  while (!flow.load().doneAt && server.exitCode === null) await sleep(1000);
  await sleep(4000); // long enough to see the last page
  server.kill();
  spin.stop('Setup finished in the browser');
  const state = flow.load();
  if (state.installUi) {
    state.installUi = false; flow.save();
    await tui.handoff({ argv: [join(ROOT, 'install-ui.sh')], cwd: ROOT, display: 'install-ui.sh  (dashboard and menu bar)' });
  }
  const job = state.buildRequest;
  if (!job) return;
  state.buildRequest = null; flow.save();
  // With the dashboard installed now, the build goes on its list; otherwise it runs here.
  for (let n = 0; n < 40 && !(await ping()); n += 1) await sleep(250);
  if (await ping()) {
    const build = await post('/api/builds', { project: job.app, profile: job.profile, platform: 'ios', install: job.install });
    if (build.id) { tui.line(`${pad}${t.ok('✓')} Building ${job.app}: http://127.0.0.1:${PORT}/#/build/${build.id}`); return; }
  }
  const argv = [BIN, job.app, '--profile', job.profile, ...(job.install ? ['--install'] : [])];
  process.exit(await tui.handoff({ argv, cwd: homedir(), display: `macbuild ${argv.slice(1).map(quote).join(' ')}` }));
}

// ---------- start ----------

let mode = opts.mode;
if (!mode) {
  tui.line();
  tui.line(brand());
  tui.line();
  if (opts.firstRun) {
    tui.paragraph('Welcome. macbuild builds your Expo apps on this Mac. Setup takes a few minutes: it finds your apps, checks your tools, sets up signing and tries a build.', t.dim);
    tui.line();
  }
  mode = await tui.select({
    label: 'Where do you want to set up?',
    options: [
      { value: 'cli', label: 'Here in the terminal', detail: 'A few questions, right here' },
      { value: 'web', label: 'In the browser', detail: 'The same steps on a web page' },
      ...(opts.firstRun ? [{ value: 'later', label: 'Not now', detail: 'Show the commands instead' }] : []),
    ],
    value: 'cli',
  });
  if (mode === 'later') {
    flow.state.skipped = true; flow.save();
    tui.line();
    tui.line(`${pad}macbuild setup             ${t.dim('set up any time')}`);
    tui.line(`${pad}macbuild add NAME FOLDER   ${t.dim('add an app (the folder with eas.json)')}`);
    tui.line(`${pad}macbuild NAME              ${t.dim('a development build')}`);
    tui.line(`${pad}macbuild --help            ${t.dim('everything else')}`);
    tui.line();
    process.exit(0);
  }
}
if (mode === 'web') await browser();
else await terminal();
tui.restore();
process.exit(0);
