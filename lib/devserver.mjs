// Local Expo dev servers: `npx expo start` for each project, run by the dashboard in a pseudo-terminal
// (lib/pty-bridge.py) so Expo's keys and prompts work. The dashboard page, `macbuild dev`, the MCP tools and remote
// clients with the dev scope all read the same output and press the same keys.
//
// It is Expo's terminal, not a shell: input goes to `expo start` and nothing else, and the command line is fixed here
// (npx expo start, a port, and one of four connection flags). Logs keep the raw output for the terminal view and a
// cleaned, numbered copy of each line, so an agent can ask for "everything after line 120" while it watches a change.
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = join(HERE, 'pty-bridge.py');
const FIRST_PORT = 8081;
const KEEP_SESSIONS = 20;
const KEEP_LINES = 5000;
const KEEP_RAW = 1 << 20;
const LIVE = ['starting', 'running', 'stopping'];

// What each connection means for the phone, and the flag it adds to `expo start`.
export const CONNECTIONS = {
  tailnet: { label: 'Tailscale', note: 'Your phone reaches this Mac over Tailscale, from anywhere.' },
  lan: { label: 'Same Wi-Fi', note: 'Your phone must be on the same network as this Mac.' },
  localhost: { label: 'This Mac only', note: 'For the iOS Simulator, Android emulator and web on this Mac.', flag: '--localhost' },
  tunnel: { label: 'Tunnel', note: 'Through Expo’s tunnel (ngrok). Slower, but works on any network.', flag: '--tunnel' },
};
// Keys an agent or a button can press by name. Single printable characters are sent as they are too, so Expo's own
// shortcuts (r, m, j, i, a, w, s, o, ?, shift+m as M) all work.
export const KEYS = {
  reload: 'r', menu: 'm', debugger: 'j', ios: 'i', android: 'a', web: 'w', switch: 's', editor: 'o', tools: 'M', help: '?',
  enter: '\r', return: '\r', up: '\x1b[A', down: '\x1b[B', left: '\x1b[D', right: '\x1b[C', tab: '\t', escape: '\x1b', space: ' ', backspace: '\x7f',
  yes: 'y', no: 'n', 'ctrl-c': '\x03',
};
export const KEY_LABELS = [
  ['reload', 'Reload', 'r'], ['menu', 'Dev menu', 'm'], ['debugger', 'Debugger', 'j'], ['ios', 'iOS Simulator', 'i'],
  ['android', 'Android', 'a'], ['web', 'Web on Mac', 'w'], ['switch', 'Expo Go / dev build', 's'], ['help', 'All keys', '?'],
];

// Terminal output to plain lines: colours and cursor moves removed, a line redrawn in place (Metro's progress bar) kept
// as its last state, and the QR code's block characters dropped.
export function cleanLine(text) {
  const parts = text.replace(/\x1b\[[0-9;]*[GK]/g, '\r').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '').split('\r').filter((part) => part.trim());
  const line = (parts.pop() ?? '').trimEnd();
  return /^[\s▀▄█▐▌]+$/.test(line) ? '' : line;
}

