// Local Expo dev servers: `npx expo start` for each project, run by the dashboard in a pseudo-terminal
// (lib/pty-bridge.py) so Expo's keys and prompts work. The dashboard page, `macbuild dev`, the MCP tools and remote
// clients with the dev scope all read the same output and press the same keys.
//
// It is Expo's terminal, not a shell: input goes to `expo start` and nothing else, and the command line is fixed here
// (npx expo start, a port, and one of four connection flags). Logs keep the raw output for the terminal view and a
// cleaned, numbered copy of each line, so an agent can ask for "everything after line 120" while it watches a change.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { metroHook } from './metro-hook.mjs';

const exec = promisify(execFile);
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
  const hook = metroHook(dir);
  if (pkg && deps.expo) {
    add('target', 'Opens in', true, devClient ? 'Your development build (expo-dev-client)' : 'Expo Go', '', 'info');
    if (devClient && expoVersion && !devClientInstalled) add('dev-client', 'expo-dev-client installed', false, 'In package.json but not installed', installCommand);
    const devBuild = builds.find((build) => build.project === project.name && build.status === 'success' && build.devClient && !build.expired);
    if (devClient) add('dev-build', 'Development build', Boolean(devBuild), devBuild ? `Built ${new Date(devBuild.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}${devBuild.simulator ? ' for the Simulator' : ''}` : 'None built here yet. Metro runs without one, but there’s nothing on the phone to open it.', '', devBuild ? 'ok' : 'warn');
    add('web', 'Web', true, web ? 'react-native-web is installed: opens in a browser' : 'No web support (react-native-web)', '', 'info');
    add('hook', 'From your terminal', true, hook.present ? `npx expo start in a terminal shows here in full (${hook.name})` : `Not set up: one started in a terminal shows here only in part. Add macbuild's line to ${hook.name} for all of it.`, '', 'info');
  }
  const blocking = checks.filter((check) => check.level === 'bad');
  const counted = checks.filter((check) => check.level !== 'info');
  return {
    ok: blocking.length === 0, level: blocking.length ? 'blocked' : checks.some((check) => check.level === 'warn') ? 'warn' : 'ready',
    summary: blocking.length ? (blocking[0].fix ? 'Install dependencies first' : blocking[0].detail) : 'Ready to run',
    passed: counted.filter((check) => check.ok).length, total: counted.length,
    checks, devClient, web, packageManager: pm.name, installCommand, expo: expoVersion, hook: { present: hook.present, name: hook.name, line: hook.line },
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

// Dev servers started outside macbuild, in a terminal: `npx expo start`, `npm start` or `yarn expo start` (whatever runs
// `expo start` or `react-native start`), in one of the projects' folders. macbuild can't read that terminal, but Metro
// is a web server: /status says it's up, /events streams its bundles and the app's console, /message reaches the apps
// (reload, dev menu, as Expo's r and m do), /json/list names the connected phones.
export const DEV_COMMAND = /(?:^|[\s/])(?:expo|react-native)(?:\/bin\/cli(?:\.js)?)?\s+start(?=\s|$)/;
export function elapsed(text) { // ps etime: [[dd-]hh:]mm:ss
  const match = String(text).trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  return match ? ((Number(match[1] ?? 0) * 24 + Number(match[2] ?? 0)) * 60 + Number(match[3])) * 60 + Number(match[4]) : 0;
}
export async function processes() {
  const { stdout } = await exec('ps', ['-e', '-ww', '-o', 'pid=,ppid=,etime=,args='], { maxBuffer: 1 << 24, timeout: 5000 });
  return stdout.split('\n').map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, etime, args]) => ({ pid: Number(pid), ppid: Number(ppid), age: elapsed(etime), args }));
}
async function cwdOf(pid) {
  try { return realpathSync(readlinkSync(`/proc/${pid}/cwd`)); } catch {}
  try {
    const { stdout } = await exec('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 4000 });
    const line = stdout.split('\n').find((item) => item.startsWith('n'));
    return line ? realpathSync(line.slice(1)) : null;
  } catch { return null; }
}
async function portsOf(pid) {
  try {
    const { stdout } = await exec('lsof', ['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-P', '-n', '-Fn'], { timeout: 4000 });
    return [...new Set(stdout.split('\n').map((line) => Number(line.match(/^n.*:(\d+)$/)?.[1])).filter(Boolean))];
  } catch { return []; }
}
const metroAt = async (port) => {
  try { return (await (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1200) })).text()).includes('packager-status:running'); } catch { return false; }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
function lanAddress() {
  for (const list of Object.values(networkInterfaces())) for (const item of list ?? []) if (item.family === 'IPv4' && !item.internal) return item.address;
  return '';
}
// Metro's reporter events as the lines Expo would print, so the log, parseLine and `macbuild dev wait` read them alike.
const LEVELS = { log: 'LOG', info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG', trace: 'TRACE', group: 'LOG', groupCollapsed: 'LOG' };
export function eventText(event, builds) {
  const platform = (details) => PLATFORM[details?.platform] ?? (details?.platform ? String(details.platform) : 'Bundle');
  const redraw = '\x1b[2K\x1b[1G';
  const build = builds.get(event.buildID);
  switch (event.type) {
    case 'bundle_build_started':
      builds.set(event.buildID, { at: Date.now(), platform: platform(event.bundleDetails), entry: String(event.bundleDetails?.entryFile ?? '').replace(/^.*\/node_modules\//, 'node_modules/'), total: 0 });
      return `${redraw}${platform(event.bundleDetails)} Bundling   0.0%`;
    case 'bundle_transform_progressed':
      if (!build || !event.totalFileCount) return '';
      build.total = event.totalFileCount;
      return `${redraw}${build.platform} Bundling ${((100 * event.transformedFileCount) / event.totalFileCount).toFixed(1).padStart(5)}% (${event.transformedFileCount}/${event.totalFileCount})`;
    case 'bundle_build_done':
      builds.delete(event.buildID);
      return build ? `${redraw}${build.platform} Bundled ${Date.now() - build.at}ms ${build.entry}${build.total ? ` (${build.total} modules)` : ''}\r\n` : '';
    case 'bundle_build_failed':
      builds.delete(event.buildID);
      return `${redraw}${build?.platform ?? 'Bundle'} Bundling failed${build ? ` ${Date.now() - build.at}ms ${build.entry}` : ''}\r\n`;
    case 'bundling_error': case 'hmr_client_error': {
      const message = String(event.error?.message ?? event.error ?? 'Bundling error').split('\n').slice(0, 20).join('\r\n    ');
      return `ERROR  ${event.type === 'hmr_client_error' ? 'Fast Refresh: ' : ''}${message}\r\n`;
    }
    case 'client_log': {
      const data = (Array.isArray(event.data) ? event.data : [event.data]).map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ');
      return ` ${(LEVELS[event.level] ?? 'LOG').padEnd(5)} ${data.slice(0, 4000).replace(/\n/g, '\r\n')}\r\n`;
    }
    default: return '';
  }
}

const publicSession = (session) => {
  if (!session) return null;
  const { child, raw, rawBytes, lines, partial, listeners, file, waiters, stream, timer, base, socket, builds, conn, candidates, lastByte, ...rest } = session;
  return { ...rest, lineCount: (session.base ?? 0) + (session.lines?.length ?? 0), uptime: session.startedAt && LIVE.includes(session.status) ? Date.now() - session.startedAt : 0 };
};

export class DevServers {
  // projects(): [{ name, dir }]; builds(): build history, newest first; tailnetHost(): this Mac's tailnet name or ''.
  constructor({ dir = join(homedir(), '.local/share/macbuild/dev'), projects, builds = () => [], tailnetHost = () => '', python = 'python3', env = process.env, onChange = () => {} }) {
    Object.assign(this, { dir, projects, builds, tailnetHost, python, env, onChange });
    this.sessions = new Map();
    this.external = new Map(); // project -> a session found running in a terminal, followed through Metro
    this.hooked = new Map(); // project -> a session started in a terminal whose metro.config.js has macbuild's hook
    this.ignored = new Set(); // pids of expo processes outside every project folder
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
      // One found in a terminal keeps running there; the next scan attaches to it again.
      Object.assign(last, { status: 'stopped', stoppedAt: Date.now(), reason: last.external || last.terminal ? '' : 'The dashboard restarted, which stopped this dev server.' });
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
  // The session that's live now: macbuild's own, else one found in a terminal; else macbuild's last one still in memory.
  current(name) {
    const own = this.sessions.get(name);
    if (own && LIVE.includes(own.status)) return own;
    return this.hooked.get(name) ?? this.external.get(name) ?? own ?? null;
  }
  session(name) {
    const live = this.current(name);
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
    const live = this.current(name);
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
      return { project: project.name, status: session && LIVE.includes(session.status) ? session.status : 'stopped', external: Boolean(session?.external && LIVE.includes(session.status)), terminal: Boolean(session?.terminal && LIVE.includes(session.status)), port: session?.port ?? null, urls: session?.urls ?? {}, prompt: session?.prompt ?? null,
        readiness: { ok: ready.ok, level: ready.level, summary: ready.summary, passed: ready.passed, total: ready.total }, since: session?.startedAt ?? null, session: session?.id ?? null };
    });
  }
  running() { return [...this.sessions.values(), ...this.hooked.values(), ...this.external.values()].filter((session) => LIVE.includes(session.status)).map(publicSession); }

  async start(name, { connection, clear = false, port, cols = 100, rows = 32 } = {}, by = null) {
    const project = this.project(name);
    const current = this.current(name);
    if (current?.hooked && LIVE.includes(current.status)) throw Object.assign(new Error(`${name}'s dev server is already running in a terminal on port ${current.port}, and shows here in full.`), { status: 409 });
    if (current?.external && LIVE.includes(current.status)) throw Object.assign(new Error(`${name}'s dev server is already running in a terminal on port ${current.port}. Use it as it is, or run it here instead (take over).`), { status: 409 });
    if (current && LIVE.includes(current.status)) return publicSession(current);
    const ready = readiness(project, { builds: this.builds() });
    if (!ready.ok) throw Object.assign(new Error(`${ready.summary}${ready.checks.find((check) => check.level === 'bad')?.fix ? `: ${ready.checks.find((check) => check.level === 'bad').fix}` : ''}`), { status: 409 });
    const defaults = this.defaults(name);
    connection = connection ?? defaults.connection;
    if (!CONNECTIONS[connection]) throw Object.assign(new Error(`Connection is one of ${Object.keys(CONNECTIONS).join(', ')}.`), { status: 400 });
    if (connection === 'tailnet' && !defaults.host) throw Object.assign(new Error('Tailscale isn’t running on this Mac. Choose Same Wi-Fi, or sign in to Tailscale.'), { status: 409 });
    if (port !== undefined && (!Number.isInteger(port) || port < 1024 || port > 65535)) throw Object.assign(new Error('Port must be between 1024 and 65535.'), { status: 400 });
    const taken = new Set([...this.sessions.values(), ...this.hooked.values(), ...this.external.values()].filter((item) => LIVE.includes(item.status)).map((item) => item.port));
    let chosen = port ?? this.state.projects[name]?.history[0]?.port ?? FIRST_PORT;
    for (let tries = 0; taken.has(chosen) || await portTaken(chosen); tries += 1) {
      if (port !== undefined) throw Object.assign(new Error(`Port ${port} is in use.`), { status: 409 });
      if (tries > 40) throw Object.assign(new Error('No free port between 8081 and 8121.'), { status: 409 });
      chosen = FIRST_PORT + ((chosen - FIRST_PORT + 1) % 41);
    }
    const command = commandFor({ dir: project.dir, port: chosen, connection, host: defaults.host, clear });
    const size = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);
    const session = this.blank({
      id: `dev-${Date.now().toString(36)}`, project: name, port: chosen, connection, host: connection === 'tailnet' ? defaults.host : '', clear: Boolean(clear), command: command.shown,
      target: ready.devClient ? 'development build' : 'Expo Go', web: ready.web, startedAt: Date.now(), by: by ?? null, cols: size(cols, 20, 400, 100), rows: size(rows, 5, 200, 32),
    });
    const env = { ...this.env, ...command.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', FORCE_COLOR: '1', EXPO_NO_TELEMETRY: this.env.EXPO_NO_TELEMETRY ?? '1' };
    delete env.CI; // Expo turns off its keys and prompts in CI
    delete env.NO_COLOR; // FORCE_COLOR wins; Node's conflict warning can interrupt an interactive prompt.
    env.MACBUILD_DEV_SESSION = session.id; // macbuild's hook in metro.config.js stays out of macbuild's own
    session.child = spawn(this.python, ['-I', BRIDGE, String(session.cols), String(session.rows), command.file, ...command.args], { cwd: project.dir, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    session.pid = session.child.pid;
    session.child.stdin.on('error', () => {});
    session.child.stdio[3].on('error', () => {});
    session.child.stdout.on('data', (chunk) => this.output(session, chunk));
    session.child.stderr.on('data', (chunk) => this.output(session, chunk));
    session.child.on('error', (error) => { this.output(session, Buffer.from(`\r\nmacbuild: could not start the terminal (${this.python}): ${error.message}\r\n`)); session.reason = `Could not start ${this.python}: ${error.message}`; this.exited(session, 127); });
    session.child.on('close', (code) => this.exited(session, code));
    this.sessions.set(name, session);
    this.entry(name).options = { connection };
    this.record(session, true);
    this.emit(session, 'state');
    return publicSession(session);
  }
  // A new session with its buffers and log file, first in the project's history.
  blank(fields) {
    const folder = join(this.dir, fields.project.replace(/[^\w.-]/g, '_'));
    mkdirSync(folder, { recursive: true });
    const session = {
      status: 'starting', readyAt: null, stoppedAt: null, exitCode: null, reason: '', by: null, urls: {}, bundles: {}, prompt: null, lastError: null, devices: [], ...fields,
      raw: [], rawBytes: 0, lines: [], base: 0, partial: '', listeners: new Set(), waiters: new Set(), file: join(folder, `${fields.id}.log`),
    };
    session.stream = createWriteStream(session.file, { flags: 'a' });
    const entry = this.entry(fields.project);
    entry.history.unshift(publicSession(session));
    for (const old of entry.history.splice(KEEP_SESSIONS)) rmSync(join(folder, `${old.id}.log`), { force: true });
    return session;
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
  // A whole line from macbuild (or a log event) while Metro's progress line is half drawn: end that line first.
  say(session, text) {
    const whole = !text.startsWith('\x1b[2K') && session.partial ? `\r\n${text}` : text;
    this.output(session, Buffer.from(whole));
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
    const session = this.current(name);
    this.project(name);
    if (!session || !LIVE.includes(session.status)) return publicSession(this.session(name));
    if ((session.external || session.hooked) && session.status !== 'stopping') {
      // As if Ctrl-C was pressed in its terminal; SIGTERM if it's still there 6 seconds later.
      session.status = 'stopping'; session.asked = true;
      try { process.kill(session.pid, 'SIGINT'); } catch {}
      session.timer = setTimeout(() => { try { if (alive(session.pid)) process.kill(session.pid, 'SIGTERM'); } catch {} this.scan(); }, 6000);
      setTimeout(() => this.scan(), 700);
      this.record(session);
      this.emit(session, 'state');
    } else if (session.status !== 'stopping') {
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
    if (before?.external && LIVE.includes(before.status)) return this.takeOver(name, options, by);
    if (before?.hooked && LIVE.includes(before.status)) throw Object.assign(new Error('It runs in a terminal: restart it there, or stop it and start it here.'), { status: 409 });
    this.stop(name);
    for (let waited = 0; LIVE.includes(this.sessions.get(name)?.status) && waited < 8000; waited += 100) await new Promise((done) => { setTimeout(done, 100); });
    if (LIVE.includes(this.sessions.get(name)?.status)) throw Object.assign(new Error('The dev server didn’t stop in time.'), { status: 409 });
    return this.start(name, { connection: before?.connection, port: undefined, ...options }, by);
  }
  // macbuild's own only: one running in a terminal belongs to that terminal.
  stopAll() {
    for (const session of this.sessions.values()) if (LIVE.includes(session.status)) { try { session.child.kill('SIGTERM'); } catch {} }
    for (const session of this.external.values()) { try { session.socket?.close(); } catch {} }
    clearInterval(this.watching);
    this.closeHooks();
  }
  // Input: a named key (KEYS), a single character, or text (with Enter unless enter is false). Prompt answers clear
  // the prompt at once, so the page doesn't show buttons for a question already answered.
  input(name, { key, text, enter = true } = {}) {
    const session = this.current(name);
    this.project(name);
    if (!session || !['starting', 'running'].includes(session.status)) throw Object.assign(new Error('The dev server isn’t running.'), { status: 409 });
    if (session.external) {
      const method = { r: 'reload', reload: 'reload', m: 'devMenu', menu: 'devMenu' }[typeof key === 'string' ? key : ''];
      if (!method) throw Object.assign(new Error('This dev server runs in a terminal, so only reload and the dev menu work from here. Press other keys in that terminal, or run it here instead (take over).'), { status: 409 });
      this.broadcast(session, method);
      return { sent: 1, session: publicSession(session) };
    }
    let data;
    if (typeof key === 'string' && key) {
      data = KEYS[key.toLowerCase()] ?? (key.length === 1 && key >= ' ' && key <= '~' ? key : null);
      if (!data) throw Object.assign(new Error(`Unknown key ${key}. Keys: ${Object.keys(KEYS).join(', ')} or one character.`), { status: 400 });
    } else if (typeof text === 'string') {
      if (text.length > 2000 || /[\x00-\x08\x0b-\x1f]/.test(text.replace(/\x1b\[[ABCD]/g, '').replace(/[\r\n\t\x03\x1b]/g, ''))) throw Object.assign(new Error('Text is limited to 2000 printable characters.'), { status: 400 });
      data = enter && !/[\r\n]$/.test(text) ? `${text}\r` : text;
    } else throw Object.assign(new Error('Send a key or text.'), { status: 400 });
    this.deliver(session, data);
    if (session.prompt && (/^[\ryn\x03]$/i.test(data) || data.endsWith('\r'))) { session.prompt = null; this.emit(session, 'state'); }
    return { sent: data.length, session: publicSession(session) };
  }
  deliver(session, data) {
    if (session.hooked) session.conn.write(`${JSON.stringify({ type: 'in', data: Buffer.from(data).toString('base64') })}\n`);
    else session.child.stdin.write(data);
  }
  // What a select prompt's option needs: arrow presses from the highlighted option to the chosen one, then Enter.
  choose(name, index) {
    const session = this.current(name);
    const options = session?.prompt?.options;
    if (!options || !Number.isInteger(index) || index < 0 || index >= options.length) throw Object.assign(new Error('No such option.'), { status: 400 });
    const from = Math.max(0, options.findIndex((option) => option.selected));
    const moves = (index > from ? KEYS.down : KEYS.up).repeat(Math.abs(index - from));
    return this.input(name, { text: `${moves}\r`, enter: false });
  }
  resize(name, cols, rows) {
    const session = this.current(name);
    if (!session || session.external || session.hooked || !LIVE.includes(session.status) || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 400 || rows < 5 || rows > 200) return false;
    session.cols = cols; session.rows = rows;
    try { session.child.stdio[3].write(`${cols} ${rows}\n`); } catch {}
    return true;
  }
  // Live output for the terminal view: what's on screen so far, then each chunk and state change.
  subscribe(name, listener) {
    const session = this.current(name);
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
      if (!lines.length && !session.raw && session.id) lines = this.savedLines(session);
      const shown = Number.isInteger(since) && since >= 0 ? lines.filter((line) => line.n > since).slice(0, 2000) : lines.slice(-Math.max(1, Math.min(2000, tail)));
      const last = lines[lines.length - 1]?.n ?? since ?? 0;
      return { project: name, session: session.id, status: session.status, prompt: session.prompt ?? null, lines: shown, next: shown.length ? shown[shown.length - 1].n : Math.max(since ?? 0, last), truncated: Number.isInteger(since) && since < (session.base ?? 0) };
    };
    let result = pick();
    if (wait > 0 && !result.lines.length && session && LIVE.includes(session.status) && !session.prompt) {
      await new Promise((done) => {
        const live = this.current(name);
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

  // Dev servers started in a terminal. Every few seconds: list processes, keep those running `expo start` (the
  // innermost one: npx and npm run the real one as a child), skip macbuild's own, and attach to any whose folder is a
  // project's. Also notes which phones are connected, for every live dev server.
  watch(ms = 4000) {
    clearInterval(this.watching);
    this.scan();
    this.watching = setInterval(() => this.scan(), ms);
    this.watching.unref?.();
  }
  scan() {
    this.scanning ??= this.scanOnce().catch((error) => console.error('dev scan', error.message)).finally(() => { this.scanning = null; });
    return this.scanning;
  }
  async scanOnce() {
    let list;
    try { list = await processes(); } catch { return; }
    const byPid = new Map(list.map((item) => [item.pid, item]));
    const ours = new Set([...[...this.sessions.values()].filter((session) => session.pid).map((session) => session.pid)]);
    const ancestors = function* (proc) { for (let at = byPid.get(proc.ppid), hops = 0; at && hops < 40; at = byPid.get(at.ppid), hops += 1) yield at; };
    const hookedPids = new Set([...this.hooked.values()].map((session) => session.pid));
    const matched = list.filter((proc) => DEV_COMMAND.test(proc.args) && !ours.has(proc.pid) && !hookedPids.has(proc.pid) && ![...ancestors(proc)].some((at) => ours.has(at.pid)));
    const outer = new Set(matched.flatMap((proc) => [...ancestors(proc)].map((at) => at.pid)));
    // The one doing the work is node (or bun, deno) running Expo; npx, npm and sh are only its parents.
    const leaves = matched.filter((proc) => !outer.has(proc.pid) && /^(?:node|nodejs|bun|deno|expo|react-native)$/.test(proc.args.split(/\s+/)[0].split('/').pop()));
    for (const pid of this.ignored) if (!byPid.has(pid)) this.ignored.delete(pid);
    for (const session of [...this.external.values()]) if (!byPid.has(session.pid)) this.detached(session);
    const folders = this.projects().map((project) => { try { return { project, real: realpathSync(project.dir) }; } catch { return { project, real: resolve(project.dir) }; } });
    for (const proc of leaves) {
      if (this.ignored.has(proc.pid) || [...this.external.values()].some((session) => session.pid === proc.pid)) continue;
      const cwd = await cwdOf(proc.pid);
      const found = cwd && folders.filter(({ real }) => cwd === real || cwd.startsWith(`${real}${sep}`)).sort((a, b) => b.real.length - a.real.length)[0];
      if (!found) { this.ignored.add(proc.pid); continue; }
      const name = found.project.name;
      if (this.external.has(name) || this.hooked.has(name) || LIVE.includes(this.sessions.get(name)?.status)) continue;
      await this.attach(found.project, proc);
    }
    for (const session of [...this.external.values()]) if (session.status === 'starting') await this.ready(session);
    for (const session of [...this.hooked.values()]) if (session.status === 'starting') await this.settle(session);
    await Promise.all([...this.sessions.values(), ...this.hooked.values(), ...this.external.values()].filter((session) => session.status === 'running').map((session) => this.devices(session)));
  }
  async attach(project, proc) {
    const ready = readiness(project, { builds: this.builds() });
    const portArg = Number(proc.args.match(/(?:--port|-p)[=\s]+(\d+)/)?.[1] ?? 0);
    const tailnet = this.tailnetHost();
    const connection = /--localhost\b/.test(proc.args) ? 'localhost' : /--tunnel\b/.test(proc.args) ? 'tunnel' : tailnet ? 'tailnet' : 'lan';
    const session = this.blank({
      id: `ext-${proc.pid}-${Date.now().toString(36)}`, project: project.name, external: true, pid: proc.pid, port: portArg || FIRST_PORT, connection, host: connection === 'tailnet' ? tailnet : '',
      command: proc.args.replace(/^\S*\/(node|bun)\s+/, '$1 ').slice(0, 400), target: ready.devClient ? 'development build' : 'Expo Go', web: ready.web, startedAt: Date.now() - proc.age * 1000,
      // Only ports this process owns (lsof), else the one its command names, else Expo's default: never a guess that
      // could be another app's Metro answering.
      by: null, origin: 'terminal', candidates: await portsOf(proc.pid).then((ports) => (ports.length ? ports : [portArg || FIRST_PORT])), builds: new Map(),
    });
    this.external.set(project.name, session);
    this.output(session, Buffer.from(`\x1b[2mmacbuild found ${project.name}'s dev server running in a terminal (process ${proc.pid}) and is following it.\x1b[22m\r\n`));
    await this.ready(session);
    this.record(session, true);
    this.emit(session, 'state');
  }
  // Which port answers as Metro; then the links a phone would use, and Metro's events.
  async ready(session) {
    const held = new Set([...this.sessions.values(), ...this.external.values()].filter((item) => item !== session && LIVE.includes(item.status) && item.readyAt).map((item) => item.port));
    for (const port of session.candidates ?? [session.port]) {
      if (held.has(port) || !await metroAt(port)) continue;
      const project = this.projects().find((item) => item.name === session.project);
      const ready = project ? readiness(project, { builds: this.builds() }) : { devClient: false, web: false };
      const host = session.connection === 'localhost' ? 'localhost' : session.host || lanAddress() || 'localhost';
      let slug = '';
      try { slug = JSON.parse(readFileSync(join(project.dir, 'app.json'), 'utf8')).expo?.slug ?? ''; } catch {}
      try { slug ||= JSON.parse(readFileSync(join(project.dir, 'package.json'), 'utf8')).name ?? ''; } catch {}
      const metro = `http://${host}:${port}`;
      Object.assign(session, {
        port, status: 'running', readyAt: Date.now(),
        urls: { app: ready.devClient && slug ? `exp+${slug.replace(/[^\w.-]/g, '')}://expo-development-client/?url=${encodeURIComponent(metro)}` : `exp://${host}:${port}`, ...(ready.web ? { web: `http://localhost:${port}` } : {}) },
      });
      this.listen(session);
      this.record(session);
      this.emit(session, 'state');
      return true;
    }
    return false;
  }
  listen(session) {
    if (typeof WebSocket !== 'function' || session.socket) return;
    let opened = false;
    let socket;
    try { socket = new WebSocket(`ws://127.0.0.1:${session.port}/events`); } catch { return; }
    session.socket = socket;
    socket.onopen = () => { opened = true; this.output(session, Buffer.from(`\x1b[2mFollowing Metro on port ${session.port}: bundles and your app's logs show here. Expo's own output and keys stay in its terminal.\x1b[22m\r\n`)); };
    socket.onmessage = (event) => {
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      const text = eventText(data, session.builds);
      if (text) this.say(session, text);
    };
    socket.onerror = () => {};
    socket.onclose = () => {
      session.socket = null;
      if (!opened && LIVE.includes(session.status) && !session.noEvents) {
        session.noEvents = true;
        this.output(session, Buffer.from('\x1b[2mThis Metro doesn’t share its events, so only its status shows here. Its output is in its terminal.\x1b[22m\r\n'));
      }
    };
  }
  // Reload and the dev menu reach the apps through Metro's message socket, as Expo's r and m keys do.
  broadcast(session, method) {
    const say = (text) => this.say(session, `${text}\r\n`);
    if (typeof WebSocket !== 'function') { say('macbuild needs Node 22 to reach Metro’s message socket.'); return; }
    const socket = new WebSocket(`ws://127.0.0.1:${session.port}/message`);
    socket.onopen = () => { socket.send(JSON.stringify({ version: 2, method })); say(method === 'reload' ? '› Reloading apps (from macbuild)' : '› Toggling dev menu (from macbuild)'); setTimeout(() => socket.close(), 300); };
    socket.onerror = () => say(`Couldn’t reach Metro on port ${session.port} to ${method === 'reload' ? 'reload' : 'open the dev menu'}.`);
  }
  // The phones and simulators connected to Metro, from its debugger list.
  async devices(session) {
    let names = [];
    try {
      const targets = await (await fetch(`http://127.0.0.1:${session.port}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
      names = [...new Set((Array.isArray(targets) ? targets : []).map((target) => target.deviceName).filter((name) => typeof name === 'string' && name).map((name) => name.slice(0, 80)))].slice(0, 6);
    } catch { return; }
    if (JSON.stringify(names) !== JSON.stringify(session.devices ?? [])) { session.devices = names; this.record(session); this.emit(session, 'state'); }
  }
  // Its process is gone: stopped in its terminal, or by macbuild.
  detached(session) {
    if (session.stoppedAt) return;
    try { session.socket?.close(); } catch {}
    session.socket = null;
    clearTimeout(session.timer);
    Object.assign(session, { status: 'stopped', stoppedAt: Date.now(), prompt: null, reason: session.asked ? '' : 'Stopped in its terminal.' });
    delete session.pid;
    this.output(session, Buffer.from(`\x1b[2m${session.reason || 'Stopped.'}\x1b[22m\r\n`));
    session.stream?.end();
    this.external.delete(session.project);
    this.record(session, true);
    this.emit(session, 'state');
    for (const listener of session.listeners) listener('exit', 0);
    for (const waiter of session.waiters) waiter();
  }
  // Run it here instead: stop the one in the terminal, then start it in macbuild on the same port and connection, so
  // its whole terminal is on the dashboard.
  async takeOver(name, options = {}, by = null) {
    if (LIVE.includes(this.hooked.get(name)?.status)) throw Object.assign(new Error('It already shows here in full, through metro.config.js.'), { status: 409 });
    const session = this.external.get(name);
    if (!session || !LIVE.includes(session.status)) throw Object.assign(new Error(`Nothing is running in a terminal for ${name}.`), { status: 409 });
    const { pid, port, connection } = session;
    this.stop(name);
    for (let waited = 0; alive(pid) && waited < 9000; waited += 150) await new Promise((done) => { setTimeout(done, 150); });
    if (alive(pid)) throw Object.assign(new Error('It didn’t stop. Press Ctrl-C in its terminal, then start it here.'), { status: 409 });
    this.detached(session);
    const chosen = { connection: connection === 'tailnet' && !this.tailnetHost() ? 'lan' : connection, ...options };
    try { return await this.start(name, { ...chosen, port }, by); }
    catch (error) { if (error.status === 409 && /in use/.test(error.message)) return this.start(name, chosen, by); throw error; }
  }

  // macbuild's hook in an app's metro.config.js (lib/metro.cjs) connects here from inside an `expo start` someone ran in
  // a terminal: its output arrives as written and keys go back, so it works like macbuild's own. The socket is in the
  // user's home folder and only they can open it. A stale socket file from a dashboard that crashed is replaced; a live
  // one (another dashboard) is left alone.
  listenHooks(file) {
    this.hookFile = file;
    mkdirSync(dirname(file), { recursive: true });
    const serve = () => {
      rmSync(file, { force: true });
      this.hookServer = createServer((conn) => this.hookConnection(conn));
      this.hookServer.on('error', (error) => console.error('dev hooks', error.message));
      this.hookServer.listen(file, () => { try { chmodSync(file, 0o600); } catch {} });
      this.hookServer.unref?.();
    };
    if (!existsSync(file)) { serve(); return; }
    const probe = connect(file);
    probe.once('connect', () => { probe.destroy(); console.error(`dev hooks: another dashboard is using ${file}`); });
    probe.once('error', serve);
  }
  // Ends the socket and every hook on it, as the dashboard quitting does: each hook then waits for the next dashboard.
  closeHooks() {
    try { this.hookServer?.close(); } catch {}
    for (const conn of this.hookConns ?? []) conn.destroy();
  }
  hookConnection(conn) {
    (this.hookConns ??= new Set()).add(conn);
    conn.on('close', () => this.hookConns.delete(conn));
    conn.setEncoding('utf8');
    let buffer = '';
    let session = null;
    let chain = Promise.resolve();
    const handle = async (message) => {
      if (message.type === 'hello') { if (!session) session = await this.adopt(conn, message); return; }
      if (!session || session.conn !== conn) return;
      if (message.type === 'out' && typeof message.data === 'string') this.output(session, this.crlf(session, Buffer.from(message.data, 'base64')));
      else if (message.type === 'size' && Number.isInteger(message.cols) && Number.isInteger(message.rows) && message.cols > 0 && message.rows > 0) {
        Object.assign(session, { cols: Math.min(message.cols, 400), rows: Math.min(message.rows, 200) });
        this.emit(session, 'state');
      }
    };
    conn.on('data', (text) => {
      buffer += text;
      if (buffer.length > 16 * 1024 * 1024) { conn.destroy(); return; }
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message && typeof message === 'object') chain = chain.then(() => handle(message)).catch((error) => console.error('dev hook', error.message));
      }
    });
    conn.on('error', () => {});
    conn.on('close', () => { chain.then(() => { if (session?.conn === conn) this.unhooked(session); }); });
  }
  // A terminal turns each line feed a program writes into a carriage return and a line feed; the copy the hook sends
  // skipped the terminal, so that happens here (byte by byte: a chunk can end inside a UTF-8 character).
  crlf(session, buffer) {
    const out = [];
    let last = session.lastByte ?? 0;
    for (const byte of buffer) { if (byte === 0x0a && last !== 0x0d) out.push(0x0d); out.push(byte); last = byte; }
    session.lastByte = last;
    return Buffer.from(out);
  }
  // Checks the hello against the system, not just its word: a live process running expo start, in a project's folder.
  async adopt(conn, hello) {
    const bye = (reason) => { try { conn.end(`${JSON.stringify({ type: 'bye', reason })}\n`); } catch {} return null; };
    const pid = Number(hello.pid);
    if (!Number.isInteger(pid) || pid <= 1 || !alive(pid)) return bye('no such process');
    const proc = (await processes().catch(() => [])).find((item) => item.pid === pid);
    if (!proc || !/(?:^|[\s/])(?:expo|react-native)(?:\/bin\/cli(?:\.js)?)?\s+(?:start|run:ios|run:android)(?=\s|$)/.test(proc.args)) return bye('not expo start');
    const cwd = await cwdOf(pid);
    const folders = this.projects().map((project) => { try { return { project, real: realpathSync(project.dir) }; } catch { return { project, real: resolve(project.dir) }; } });
    const found = cwd && folders.filter(({ real }) => cwd === real || cwd.startsWith(`${real}${sep}`)).sort((a, b) => b.real.length - a.real.length)[0];
    if (!found) return bye('not a macbuild project');
    const name = found.project.name;
    if (LIVE.includes(this.sessions.get(name)?.status) || LIVE.includes(this.hooked.get(name)?.status)) return bye('already running here');
    // Found by the scan a moment ago: this replaces it, without leaving a session behind in the history.
    const scanned = this.external.get(name);
    if (scanned) {
      try { scanned.socket?.close(); } catch {}
      clearTimeout(scanned.timer);
      scanned.stream?.end();
      this.external.delete(name);
      const entry = this.entry(name);
      entry.history = entry.history.filter((item) => item.id !== scanned.id);
      rmSync(scanned.file, { force: true });
    }
    const ready = readiness(found.project, { builds: this.builds() });
    const size = (value, high) => (Number.isInteger(value) && value > 0 ? Math.min(value, high) : 0);
    const session = this.blank({
      id: `term-${pid}-${Date.now().toString(36)}`, project: name, terminal: true, hooked: true, pid, conn, origin: 'terminal',
      port: Number(proc.args.match(/(?:--port|-p)[=\s]+(\d+)/)?.[1] ?? 0) || FIRST_PORT,
      connection: /--localhost\b/.test(proc.args) ? 'localhost' : /--tunnel\b/.test(proc.args) ? 'tunnel' : 'lan', host: '',
      command: proc.args.replace(/^\S*\/(node|bun)\s+/, '$1 ').slice(0, 400), target: ready.devClient ? 'development build' : 'Expo Go', web: ready.web,
      startedAt: Number.isFinite(hello.startedAt) && hello.startedAt > 0 && hello.startedAt <= Date.now() ? hello.startedAt : Date.now() - proc.age * 1000,
      cols: size(hello.cols, 400) || 100, rows: size(hello.rows, 200) || 32, candidates: await portsOf(pid),
    });
    this.hooked.set(name, session);
    this.record(session, true);
    this.emit(session, 'state');
    return session;
  }
  // Ready even if the lines that say so came before the hook loaded, or were cut from the replay.
  async settle(session) {
    for (const port of session.candidates?.length ? session.candidates : [session.port]) {
      if (!await metroAt(port)) continue;
      Object.assign(session, { port, status: session.status === 'starting' ? 'running' : session.status, readyAt: session.readyAt ?? Date.now() });
      this.record(session);
      this.emit(session, 'state');
      return;
    }
    session.candidates = await portsOf(session.pid);
  }
  unhooked(session) {
    if (session.stoppedAt) return;
    clearTimeout(session.timer);
    Object.assign(session, { status: 'stopped', stoppedAt: Date.now(), prompt: null, reason: session.asked ? '' : 'Stopped in its terminal.' });
    delete session.pid;
    session.stream?.end();
    this.hooked.delete(session.project);
    this.record(session, true);
    this.emit(session, 'state');
    for (const listener of session.listeners) listener('exit', 0);
    for (const waiter of session.waiters) waiter();
  }
}