const read = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
function resolveFrom(dir, name) {
  try { return createRequire(join(dir, 'package.json')).resolve(`${name}/package.json`); } catch { return null; }
}
// The lockfile nearest the app, up to the repository's root: which package manager installs it, and from where.
function packageManager(dir) {
  const lockfiles = [['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['package-lock.json', 'npm']];
  for (let at = resolve(dir); ; at = dirname(at)) {
    const found = lockfiles.find(([file]) => existsSync(join(at, file)));
    if (found) return { name: found[1], root: at };
    if (existsSync(join(at, '.git')) || dirname(at) === at || at === homedir()) return { name: 'npm', root: resolve(dir) };
  }
}
const INSTALL = { npm: 'npm install', pnpm: 'pnpm install', yarn: 'yarn install', bun: 'bun install' };

// Can this project run a dev server here? Only the file system: no network, no child processes, so the projects page
// can ask for every project at once.
export function readiness(project, { builds = [] } = {}) {
  const { dir } = project;
  const checks = [];
  const add = (id, label, ok, detail, fix = '', level = ok ? 'ok' : 'bad') => checks.push({ id, label, ok, level, detail, fix });
  const pkg = read(join(dir, 'package.json'));
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const pm = packageManager(dir);
  const installCommand = `${relative(dir, pm.root) ? `cd ${pm.root} && ` : ''}${INSTALL[pm.name]}`;
  add('package', 'package.json', Boolean(pkg), pkg ? `${pkg.name ?? 'app'}${pkg.version ? ` ${pkg.version}` : ''}` : 'No package.json in this folder');
  const expoFile = pkg ? resolveFrom(dir, 'expo') : null;
  const expoVersion = expoFile ? read(expoFile)?.version : null;
  if (pkg) {
    if (!deps.expo) add('expo', 'Expo', false, 'expo isn’t in package.json, so `expo start` can’t run here', '');
    else add('expo', 'Expo installed', Boolean(expoVersion), expoVersion ? `expo ${expoVersion}` : `Dependencies aren’t installed (${pm.name})`, expoVersion ? '' : installCommand);
  }
  const devClient = Boolean(deps['expo-dev-client']);
  const devClientInstalled = devClient && Boolean(resolveFrom(dir, 'expo-dev-client'));
  const web = Boolean(deps['react-native-web'] && deps['react-dom']);
  if (pkg && deps.expo) {
    add('target', 'Opens in', true, devClient ? 'Your development build (expo-dev-client)' : 'Expo Go', '', 'info');
    if (devClient && expoVersion && !devClientInstalled) add('dev-client', 'expo-dev-client installed', false, 'In package.json but not installed', installCommand);
    const devBuild = builds.find((build) => build.project === project.name && build.status === 'success' && build.devClient && !build.expired);
    if (devClient) add('dev-build', 'Development build', Boolean(devBuild), devBuild ? `Built ${new Date(devBuild.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}${devBuild.simulator ? ' for the Simulator' : ''}` : 'None built here yet. Metro runs without one, but there’s nothing on the phone to open it.', '', devBuild ? 'ok' : 'warn');
    add('web', 'Web', true, web ? 'react-native-web is installed: opens in a browser' : 'No web support (react-native-web)', '', 'info');
  }
  const blocking = checks.filter((check) => check.level === 'bad');
  const counted = checks.filter((check) => check.level !== 'info');
  return {
    ok: blocking.length === 0, level: blocking.length ? 'blocked' : checks.some((check) => check.level === 'warn') ? 'warn' : 'ready',
    summary: blocking.length ? (blocking[0].fix ? 'Install dependencies first' : blocking[0].detail) : 'Ready to run',
    passed: counted.filter((check) => check.ok).length, total: counted.length,
    checks, devClient, web, packageManager: pm.name, installCommand, expo: expoVersion,
  };
}

// The command, exactly as it runs. The environment variable only for Tailscale: it makes Expo put the Mac's tailnet
// name in the links and the QR code instead of its Wi-Fi address.
export function commandFor({ dir, port, connection, host, clear }) {
  const args = ['expo', 'start', '--port', String(port)];
  if (CONNECTIONS[connection]?.flag) args.push(CONNECTIONS[connection].flag);
  if (clear) args.push('--clear');
  const env = connection === 'tailnet' && host ? { REACT_NATIVE_PACKAGER_HOSTNAME: host } : {};
  const shown = `cd ${dir.startsWith(homedir()) ? `~${dir.slice(homedir().length)}` : dir} && ${Object.entries(env).map(([key, value]) => `${key}=${value} `).join('')}npx ${args.join(' ')}`;
  return { file: 'npx', args, env, shown };
}

const portTaken = (port) => new Promise((done) => {
  const socket = connect({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => {
    const probe = createServer();
    probe.once('error', () => done(true));
    probe.listen(port, '0.0.0.0', () => probe.close(() => done(false)));
  });
  socket.setTimeout(800, () => { socket.destroy(); done(false); });
});

// Reading Expo's output: links, readiness, bundling progress per platform, errors and the prompt it's waiting on.
const PLATFORM = { ios: 'iOS', android: 'Android', web: 'Web' };
// A partial line (the cursor is still on it) only moves progress: a link cut off mid-chunk would be wrong for a moment.
export function parseLine(session, line, partial = false) {
  const changes = [];
  const set = (key, value) => { if (JSON.stringify(session[key]) !== JSON.stringify(value)) { session[key] = value; changes.push(key); } };
  let match = line.match(/\b(iOS|Android|Web)\b.*?(?:Bundling|[▓░]).*?(\d{1,3}(?:\.\d+)?)%/);
  if (match && !/Bundled|failed/.test(line)) set('bundles', { ...session.bundles, [match[1].toLowerCase()]: { percent: Math.min(100, Number(match[2])), at: Date.now() } });
  if (partial) return changes;
  match = line.match(/Metro waiting on (\S+)/);
  if (match) set('urls', { ...session.urls, app: match[1] });
  match = line.match(/Web is waiting on (https?:\/\/\S+)/);
  if (match) set('urls', { ...session.urls, web: match[1] });
  match = line.match(/(?:Waiting on|waiting on) https?:\/\/[^:/\s]+:(\d+)/);
  if (match && Number(match[1]) !== session.port) set('port', Number(match[1]));
  if (/Metro waiting on|Waiting on http|Logs for your project will appear below/.test(line) && session.status === 'starting') {
    set('status', 'running'); set('readyAt', Date.now());
  }
  match = line.match(/\b(iOS|Android|Web) Bundled (\d+)ms(?:\s+(\S+))?(?:\s+\((\d+) modules\))?/);
  if (match) set('bundles', { ...session.bundles, [match[1].toLowerCase()]: { percent: 100, done: true, ms: Number(match[2]), entry: match[3] ?? '', modules: Number(match[4] ?? 0), at: Date.now() } });
  match = line.match(/\b(iOS|Android|Web) Bundling failed(?: (\d+)ms)?/);
  if (match) set('bundles', { ...session.bundles, [match[1].toLowerCase()]: { failed: true, ms: Number(match[2] ?? 0), at: Date.now() } });
  if (/^\s*(ERROR\b|Error:|CommandError:|SyntaxError:|TypeError:|Unable to resolve)/.test(line)) set('lastError', { text: line.trim().slice(0, 500), at: Date.now() });
  if (/^\s*[✔✖√×]/.test(line) && session.prompt) set('prompt', null);
  return changes;
}
// The prompt on screen, from the line the cursor is on (a prompt waits there, without a newline) and, for a list to
// choose from, the lines just above it. A line starting with ✔ or ✖ is a prompt's answer: nothing is waiting then.
export function parsePrompt(session, partial) {
  const recent = [...session.lines.slice(-14).map((item) => item.text), partial].filter(Boolean);
  const last = partial;
  const confirm = last && last.match(/^\s*\??\s*(.+?)\s*(?:›\s*)?(\(Y\/n\)|\(y\/N\)|\[Y\/n\]|\[y\/N\])\s*(?:›\s*)?$/);
  if (confirm) return { kind: 'confirm', text: confirm[1].replace(/^\?\s*/, '').replace(/\s*›$/, ''), default: /Y/.test(confirm[2]) ? 'yes' : 'no' };
  const head = recent.map((text, index) => ({ text, index })).reverse().find((item) => /Use arrow-keys|Return to submit/.test(item.text));
  const after = head ? recent.slice(head.index + 1) : [];
  if (head && after.length <= 12 && !after.some((text) => /^\s*[✔✖√×]/.test(text)) && partial) {
    const options = [];
    for (const text of after) {
      const option = text.match(/^\s*([❯>›●○◉◯]?)\s*(.+?)\s*$/);
      if (!option) break;
      const label = option[2].replace(/^[-–]\s+/, '');
      if (label && !options.some((item) => item.label === label)) options.push({ label, selected: /[❯>●◉]/.test(option[1]) });
    }
    if (options.length) return { kind: 'select', text: head.text.replace(/^\s*\?\s*/, '').replace(/\s*›.*$/, ''), options: options.slice(0, 12) };
  }
  const text = last && last.match(/^\s*\?\s*(.+?)\s*›\s*(.*)$/);
  if (text) return { kind: 'text', text: text[1], value: text[2] };
  return null;
}

const publicSession = (session) => {
  if (!session) return null;
  const { child, raw, rawBytes, lines, partial, listeners, file, waiters, stream, timer, base, ...rest } = session;
  return { ...rest, lineCount: (session.base ?? 0) + (session.lines?.length ?? 0), uptime: session.startedAt && LIVE.includes(session.status) ? Date.now() - session.startedAt : 0 };
};

export class DevServers {
  // projects(): [{ name, dir }]; builds(): build history, newest first; tailnetHost(): this Mac's tailnet name or ''.
  constructor({ dir = join(homedir(), '.local/share/macbuild/dev'), projects, builds = () => [], tailnetHost = () => '', python = 'python3', env = process.env, onChange = () => {} }) {
    Object.assign(this, { dir, projects, builds, tailnetHost, python, env, onChange });
    this.sessions = new Map();
    mkdirSync(dir, { recursive: true });
    this.state = read(join(dir, 'state.json')) ?? { projects: {} };
    this.recover();
  }
  // Soon: Metro redraws its progress many times a second, and each redraw can change a session.
  saveSoon() { this.saveTimer ??= setTimeout(() => { this.saveTimer = null; this.save(); }, 500); }
  save() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    const file = join(this.dir, 'state.json');
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`);
    renameSync(temp, file);
  }
  entry(name) { return (this.state.projects[name] ??= { options: {}, history: [] }); }
  // A dashboard that stopped took its terminals with it (the bridge stops Metro when its stdin closes). Anything still
  // recorded as live is marked stopped; a bridge that somehow outlived it is stopped by its pid, if it's still ours.
  recover() {
    for (const [name, entry] of Object.entries(this.state.projects)) {
      const last = entry.history[0];
      if (!last || !LIVE.includes(last.status)) continue;
      if (last.pid) {
        try {
          const command = execFileSync('ps', ['-o', 'command=', '-p', String(last.pid)], { encoding: 'utf8' });
          if (command.includes('pty-bridge.py')) process.kill(last.pid, 'SIGTERM');
        } catch {}
      }
      Object.assign(last, { status: 'stopped', stoppedAt: Date.now(), reason: 'The dashboard restarted, which stopped this dev server.' });
      delete last.pid;
      this.entry(name);
    }
    this.save();
  }
  project(name) {
    const project = this.projects().find((item) => item.name === name);
    if (!project) throw Object.assign(new Error('Unknown project.'), { status: 404 });
    return project;
  }
  session(name) {
    const live = this.sessions.get(name);
    if (live) return live;
    const last = this.state.projects[name]?.history[0];
    return last ? { ...last, lines: [], base: 0 } : null;
  }
  readiness(name) { return readiness(this.project(name), { builds: this.builds() }); }
  defaults(name) {
    const host = this.tailnetHost();
    const saved = this.state.projects[name]?.options ?? {};
    return { connection: CONNECTIONS[saved.connection] && (saved.connection !== 'tailnet' || host) ? saved.connection : host ? 'tailnet' : 'lan', host };
  }
  // Everything the project page needs.
  view(name) {
    const project = this.project(name);
    const live = this.sessions.get(name);
    const ready = readiness(project, { builds: this.builds() });
    const options = this.defaults(name);
    return {
      project: name, dir: project.dir, readiness: ready, session: publicSession(this.session(name)),
      options, connections: Object.entries(CONNECTIONS).map(([id, item]) => ({ id, ...item, available: id !== 'tailnet' || Boolean(options.host) })),
      command: live?.command ?? commandFor({ dir: project.dir, port: this.state.projects[name]?.history[0]?.port ?? FIRST_PORT, connection: options.connection, host: options.host }).shown,
      keys: KEY_LABELS.map(([id, label, key]) => ({ id, label, key })),
      history: (this.state.projects[name]?.history ?? []).slice(0, 10).map(publicSession),
    };
  }
  // One line per project, for the projects page, the sidebar and `macbuild dev`.
  list() {
    const builds = this.builds();
    return this.projects().map((project) => {
      const session = publicSession(this.session(project.name));
      const ready = readiness(project, { builds });
      return { project: project.name, status: session && LIVE.includes(session.status) ? session.status : 'stopped', port: session?.port ?? null, urls: session?.urls ?? {}, prompt: session?.prompt ?? null,
        readiness: { ok: ready.ok, level: ready.level, summary: ready.summary, passed: ready.passed, total: ready.total }, since: session?.startedAt ?? null, session: session?.id ?? null };
    });
  }
  running() { return [...this.sessions.values()].filter((session) => LIVE.includes(session.status)).map(publicSession); }

  async start(name, { connection, clear = false, port, cols = 100, rows = 32 } = {}, by = null) {
    const project = this.project(name);
    const current = this.sessions.get(name);
    if (current && LIVE.includes(current.status)) return publicSession(current);
    const ready = readiness(project, { builds: this.builds() });
    if (!ready.ok) throw Object.assign(new Error(`${ready.summary}${ready.checks.find((check) => check.level === 'bad')?.fix ? `: ${ready.checks.find((check) => check.level === 'bad').fix}` : ''}`), { status: 409 });
    const defaults = this.defaults(name);
    connection = connection ?? defaults.connection;
    if (!CONNECTIONS[connection]) throw Object.assign(new Error(`Connection is one of ${Object.keys(CONNECTIONS).join(', ')}.`), { status: 400 });
    if (connection === 'tailnet' && !defaults.host) throw Object.assign(new Error('Tailscale isn’t running on this Mac. Choose Same Wi-Fi, or sign in to Tailscale.'), { status: 409 });
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw Object.assign(new Error('Port must be between 1024 and 65535.'), { status: 400 });
    const taken = new Set([...this.sessions.values()].filter((item) => LIVE.includes(item.status)).map((item) => item.port));
    let chosen = port ?? this.state.projects[name]?.history[0]?.port ?? FIRST_PORT;
    for (let tries = 0; taken.has(chosen) || await portTaken(chosen); tries += 1) {
      if (port !== undefined) throw Object.assign(new Error(`Port ${port} is in use.`), { status: 409 });
      if (tries > 40) throw Object.assign(new Error('No free port between 8081 and 8121.'), { status: 409 });
      chosen = FIRST_PORT + ((chosen - FIRST_PORT + 1) % 41);
    }
    const command = commandFor({ dir: project.dir, port: chosen, connection, host: defaults.host, clear });
    const id = `dev-${Date.now().toString(36)}`;
    const folder = join(this.dir, name.replace(/[^\w.-]/g, '_'));
    mkdirSync(folder, { recursive: true });
    const size = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);
    const session = {
      id, project: name, status: 'starting', port: chosen, connection, host: connection === 'tailnet' ? defaults.host : '', clear: Boolean(clear), command: command.shown,
      target: ready.devClient ? 'development build' : 'Expo Go', web: ready.web, startedAt: Date.now(), readyAt: null, stoppedAt: null, exitCode: null, reason: '',
      by: by ?? null, urls: {}, bundles: {}, prompt: null, lastError: null, cols: size(cols, 20, 400, 100), rows: size(rows, 5, 200, 32),
      raw: [], rawBytes: 0, lines: [], base: 0, partial: '', listeners: new Set(), waiters: new Set(), file: join(folder, `${id}.log`),
    };
    const env = { ...this.env, ...command.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1', EXPO_NO_TELEMETRY: this.env.EXPO_NO_TELEMETRY ?? '1' };
    delete env.CI; // Expo turns off its keys and prompts in CI
    session.stream = createWriteStream(session.file, { flags: 'a' });
    session.child = spawn(this.python, ['-I', BRIDGE, String(session.cols), String(session.rows), command.file, ...command.args], { cwd: project.dir, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    session.pid = session.child.pid;
    session.child.stdin.on('error', () => {});
    session.child.stdio[3].on('error', () => {});
    session.child.stdout.on('data', (chunk) => this.output(session, chunk));
    session.child.stderr.on('data', (chunk) => this.output(session, chunk));
    session.child.on('error', (error) => { this.output(session, Buffer.from(`\r\nmacbuild: could not start the terminal (${this.python}): ${error.message}\r\n`)); session.reason = `Could not start ${this.python}: ${error.message}`; this.exited(session, 127); });
    session.child.on('close', (code) => this.exited(session, code));
    this.sessions.set(name, session);
    const entry = this.entry(name);
    entry.options = { connection };
    entry.history.unshift(publicSession(session));
    for (const old of entry.history.splice(KEEP_SESSIONS)) rmSync(join(folder, `${old.id}.log`), { force: true });
    this.record(session, true);
    this.emit(session, 'state');
    return publicSession(session);
  }
  record(session, now = false) {
    const entry = this.entry(session.project);
    const index = entry.history.findIndex((item) => item.id === session.id);
    const { lineCount, uptime, ...saved } = publicSession(session);
    if (index >= 0) entry.history[index] = saved;
    if (now) this.save(); else this.saveSoon();
  }
  output(session, chunk) {
    session.stream?.write(chunk);
    session.raw.push(chunk); session.rawBytes += chunk.length;
    while (session.rawBytes > KEEP_RAW && session.raw.length > 1) session.rawBytes -= session.raw.shift().length;
    const text = session.partial + chunk.toString('utf8');
    const pieces = text.split('\n');
    session.partial = pieces.pop();
    if (session.partial.length > 8192) session.partial = session.partial.slice(-8192);
    const changed = new Set();
    for (const piece of pieces) {
      const line = cleanLine(piece);
      if (!line) continue;
      session.lines.push({ n: session.base + session.lines.length + 1, at: Date.now(), text: line });
      for (const key of parseLine(session, line)) changed.add(key);
    }
    if (session.lines.length > KEEP_LINES) { const drop = session.lines.length - KEEP_LINES; session.lines.splice(0, drop); session.base += drop; }
    const partial = cleanLine(session.partial);
    if (partial) for (const key of parseLine(session, partial, true)) changed.add(key);
    const prompt = parsePrompt(session, partial);
    if (JSON.stringify(prompt) !== JSON.stringify(session.prompt)) { session.prompt = prompt; changed.add('prompt'); }
    for (const listener of session.listeners) listener('data', chunk);
    if (pieces.length) for (const waiter of session.waiters) waiter();
    if (changed.size) { this.record(session); this.emit(session, 'state'); }
  }
  exited(session, code) {
    if (session.stoppedAt) return;
    session.exitCode = code ?? 1;
    session.stoppedAt = Date.now();
    const asked = session.status === 'stopping';
    session.status = asked || code === 0 || code === 130 || code === 143 ? 'stopped' : 'failed';
    if (session.status === 'failed' && !session.reason) session.reason = session.lastError?.text ?? `expo start exited with code ${code}`;
    session.prompt = null;
    delete session.pid;
    session.stream?.end();
    clearTimeout(session.timer);
    this.record(session, true);
    this.emit(session, 'state');
    for (const listener of session.listeners) listener('exit', session.exitCode);
    for (const waiter of session.waiters) waiter();
  }
  emit(session, type) { this.onChange(session.project, type); for (const listener of session.listeners) listener(type, publicSession(session)); }
  stop(name) {
    const session = this.sessions.get(name);
    this.project(name);
    if (!session || !LIVE.includes(session.status)) return publicSession(this.session(name));
    if (session.status !== 'stopping') {
      session.status = 'stopping';
      // Ctrl-C first, the way Expo expects to be stopped, then the bridge stops the whole process group.
      try { session.child.stdin.write('\x03'); } catch {}
      session.timer = setTimeout(() => { try { session.child.kill('SIGTERM'); } catch {} }, 3000);
      this.record(session);
      this.emit(session, 'state');
    }
    return publicSession(session);
  }
  // Stop, wait for Expo to exit (it can take a few seconds to close its watchers), then start again with the same
  // connection, unless new options say otherwise.
  async restart(name, options = {}, by = null) {
    const before = this.session(name);
    this.stop(name);
    for (let waited = 0; LIVE.includes(this.sessions.get(name)?.status) && waited < 8000; waited += 100) await new Promise((done) => { setTimeout(done, 100); });
    if (LIVE.includes(this.sessions.get(name)?.status)) throw Object.assign(new Error('The dev server didn’t stop in time.'), { status: 409 });
    return this.start(name, { connection: before?.connection, port: undefined, ...options }, by);
  }
  stopAll() { for (const session of this.sessions.values()) if (LIVE.includes(session.status)) { try { session.child.kill('SIGTERM'); } catch {} } }
  // Input: a named key (KEYS), a single character, or text (with Enter unless enter is false). Prompt answers clear
  // the prompt at once, so the page doesn't show buttons for a question already answered.
  input(name, { key, text, enter = true } = {}) {
    const session = this.sessions.get(name);
    this.project(name);
    if (!session || !['starting', 'running'].includes(session.status)) throw Object.assign(new Error('The dev server isn’t running.'), { status: 409 });
    let data;
    if (typeof key === 'string' && key) {
      data = KEYS[key.toLowerCase()] ?? (key.length === 1 && key >= ' ' && key <= '~' ? key : null);
      if (!data) throw Object.assign(new Error(`Unknown key ${key}. Keys: ${Object.keys(KEYS).join(', ')} or one character.`), { status: 400 });
    } else if (typeof text === 'string') {
      if (text.length > 2000 || /[\x00-\x08\x0b-\x1f]/.test(text.replace(/\x1b\[[ABCD]/g, '').replace(/[\r\n\t\x03\x1b]/g, ''))) throw Object.assign(new Error('Text is limited to 2000 printable characters.'), { status: 400 });
      data = enter && !/[\r\n]$/.test(text) ? `${text}\r` : text;
    } else throw Object.assign(new Error('Send a key or text.'), { status: 400 });
    session.child.stdin.write(data);
    if (session.prompt && (/^[\ryn\x03]$/i.test(data) || data.endsWith('\r'))) { session.prompt = null; this.emit(session, 'state'); }
    return { sent: data.length, session: publicSession(session) };
  }
  // What a select prompt's option needs: arrow presses from the highlighted option to the chosen one, then Enter.
  choose(name, index) {
    const session = this.sessions.get(name);
    const options = session?.prompt?.options;
    if (!options || !Number.isInteger(index) || index < 0 || index >= options.length) throw Object.assign(new Error('No such option.'), { status: 400 });
    const from = Math.max(0, options.findIndex((option) => option.selected));
    const moves = (index > from ? KEYS.down : KEYS.up).repeat(Math.abs(index - from));
    return this.input(name, { text: `${moves}\r`, enter: false });
  }
  resize(name, cols, rows) {
    const session = this.sessions.get(name);
    if (!session || !LIVE.includes(session.status) || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 400 || rows < 5 || rows > 200) return false;
    session.cols = cols; session.rows = rows;
    try { session.child.stdio[3].write(`${cols} ${rows}\n`); } catch {}
    return true;
  }
  // Live output for the terminal view: what's on screen so far, then each chunk and state change.
  subscribe(name, listener) {
    const session = this.sessions.get(name);
    if (!session) return { replay: [], unsubscribe: () => {}, live: false };
    session.listeners.add(listener);
    return { replay: session.raw.slice(), live: LIVE.includes(session.status), unsubscribe: () => session.listeners.delete(listener) };
  }
  // Cleaned lines after line `since` (1-based numbers, as each line carries), or the last `tail` lines. With wait, holds
  // the request until there are new lines or the server stops, up to that many milliseconds: an agent watching a change
  // asks again with `next` instead of polling.
  async log(name, { since, tail = 200, wait = 0 } = {}) {
    this.project(name);
    let session = this.session(name);
    const pick = () => {
      if (!session) return { project: name, session: null, lines: [], next: 0, status: 'stopped' };
      let lines = session.lines;
      if (!lines.length && !this.sessions.has(name) && session.id) lines = this.savedLines(session);
      const shown = Number.isInteger(since) && since >= 0 ? lines.filter((line) => line.n > since).slice(0, 2000) : lines.slice(-Math.max(1, Math.min(2000, tail)));
      const last = lines[lines.length - 1]?.n ?? since ?? 0;
      return { project: name, session: session.id, status: session.status, prompt: session.prompt ?? null, lines: shown, next: shown.length ? shown[shown.length - 1].n : Math.max(since ?? 0, last), truncated: Number.isInteger(since) && since < (session.base ?? 0) };
    };
    let result = pick();
    if (wait > 0 && !result.lines.length && session && LIVE.includes(session.status) && !session.prompt) {
      await new Promise((done) => {
        const live = this.sessions.get(name);
        const finish = () => { clearTimeout(timer); live?.waiters.delete(finish); done(); };
        const timer = setTimeout(finish, Math.min(wait, 60000));
        live?.waiters.add(finish);
      });
      session = this.session(name);
      result = pick();
    }
    return result;
  }
  savedLines(session) {
    const file = join(this.dir, session.project.replace(/[^\w.-]/g, '_'), `${session.id}.log`);
    if (!existsSync(file)) return [];
    const size = statSync(file).size;
    const text = readFileSync(file).subarray(Math.max(0, size - 400000)).toString('utf8');
    return text.split('\n').map(cleanLine).filter(Boolean).map((line, index) => ({ n: index + 1, at: session.stoppedAt ?? 0, text: line }));
  }
  rawLog(name, id) {
    const session = id ? (this.state.projects[name]?.history ?? []).find((item) => item.id === id) : this.session(name);
    if (!session) return null;
    const file = join(this.dir, name.replace(/[^\w.-]/g, '_'), `${session.id}.log`);
    return existsSync(file) ? { id: session.id, text: readFileSync(file, 'utf8') } : null;
  }
  // Session logs for projects that left projects.conf.
  prune() {
    const known = new Set(this.projects().map((project) => project.name.replace(/[^\w.-]/g, '_')));
    for (const folder of readdirSync(this.dir)) if (folder !== 'state.json' && !known.has(folder) && !folder.endsWith('.tmp')) rmSync(join(this.dir, folder), { recursive: true, force: true });
  }
}
