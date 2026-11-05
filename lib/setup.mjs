// First-time setup for macbuild: the steps, what each one shows, and what it does with the answers.
// Every step is a screen: a title, the agent's words, form fields, commands for a terminal, and buttons. The terminal
// UI (lib/setup-cli.mjs) and the dashboard's #/setup page both draw these screens; all the work happens here.
//
// An agent (Claude Code or Codex, see lib/setup-agent.mjs) does the looking around, read-only. macbuild then changes
// things itself, only from the fixed list in ACTIONS and only after the user approves each one. Signing runs
// `eas credentials` in a terminal, so Apple passwords go straight to Apple, never through macbuild or the agent.
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { listDevices } from './device.mjs';
import { readProfiles } from './profile.mjs';
import { ACTION_TYPES, agentLabel, detectAgents, runAgent } from './setup-agent.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const STEPS = [
  { id: 'welcome', label: 'Agent' },
  { id: 'apps', label: 'Apps' },
  { id: 'tools', label: 'Tools' },
  { id: 'review', label: 'Check' },
  { id: 'signing', label: 'Signing' },
  { id: 'mac', label: 'This Mac' },
  { id: 'build', label: 'Build' },
];

export function setupPaths(home = process.env.HOME || homedir()) {
  const config = join(home, '.config/macbuild');
  return {
    home, config,
    state: join(config, 'setup.json'),
    projects: process.env.MACBUILD_PROJECTS ?? join(config, 'projects.conf'),
    env: join(config, 'env'),
    ui: process.env.MACBUILD_CONFIG ?? join(config, 'ui.json'),
    history: process.env.MACBUILD_DATA ?? join(home, '.local/share/macbuild/builds'),
    uiPlist: join(home, 'Library/LaunchAgents/local.macbuild.ui.plist'),
  };
}

// ---------- small helpers ----------

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const real = (path) => { try { return realpathSync(path); } catch { return path; } };
export const slugify = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const validName = (name) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name ?? '');
const tilde = (path, home) => (path && home && path.startsWith(home) ? `~${path.slice(home.length)}` : path);
const clip = (value, max) => { const text = String(value ?? '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };
const plural = (count, one, many = `${one}s`) => `${count === 1 ? 'one' : count} ${count === 1 ? one : many}`;
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);
export const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, `'\\''`)}'`);
const list = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const platformName = (platform) => (platform === 'android' ? 'Android' : 'iOS');
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function readProjects(file) {
  return (existsSync(file) ? readFileSync(file, 'utf8') : '').split('\n')
    .filter((line) => line.includes('|') && !line.startsWith('#'))
    .map((line) => { const [name, ...rest] = line.split('|'); return { name, dir: rest.join('|') }; });
}
export function addProject(file, name, dir) {
  if (!validName(name)) throw new Error(`bad name: ${name}`);
  if (!existsSync(join(dir, 'eas.json'))) throw new Error(`no eas.json in ${dir}`);
  mkdirSync(dirname(file), { recursive: true });
  const kept = readProjects(file).filter((item) => item.name !== name);
  writeFileSync(file, [...kept, { name, dir }].map((item) => `${item.name}|${item.dir}`).join('\n') + '\n');
}

// ---------- reading an app ----------

const DYNAMIC = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs'];
const GENERIC = new Set(['app', 'apps', 'mobile', 'native', 'expo', 'client', 'frontend', 'ios', 'android', 'rn', 'src']);

function repoOf(dir) {
  for (let at = dir; at !== dirname(at); at = dirname(at)) {
    if (!existsSync(join(at, '.git'))) continue;
    let configFile = join(at, '.git/config');
    if (!isDir(join(at, '.git'))) {
      // A worktree or submodule: .git is a file naming the real folder.
      const pointer = readFileSync(join(at, '.git'), 'utf8').match(/gitdir:\s*(.+)/)?.[1]?.trim();
      if (pointer) configFile = join(resolve(at, pointer), 'config');
    }
    const text = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
    const origin = text.match(/\[remote "origin"\][^[]*?url\s*=\s*(\S+)/)?.[1] ?? '';
    const slug = origin.match(/[:/]([^/:\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? null;
    return { root: at, repo: slug };
  }
  return { root: null, repo: null };
}

export function readApp(dir) {
  const pkg = readJson(join(dir, 'package.json')) ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const appJson = existsSync(join(dir, 'app.json')) ? readJson(join(dir, 'app.json')) : null;
  const expo = appJson?.expo && typeof appJson.expo === 'object' ? appJson.expo : {};
  const dynamic = DYNAMIC.find((file) => existsSync(join(dir, file))) ?? null;
  const easFile = join(dir, 'eas.json');
  const easJson = existsSync(easFile);
  let profiles = []; let easError = '';
  if (easJson) { try { profiles = readProfiles(easFile); } catch (error) { easError = error.message; } }
  const framework = deps.expo ? 'expo' : deps['react-native'] ? 'react-native' : null;
  const declared = Array.isArray(expo.platforms) ? expo.platforms.filter((item) => ['ios', 'android'].includes(item)) : null;
  const native = ['ios', 'android'].filter((item) => isDir(join(dir, item)));
  const { root, repo } = repoOf(dir);
  return {
    path: dir, framework,
    title: expo.name || appJson?.displayName || appJson?.name || pkg.name || basename(dir),
    slug: expo.slug || null,
    sdk: deps.expo ? (String(deps.expo).match(/(\d+)\.\d/)?.[1] ?? null) : null,
    platforms: declared?.length ? declared : framework === 'react-native' && native.length ? native : ['ios', 'android'],
    platformsDeclared: Boolean(declared?.length),
    appJson: Boolean(appJson), expoSection: Boolean(appJson?.expo), dynamic,
    bundleId: expo.ios?.bundleIdentifier ?? null,
    androidPackage: expo.android?.package ?? null,
    projectId: expo.extra?.eas?.projectId ?? null,
    owner: expo.owner ?? null,
    devClient: Boolean(deps['expo-dev-client']),
    easJson, easError, profiles: profiles.map((item) => item.name), profileInfo: profiles,
    credentialsLocal: easJson ? /"credentialsSource"\s*:\s*"local"/.test(readFileSync(easFile, 'utf8')) : false,
    repo, repoRoot: root,
  };
}

function looksLikeApp(dir, names) {
  if (!names.has('package.json')) return false;
  const pkg = readJson(join(dir, 'package.json'));
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if (!deps.expo && !deps['react-native']) return false;
  return names.has('app.json') || names.has('eas.json') || DYNAMIC.some((file) => names.has(file)) || (names.has('ios') && names.has('android'));
}

// The usual places people keep code. The agent looks further.
export const SCAN_ROOTS = ['Documents', 'Developer', 'Projects', 'code', 'src', 'dev', 'work', 'workspace', 'repos', 'git', 'GitHub', 'Sites', 'Desktop'];
const SKIP = new Set(['node_modules', 'Pods', 'build', 'dist', 'DerivedData', 'Library', 'vendor', 'ios', 'android', 'coverage', 'tmp', 'out']);

export function scanRoots(home, extra = []) {
  return [...new Set([...SCAN_ROOTS.map((name) => join(home, name)), ...extra])].filter(isDir);
}

// Expo and React Native apps under the usual folders: package.json with expo or react-native, plus an app config.
export function quickScan({ home = process.env.HOME || homedir(), extra = [], depth = 5, limit = 20000 } = {}) {
  const found = new Map();
  let visited = 0;
  const walk = (dir, level) => {
    if (visited++ > limit) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = new Set(entries.map((entry) => entry.name));
    if (looksLikeApp(dir, names)) { found.set(real(dir), readApp(real(dir))); return; }
    if (level >= depth) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
      walk(join(dir, entry.name), level + 1);
    }
  };
  for (const root of scanRoots(home, extra)) walk(root, 0);
  return [...found.values()];
}

const suggestedPath = (path) => !/\/(node_modules|templates?|examples?|fixtures|__tests__|archive|old|backup)(\/|$)/i.test(path);

// Short, unique macbuild names: the Expo slug or folder, or the repository's name for folders called "mobile" or "app".
export function nameApps(apps, taken = []) {
  const used = new Set(taken.map((item) => item.name));
  const byPath = new Map(taken.map((item) => [real(item.dir), item.name]));
  for (const app of apps) {
    const known = byPath.get(real(app.path));
    if (known) { app.name = known; app.added = true; continue; }
    app.added = false;
    const repoName = slugify(app.repo?.split('/')[1] ?? (app.repoRoot ? basename(app.repoRoot) : ''));
    // The first that isn't generic: the agent's name, the Expo slug, the folder, the repository, the folders above.
    const ancestors = [dirname(app.path), dirname(dirname(app.path)), dirname(dirname(dirname(app.path)))].map((dir) => basename(dir));
    const base = [app.name, app.slug, basename(app.path), repoName, ...ancestors].map(slugify).find((item) => item && !GENERIC.has(item)) || 'app';
    let name = base;
    if (used.has(name) && repoName && repoName !== base) name = `${repoName}-${base}`;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}`;
    app.name = name;
    used.add(name);
  }
  return apps;
}

// ---------- checks ----------

const BUNDLE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const PACKAGE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
export const SETTINGS = {
  MACBUILD_APPLE_ID: { label: 'your Apple ID', pattern: /^[^\s@"'$`\\]+@[^\s@"'$`\\]+\.[^\s@"'$`\\]+$/ },
  MACBUILD_DEVICE: { label: 'the iPhone for --install', pattern: /^[\w.:-]{1,80}$/ },
  MACBUILD_SIMULATOR: { label: 'the simulator for --install', pattern: /^[\w .()-]{1,80}$/ },
  MACBUILD_ANDROID_DEVICE: { label: 'the Android device for --install', pattern: /^[\w.:-]{1,80}$/ },
  MACBUILD_NODE: { label: 'the Node version for builds', pattern: /^v?\d+(\.\d+){0,2}$/ },
};
const CONFIG_KEYS = {
  'ios.bundleIdentifier': { label: 'iOS bundle identifier', pattern: BUNDLE, example: 'com.you.app' },
  'android.package': { label: 'Android package', pattern: PACKAGE, example: 'com.you.app' },
};
export const PROFILES = {
  development: { developmentClient: true, distribution: 'internal' },
  preview: { distribution: 'internal' },
  production: { autoIncrement: true },
  simulator: { extends: 'development', ios: { simulator: true } },
};
export const DEFAULT_EAS = {
  cli: { version: '>= 16.0.0', appVersionSource: 'remote' },
  build: { development: PROFILES.development, preview: PROFILES.preview, production: PROFILES.production },
  submit: { production: {} },
};

export const devProfile = (profiles) => profiles.find((item) => item.name === 'development' && !item.ios.simulator)
  ?? profiles.find((item) => item.developmentClient && !item.ios.simulator)
  ?? profiles.find((item) => item.distribution === 'internal' && !item.ios.simulator);
export const storeProfile = (profiles) => profiles.find((item) => item.name === 'production')
  ?? profiles.find((item) => item.distribution === 'store' && !item.ios.simulator);

function suggestId(app, owner) {
  const clean = (value) => slugify(value).replace(/-/g, '').replace(/^(\d)/, 'app$1');
  return `com.${clean(owner) || 'example'}.${clean(app.slug || app.name) || 'app'}`;
}

// What an app needs before `eas build --local --non-interactive` can run without asking. Certain problems only:
// a value set by app.config.* that macbuild couldn't evaluate is left to the agent.
export function checkApp(app, { owner = '', loggedIn = true, builds = [] } = {}) {
  const issues = [];
  const add = (issue) => issues.push({ app: app.name, severity: 'fix', ...issue });
  const cfg = app.resolved ?? null; // the evaluated app config, when app.config.* could be read
  const known = !app.dynamic || cfg;
  const value = (key) => (cfg ? key.split('.').reduce((node, part) => node?.[part], cfg) : key.split('.').reduce((node, part) => node?.[part], { ios: { bundleIdentifier: app.bundleId }, android: { package: app.androidPackage }, extra: { eas: { projectId: app.projectId } } }));
  if (!app.easJson) add({ id: `easjson-${app.name}`, title: 'No eas.json', detail: 'EAS needs it to know how to build.', action: { type: 'create_eas_json', app: app.name, why: 'EAS needs it to build' } });
  else if (app.easError) add({ id: `easjson-${app.name}`, severity: 'warn', title: 'eas.json can’t be read', detail: clip(app.easError, 160) });
  else {
    const profiles = app.profileInfo ?? [];
    const dev = devProfile(profiles);
    if (!dev) add({ id: `profile-${app.name}`, title: 'No development profile', detail: '`macbuild <app>` builds the development profile by default.', action: { type: 'add_profile', app: app.name, value: 'development', why: 'Development builds use it' } });
    if (app.framework === 'expo' && !app.devClient && (dev ? dev.developmentClient : true)) {
      add({ id: `devclient-${app.name}`, title: 'expo-dev-client isn’t installed', detail: 'Development builds need it; EAS stops to ask otherwise.', action: { type: 'install_dev_client', app: app.name, why: 'Development builds need it' } });
    }
    if (app.credentialsLocal && !existsSync(join(app.path, 'credentials.json'))) {
      add({ id: `credentials-${app.name}`, severity: 'warn', title: 'credentials.json is missing', detail: 'A profile uses local credentials, but there’s no credentials.json next to eas.json.' });
    }
  }
  if (known) {
    if (!value('extra.eas.projectId')) {
      add({
        id: `link-${app.name}`, title: 'Not linked to an EAS project',
        detail: loggedIn ? 'EAS asks to create or link one otherwise.' : 'Sign in to Expo first (eas login), then link it.',
        action: loggedIn ? { type: 'link_eas', app: app.name, why: 'EAS asks to create or link one otherwise' } : undefined, severity: loggedIn ? 'fix' : 'warn',
      });
    }
    // A bare React Native app keeps its identifiers in the Xcode and Gradle projects, where EAS reads them.
    for (const [platform, key] of app.framework === 'react-native' ? [] : [['ios', 'ios.bundleIdentifier'], ['android', 'android.package']]) {
      if (!app.platforms.includes(platform) || value(key)) continue;
      const meta = CONFIG_KEYS[key];
      const id = `${platform === 'ios' ? 'bundle' : 'package'}-${app.name}`;
      if (app.expoSection) {
        add({
          id, title: `No ${meta.label}`, detail: 'EAS asks for it otherwise.',
          question: { id, kind: 'text', label: `${platformName(platform)} ${platform === 'ios' ? 'bundle identifier' : 'package'} for ${app.title}`, help: `Reverse-DNS, like ${meta.example}. It can’t change once the app is in the store.`, options: [], default: suggestId(app, owner) },
          action: { type: 'set_config', app: app.name, key, answer: id, why: 'EAS asks for it otherwise' },
        });
      } else {
        add({ id, severity: 'warn', title: `No ${meta.label}`, detail: `Set ${key} in ${app.dynamic ?? 'app.json'}.` });
      }
    }
  } else {
    issues.push({ id: `dynamic-${app.name}`, app: app.name, severity: 'info', title: `Uses ${app.dynamic}`, detail: 'macbuild couldn’t evaluate it, so it can’t check the bundle identifier or EAS project.' });
  }
  const built = builds.find((build) => build.project === app.name && build.status === 'success');
  if (built) issues.push({ id: `built-${app.name}`, app: app.name, severity: 'info', title: 'Built here before', detail: `${platformName(built.platform)} ${built.profile}` });
  return issues;
}

// A fix only Android builds need starts unticked, unless the app says it's for Android or has built for it here.
export function markOptional(actions, apps, builds = []) {
  return actions.map((action) => {
    if (action.type !== 'set_config' || action.key !== 'android.package') return action;
    const app = apps.find((item) => item.name === action.app);
    const android = app?.platformsDeclared && app.platforms.includes('android');
    const built = builds.some((build) => build.project === action.app && build.platform === 'android');
    return { ...action, optional: !android && !built };
  });
}

// macbuild's own review, used without an agent, as the agent's starting point, and when the agent fails.
export function ownReview(apps, issues) {
  const fixes = issues.filter((issue) => issue.action);
  const questions = issues.map((issue) => issue.question).filter(Boolean);
  const actions = fixes.map((issue) => ({ key: null, value: null, answer: null, ...issue.action }));
  const notes = issues.filter((issue) => !issue.action && issue.severity !== 'info').map((issue) => ({ tone: 'warn', text: `${issue.app}: ${issue.title}. ${issue.detail}` }));
  const needing = [...new Set(fixes.map((issue) => issue.app))];
  const ready = apps.filter((app) => !issues.some((issue) => issue.app === app.name && issue.severity !== 'info')).map((app) => app.name);
  let say;
  if (!apps.length) say = 'There are no apps to check yet.';
  else if (!needing.length && !notes.length) say = `${list(apps.map((app) => app.name))} ${apps.length === 1 ? 'looks' : 'look'} ready to build.`;
  else say = [ready.length ? `${list(ready)} ${ready.length === 1 ? 'looks' : 'look'} ready.` : '', needing.length ? `${list(needing)} ${needing.length === 1 ? 'needs' : 'need'} a few changes first.` : ''].filter(Boolean).join(' ') || 'A few things need your attention.';
  return { say, questions, actions, notes, done: true };
}

// ---------- validating what an agent says ----------

const QUESTION_ID = /^[A-Za-z0-9_-]{1,48}$/;
export function sanitizeFound(items, home) {
  const out = [];
  for (const item of Array.isArray(items) ? items.slice(0, 60) : []) {
    if (!item || typeof item.path !== 'string') continue;
    let path = item.path.trim().replace(/^~(?=\/|$)/, home);
    if (!isAbsolute(path) || !isDir(path) || !existsSync(join(path, 'package.json'))) continue;
    path = real(path);
    const app = readApp(path);
    if (!app.framework && item.framework !== 'react-native' && item.framework !== 'expo') continue;
    out.push({
      ...app,
      name: slugify(item.name) || '',
      title: clip(item.title, 60) || app.title,
      framework: app.framework ?? item.framework,
      sdk: app.sdk ?? (/^\d{1,3}$/.test(item.sdk ?? '') ? item.sdk : null),
      platforms: !app.platformsDeclared && Array.isArray(item.platforms) && item.platforms.some((p) => p === 'ios' || p === 'android') ? item.platforms.filter((p) => p === 'ios' || p === 'android') : app.platforms,
      bundleId: app.bundleId ?? (BUNDLE.test(item.bundleId ?? '') ? item.bundleId : null),
      androidPackage: app.androidPackage ?? (PACKAGE.test(item.androidPackage ?? '') ? item.androidPackage : null),
      repo: app.repo ?? (/^[\w.-]+\/[\w.-]+$/.test(item.repo ?? '') ? item.repo : null),
      note: item.note ? clip(item.note, 120) : null,
      suggested: item.suggested !== false,
    });
  }
  return out;
}

export function sanitizeReview(data, appNames) {
  const questions = [];
  for (const item of Array.isArray(data?.questions) ? data.questions.slice(0, 10) : []) {
    if (!item || !QUESTION_ID.test(item.id ?? '') || !['text', 'select', 'multi', 'confirm'].includes(item.kind) || questions.some((q) => q.id === item.id)) continue;
    const options = (Array.isArray(item.options) ? item.options : []).slice(0, 20)
      .filter((option) => option && typeof option.value === 'string' && option.value.length <= 200)
      .map((option) => ({ value: option.value, label: clip(option.label || option.value, 80), detail: option.detail ? clip(option.detail, 140) : null }));
    if ((item.kind === 'select' || item.kind === 'multi') && !options.length) continue;
    questions.push({ id: item.id, kind: item.kind, label: clip(item.label, 140) || item.id, help: item.help ? clip(item.help, 240) : null, options, default: item.default == null ? null : clip(item.default, 200) });
  }
  const actions = [];
  for (const item of Array.isArray(data?.actions) ? data.actions.slice(0, 16) : []) {
    const action = { type: item?.type, app: item?.app ?? null, key: item?.key ?? null, value: item?.value ?? null, answer: item?.answer ?? null, why: clip(item?.why, 160) };
    if (!ACTION_TYPES.includes(action.type)) continue;
    if (action.answer && !questions.some((q) => q.id === action.answer)) action.answer = null;
    if (action.type === 'set_setting') {
      if (!SETTINGS[action.key] || (!action.answer && !SETTINGS[action.key].pattern.test(action.value ?? ''))) continue;
      action.app = null;
    } else {
      if (!appNames.includes(action.app)) continue;
      if (action.type === 'set_config' && (!CONFIG_KEYS[action.key] || (!action.answer && !CONFIG_KEYS[action.key].pattern.test(action.value ?? '')))) continue;
      if (action.type === 'add_profile' && !PROFILES[action.value]) continue;
    }
    if (actions.some((other) => other.type === action.type && other.app === action.app && other.key === action.key && other.value === action.value)) continue;
    actions.push(action);
  }
  return { say: clip(data?.say, 500), questions, actions, notes: [], done: data?.done !== false };
}

// The agent's review, with any certain fix of macbuild's that it left out put back.
export function mergeReview(agent, own) {
  const out = { ...agent, questions: [...agent.questions], actions: [...agent.actions] };
  for (const action of own.actions) {
    if (out.actions.some((other) => other.type === action.type && other.app === action.app && (other.key ?? null) === (action.key ?? null))) continue;
    out.actions.push(action);
    const question = own.questions.find((q) => q.id === action.answer);
    if (question && !out.questions.some((q) => q.id === question.id)) out.questions.push(question);
  }
  out.notes = [...(agent.notes ?? []), ...own.notes];
  return out;
}

// What a fix does, in a few words. The app it's for is shown next to it (actionApp), not in the sentence.
export function describeAction(action, answers = {}) {
  const value = action.answer ? answers[action.answer] ?? '' : action.value ?? '';
  const to = value ? ` to ${value}` : '';
  switch (action.type) {
    case 'create_eas_json': return 'Add an eas.json';
    case 'add_profile': return `Add a ${action.value} profile to eas.json`;
    case 'set_config': return `Set the ${CONFIG_KEYS[action.key]?.label ?? action.key}${to}`;
    case 'link_eas': return 'Link it to an EAS project (eas init)';
    case 'install_dev_client': return 'Install expo-dev-client';
    case 'set_setting': return `Save ${SETTINGS[action.key]?.label ?? action.key}${to}`;
    default: return action.type;
  }
}
const actionApp = (action) => (action.type === 'set_setting' ? 'macbuild' : action.app);

// ---------- doing things ----------

const indentOf = (text) => text.match(/^[ \t]+(?=")/m)?.[0] ?? '  ';
function writeJsonLike(file, data, previous = '') {
  writeFileSync(file, `${JSON.stringify(data, null, indentOf(previous))}\n`);
}

export function writeSetting(file, key, value) {
  const meta = SETTINGS[key];
  if (!meta) throw new Error(`can’t set ${key}`);
  if (value && !meta.pattern.test(value)) throw new Error(`that doesn’t look like ${meta.label}`);
  const line = `${key}=${/\s/.test(value) ? `"${value}"` : value}`;
  mkdirSync(dirname(file), { recursive: true });
  const lines = existsSync(file) ? readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : [];
  const at = lines.findIndex((item) => item.startsWith(`${key}=`));
  if (at >= 0) lines[at] = line; else lines.push(line);
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
}
export function readSetting(file, key) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  return text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? '';
}

async function tool(cmd, args, cwd, timeout) {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd, timeout, maxBuffer: 1 << 22, env: { ...process.env, CI: '1', NO_COLOR: '1' } });
    return { ok: true, text: `${stdout}\n${stderr}` };
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, text: cmd === 'eas' ? 'eas isn’t installed (npm install -g eas-cli)' : `${cmd} isn’t installed` };
    const text = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message}`;
    const line = text.split('\n').map((item) => item.trim()).filter(Boolean).find((item) => /error|failed|not|can’t|cannot/i.test(item)) ?? error.message;
    return { ok: false, text: clip(line, 200) };
  }
}

export async function applyAction(action, { answers = {}, apps, envFile }) {
  const app = apps.find((item) => item.name === action.app);
  const value = String(action.answer ? answers[action.answer] ?? '' : action.value ?? '').trim();
  const label = describeAction(action, answers);
  const done = (ok, text = '') => ({ ok, label, text });
  if (action.type !== 'set_setting' && !app) return done(false, 'unknown app');
  try {
    switch (action.type) {
      case 'create_eas_json': {
        const file = join(app.dir, 'eas.json');
        if (existsSync(file)) return done(true, 'already there');
        writeJsonLike(file, DEFAULT_EAS);
        return done(true);
      }
      case 'add_profile': {
        const file = join(app.dir, 'eas.json');
        const text = readFileSync(file, 'utf8');
        const eas = JSON.parse(text);
        eas.build ??= {};
        if (eas.build[action.value]) return done(true, 'already there');
        if (!PROFILES[action.value]) return done(false, 'unknown profile');
        eas.build[action.value] = PROFILES[action.value];
        writeJsonLike(file, eas, text);
        return done(true);
      }
      case 'set_config': {
        const meta = CONFIG_KEYS[action.key];
        if (!meta || !meta.pattern.test(value)) return done(false, `${value || 'An empty value'} isn’t a valid ${meta?.label ?? 'value'}, like ${meta?.example ?? ''}`);
        const file = join(app.dir, 'app.json');
        const text = readFileSync(file, 'utf8');
        const data = JSON.parse(text);
        if (!data.expo || typeof data.expo !== 'object') return done(false, 'app.json has no expo section');
        const [section, key] = action.key.split('.');
        data.expo[section] = { ...(data.expo[section] ?? {}), [key]: value };
        writeJsonLike(file, data, text);
        return done(true);
      }
      case 'link_eas': {
        const result = await tool('eas', ['init', '--non-interactive', '--force'], app.dir, 120000);
        return done(result.ok, result.ok ? '' : result.text);
      }
      case 'install_dev_client': {
        const result = await tool('npx', ['--yes', 'expo', 'install', 'expo-dev-client'], app.dir, 300000);
        return done(result.ok, result.ok ? '' : result.text);
      }
      case 'set_setting':
        writeSetting(envFile, action.key, value);
        return done(true);
      default:
        return done(false, 'not something macbuild can do');
    }
  } catch (error) {
    return done(false, clip(error.message, 200));
  }
}

// Fixes for doctor's MISS lines that can run in a terminal. The rest need the user (Xcode comes from the App Store).
const TOOL_FIXES = {
  cocoapods: { label: 'Install CocoaPods', argv: ['brew', 'install', 'cocoapods'] },
  fastlane: { label: 'Install fastlane', argv: ['brew', 'install', 'fastlane'] },
  'eas-cli': { label: 'Install eas-cli', argv: ['npm', 'install', '-g', 'eas-cli'] },
  'expo-login': { label: 'Sign in to Expo', argv: ['eas', 'login'] },
  git: { label: 'Install the command line tools', argv: ['xcode-select', '--install'] },
};
const TOOL_HELP = {
  xcode: 'Install Xcode from the App Store and open it once. Then run: sudo xcode-select -s /Applications/Xcode.app',
  node: 'Install Node.js 20 or newer, from nodejs.org or with brew install node.',
  macos: 'iOS builds need a Mac.',
};

// ---------- the flow ----------

const fresh = (agent = null) => ({
  version: 1, step: 'welcome', agent, found: null, findSay: '', findBy: '', searched: [], added: [],
  review: null, turns: [], signing: {}, flash: null, installUi: false, buildRequest: null, buildId: null,
  job: null, startedAt: Date.now(), doneAt: null,
});

export class SetupFlow extends EventEmitter {
  constructor({ home = process.env.HOME || homedir(), bin = join(ROOT, 'bin/macbuild'), surface = 'cli', hooks = {} } = {}) {
    super();
    this.paths = setupPaths(home);
    this.home = home;
    this.bin = bin;
    this.surface = surface;
    this.hooks = hooks;
    this.current = null; // { kind, promise, controller } for a job this process runs
    this.cache = {};
    this.state = this.load();
  }

  load() {
    if (this.current) return this.state;
    const saved = readJson(this.paths.state);
    this.state = saved?.version === 1 ? { ...fresh(), ...saved } : fresh();
    const job = this.state.job;
    if (job && job.pid !== process.pid && !pidAlive(job.pid)) {
      // The process running it is gone: start over from that step.
      this.state.job = null;
      if (job.kind === 'find') this.state.found = null;
      if (job.kind === 'check' || job.kind === 'apply') this.state.review = null;
    } else if (job && job.pid === process.pid && !this.current) {
      this.state.job = null;
    }
    return this.state;
  }
  save() {
    mkdirSync(dirname(this.paths.state), { recursive: true });
    writeFileSync(this.paths.state, `${JSON.stringify(this.state, null, 2)}\n`);
    this.emit('change');
  }
  reset() {
    this.current?.controller.abort();
    this.current = null;
    this.state = fresh(this.state.agent);
    this.cache = {};
    this.save();
  }
  isDone() { return Boolean(this.load().doneAt); }

  projects() { return readProjects(this.paths.projects); }
  targets() {
    const all = this.projects();
    const added = this.state.added.length ? all.filter((item) => this.state.added.includes(item.name)) : all;
    return added.filter((item) => isDir(item.dir));
  }
  async agents() {
    if (!this.cache.agents) this.cache.agents = this.hooks.agents ? await this.hooks.agents() : await detectAgents(this.home);
    return this.cache.agents;
  }
  async doctor(fresh = false) {
    if (!fresh && this.cache.doctor && Date.now() - this.cache.doctor.at < 20000) return this.cache.doctor.data;
    let data;
    if (this.hooks.doctor) data = await this.hooks.doctor(fresh);
    else {
      data = await run(this.bin, ['doctor', '--json'], { timeout: 40000, maxBuffer: 1 << 20, env: { ...process.env, MACBUILD_LOCAL: '1' } })
        .then(({ stdout }) => stdout).catch((error) => error.stdout ?? '')
        .then((stdout) => { try { return JSON.parse(stdout.trim().split('\n').filter(Boolean).at(-1)); } catch { return { ok: false, items: [] }; } });
    }
    this.cache.doctor = { at: Date.now(), data };
    return data;
  }
  async devices() {
    if (!this.cache.devices || Date.now() - this.cache.devices.at > 30000) {
      const items = await (this.hooks.devices ? this.hooks.devices() : listDevices()).catch(() => []);
      this.cache.devices = { at: Date.now(), items: items.filter((item) => item.type === 'iPhone' && item.paired !== false) };
    }
    return this.cache.devices.items;
  }
  builds() {
    const dir = this.paths.history;
    if (!isDir(dir)) return [];
    return readdirSync(dir).map((id) => readJson(join(dir, id, 'meta.json'))).filter(Boolean);
  }
  uiInstalled() { return this.hooks.uiInstalled ? this.hooks.uiInstalled() : existsSync(this.paths.uiPlist); }

  flash(notes) { this.state.flash = { step: this.state.step, notes: [...(this.state.flash?.step === this.state.step ? this.state.flash.notes : []), ...notes] }; }
  // Notes made while answering a step ("Added notes") move on with it to the next one.
  go(step) {
    this.state.step = step;
    if (this.state.flash) this.state.flash = { ...this.state.flash, step };
  }

  // ---------- jobs: work that takes a while runs in the background, and the screen shows it as busy ----------

  startJob(kind, label, work) {
    if (this.current) return this.current.promise;
    const controller = new AbortController();
    this.state.job = { kind, label, agent: this.state.agent, pid: process.pid, startedAt: Date.now(), activity: [] };
    this.save();
    let last = 0;
    const activity = (line) => {
      if (!line || !this.state.job) return;
      const items = this.state.job.activity;
      if (items.at(-1)?.text === line) return;
      items.push({ text: line, at: Date.now() });
      if (items.length > 40) items.splice(0, items.length - 40);
      // Other processes (the dashboard while the terminal runs setup) read this file; don't rewrite it on every line.
      if (Date.now() - last > 400) { last = Date.now(); this.save(); } else this.emit('change');
    };
    const promise = (async () => {
      try {
        await new Promise((done) => { setImmediate(done); }); // return to the caller first, so it can show the busy screen
        await work({ signal: controller.signal, activity });
      } catch (error) {
        this.flash([{ tone: 'bad', text: `Something went wrong: ${clip(error.message, 200)}` }]);
      } finally {
        this.current = null;
        this.state.job = null;
        this.save();
      }
    })();
    this.current = { kind, promise, controller };
    return promise;
  }
  skipAgent() { this.current?.controller.abort(); }
  wait() { return this.current?.promise ?? Promise.resolve(); }

  async find({ signal, activity }) {
    const { home } = this;
    const state = this.state;
    activity('Looking in your usual project folders');
    const candidates = quickScan({ home, extra: state.searched });
    const known = this.projects();
    let apps = candidates.map((app) => ({ ...app, name: '', note: app.easJson ? null : 'no eas.json yet', suggested: suggestedPath(app.path) }));
    let say = ''; let by = 'macbuild';
    if (state.agent && state.agent !== 'none') {
      const label = agentLabel(state.agent);
      activity(`Asking ${label} to look around`);
      const slim = (app) => ({ path: app.path, title: app.title, framework: app.framework, sdk: app.sdk, easJson: app.easJson, dynamicConfig: app.dynamic, repo: app.repo });
      const result = await this.agentRun({
        task: 'find', signal, activity,
        context: {
          home, roots: scanRoots(home, state.searched), extraFolders: state.searched, candidates: candidates.map(slim),
          alreadyAdded: known.map((item) => ({ name: item.name, path: item.dir })),
        },
      });
      if (result.ok) {
        const theirs = sanitizeFound(result.data.apps, home);
        const seen = new Set(theirs.map((app) => app.path));
        apps = [...theirs, ...apps.filter((app) => !seen.has(app.path))];
        say = clip(result.data.say, 400);
        by = label;
      } else if (result.cancelled) {
        this.flash([{ tone: 'info', text: 'Skipped the agent. These are from macbuild’s own scan.' }]);
      } else {
        this.flash([{ tone: 'warn', text: `${label} couldn’t finish: ${result.error} These are from macbuild’s own scan.` }]);
      }
    }
    // Apps already in macbuild that live outside the scanned folders.
    const listed = new Set(apps.map((app) => real(app.path)));
    for (const item of known) {
      if (isDir(item.dir) && !listed.has(real(item.dir))) apps.push({ ...readApp(real(item.dir)), name: item.name, note: null, suggested: true });
    }
    nameApps(apps, known);
    state.found = apps.map(({ profileInfo, ...app }) => app);
    state.findSay = say;
    state.findBy = by;
  }

  async agentRun({ task, context, signal, activity }) {
    const agents = await this.agents();
    const agent = agents.find((item) => item.id === this.state.agent);
    if (!agent?.found) return { ok: false, error: `${agentLabel(this.state.agent)} isn’t installed.` };
    return (this.hooks.runAgent ?? runAgent)({ agent: agent.id, bin: agent.bin, task, context, cwd: this.home, home: this.home, signal, onActivity: activity });
  }

  async describeTargets(activity = () => {}) {
    const doctor = await this.doctor();
    const login = doctor.items?.find((item) => item.id === 'expo-login');
    const loggedIn = login ? login.status === 'ok' : true;
    const owner = (loggedIn && login?.detail && !/\s/.test(login.detail) ? login.detail : '') || userInfo().username;
    const builds = this.builds();
    const apps = [];
    for (const target of this.targets()) {
      activity(`Checking ${target.name}`);
      const app = { ...readApp(target.dir), name: target.name };
      if (app.dynamic) app.resolved = await this.resolveConfig(app.path, activity);
      apps.push(app);
    }
    const issues = apps.flatMap((app) => checkApp(app, { owner: app.owner || owner, loggedIn, builds }));
    return { apps, issues, loggedIn, owner, doctor };
  }

  // app.config.* is code: ask the project's own expo CLI what it evaluates to. Null when that isn't possible.
  async resolveConfig(dir, activity) {
    if (this.hooks.resolveConfig) return this.hooks.resolveConfig(dir);
    let bin = '';
    for (let at = dir; at !== dirname(at); at = dirname(at)) {
      if (existsSync(join(at, 'node_modules/.bin/expo'))) { bin = join(at, 'node_modules/.bin/expo'); break; }
    }
    if (!bin) return null;
    activity(`Evaluating ${basename(dir)}’s app config`);
    try {
      const { stdout } = await run(bin, ['config', '--json', '--type', 'public'], { cwd: dir, timeout: 45000, maxBuffer: 1 << 22, env: { ...process.env, CI: '1' } });
      return JSON.parse(stdout.slice(stdout.indexOf('{')));
    } catch { return null; }
  }

  async check({ signal, activity }) {
    const state = this.state;
    const { apps, issues, loggedIn, doctor } = await this.describeTargets(activity);
    const own = ownReview(apps, issues);
    let review = { ...own, by: 'macbuild' };
    if (apps.length && state.agent && state.agent !== 'none') {
      const label = agentLabel(state.agent);
      activity(`Asking ${label} to check ${list(apps.map((app) => app.name))}`);
      const slim = ({ profileInfo, resolved, repoRoot, ...app }) => ({ ...app, profiles: (profileInfo ?? []).map((p) => ({ name: p.name, distribution: p.distribution, developmentClient: p.developmentClient, simulator: p.ios.simulator })), resolvedConfig: resolved ? { ios: resolved.ios ?? null, android: resolved.android ?? null, extra: resolved.extra ?? null, owner: resolved.owner ?? null } : null });
      const result = await this.agentRun({
        task: 'check', signal, activity,
        context: {
          apps: apps.map(slim),
          issues: issues.map(({ action, ...issue }) => ({ ...issue, fix: action ? describeAction(action) : null })),
          expo: { loggedIn, account: doctor.items?.find((item) => item.id === 'expo-login')?.detail ?? null },
          tools: (doctor.items ?? []).map((item) => ({ id: item.id, status: item.status, detail: item.detail })),
          previous: state.turns,
        },
      });
      if (result.ok) review = { ...mergeReview(sanitizeReview(result.data, apps.map((app) => app.name)), own), by: label };
      else if (result.cancelled) review.notes = [{ tone: 'info', text: 'Skipped the agent. These are macbuild’s own checks.' }, ...review.notes];
      else review.notes = [{ tone: 'warn', text: `${label} couldn’t check: ${result.error} These are macbuild’s own checks.` }, ...review.notes];
    }
    if (!review.say) review.say = own.say;
    review.actions = markOptional(review.actions, apps, this.builds());
    state.review = review;
  }

  async apply(chosen, answers, { activity }) {
    const state = this.state;
    const apps = this.targets();
    const results = [];
    for (const action of chosen) {
      activity(`${actionApp(action)}: ${describeAction(action, answers)}`);
      results.push(await applyAction(action, { answers, apps, envFile: this.paths.env }));
    }
    const answered = Object.fromEntries((state.review?.questions ?? []).map((q) => [q.id, answers[q.id] ?? null]));
    state.turns.push({ say: state.review?.say ?? '', answers: answered, results: results.map(({ ok, label, text }) => ({ ok, label, text })) });
    const failed = results.filter((result) => !result.ok);
    const worked = results.filter((result) => result.ok);
    this.flash([
      ...(worked.length > 2 ? [{ tone: 'ok', text: `Applied ${worked.length} fixes.` }]
        : results.map((result, index) => ({ result, index })).filter(({ result }) => result.ok).map(({ result, index }) => ({ tone: 'ok', text: `${actionApp(chosen[index])}: ${result.label}${result.text ? ` (${result.text})` : ''}` }))),
      ...results.map((result, index) => ({ result, index })).filter(({ result }) => !result.ok).map(({ result, index }) => ({ tone: 'bad', text: `${actionApp(chosen[index])}: ${describeAction(chosen[index])}. ${result.text}` })),
    ]);
    if (failed.length) {
      // Stay on this step with only what didn't work, so the answer can be corrected.
      const left = chosen.filter((action, index) => !results[index].ok);
      const questions = state.review.questions.filter((q) => left.some((action) => action.answer === q.id)).map((q) => ({ ...q, default: answers[q.id] ?? q.default }));
      state.review = { ...state.review, actions: left, questions };
      return;
    }
    const again = state.agent && state.agent !== 'none' && !state.review?.done && state.turns.length < 3;
    if (again) { state.review = null; return; }
    this.go('signing');
  }

  // ---------- screens ----------

  screen(spec) {
    const state = this.state;
    const index = STEPS.findIndex((step) => step.id === state.step);
    const flash = state.flash?.step === state.step ? state.flash.notes : [];
    return {
      step: state.step,
      steps: STEPS.map((step, at) => ({ ...step, state: state.step === 'done' || at < index ? 'done' : at === index ? 'current' : 'todo' })),
      title: '', lead: '', by: null, notes: [], fields: [], commands: [], buttons: [], busy: null,
      back: index > 0 && state.step !== 'done' ? STEPS[index - 1].id : null,
      ...spec,
      notes: [...flash, ...(spec.notes ?? [])],
    };
  }

  async view() {
    const state = this.load();
    if (state.job) {
      const job = state.job;
      const titles = { find: 'Finding your apps', check: 'Checking your apps', apply: 'Applying fixes' };
      return this.screen({
        title: titles[job.kind] ?? job.label,
        busy: { kind: job.kind, label: job.label, agent: job.agent && job.agent !== 'none' ? agentLabel(job.agent) : null, startedAt: job.startedAt, activity: job.activity.slice(-8).map((item) => item.text), mine: Boolean(this.current) },
        buttons: job.kind === 'apply' ? [] : job.agent && job.agent !== 'none' ? [{ id: 'skip', label: 'Skip the agent' }] : [],
      });
    }
    const view = await (VIEWS[state.step] ?? VIEWS.welcome).call(this, state);
    // The line for a terminal, for the dashboard's Copy button.
    return { ...view, commands: view.commands.map((command) => ({ ...command, line: this.terminalLine(command) })) };
  }

  async submit({ step, button = 'continue', values = {} } = {}) {
    const state = this.load();
    if (state.job) {
      if (button === 'skip' && this.current) { this.skipAgent(); return { ok: true }; }
      return { error: 'Setup is busy. Wait for it to finish.' };
    }
    if (button === 'restart') { this.reset(); return { ok: true }; }
    if (button === 'back' && values.to && STEPS.some((item) => item.id === values.to)) {
      const target = STEPS.findIndex((item) => item.id === values.to);
      if (target <= STEPS.findIndex((item) => item.id === state.step) || state.step === 'done') {
        this.go(values.to);
        if (values.to === 'review') state.review = null;
        state.doneAt = null;
        this.save();
      }
      return { ok: true };
    }
    if (step && step !== state.step) return { error: 'That step has changed. Look again.' };
    state.flash = null; // notes from this answer replace the last ones
    const handler = SUBMITS[state.step];
    const result = handler ? await handler.call(this, state, button, values) : null;
    this.save();
    return result ?? { ok: true };
  }

  // A command from the screen, run in a terminal. Signing is recorded so the screen can show it's done.
  mark(id, code) {
    this.load();
    if (id.startsWith('signing:')) this.state.signing[id] = { status: Number(code) === 0 ? 'done' : 'failed', at: Date.now() };
    if (id.startsWith('tool:')) this.cache.doctor = null;
    this.save();
  }
  async command(id) {
    const view = await this.view();
    return view.commands.find((item) => item.id === id) ?? null;
  }
  // The line to paste into a terminal; with the mark, the screen updates when it finishes.
  terminalLine(command) {
    const line = `cd ${quote(command.cwd)} && ${command.display}`;
    return command.id.startsWith('signing:') ? `${line}; ${quote(this.bin)} setup --mark ${quote(command.id)} $?` : line;
  }
  finish() {
    this.state.doneAt = Date.now();
    this.go('done');
    // The dashboard's "setup items to fix" banner goes too.
    const ui = readJson(this.paths.ui) ?? {};
    mkdirSync(dirname(this.paths.ui), { recursive: true });
    writeFileSync(this.paths.ui, JSON.stringify({ ...ui, setupComplete: true }, null, 2));
  }
}

const tick = (value) => (Array.isArray(value) ? value : String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean));
const yes = (value) => value === true || value === 'true' || value === 'on' || value === '1' || value === 'yes';

function fieldFromQuestion(question) {
  const base = { id: `q:${question.id}`, kind: question.kind, label: question.label, help: question.help, options: question.options.map((option) => ({ value: option.value, label: option.label, detail: option.detail })) };
  if (question.kind === 'multi') return { ...base, value: tick(question.default) };
  if (question.kind === 'confirm') return { ...base, value: question.default == null ? true : yes(question.default) };
  if (question.kind === 'select') return { ...base, value: question.default ?? question.options[0]?.value ?? '' };
  return { ...base, value: question.default ?? '', placeholder: question.default ?? '' };
}

const VIEWS = {
  async welcome(state) {
    const agents = await this.agents();
    const found = agents.filter((agent) => agent.found);
    const options = [
      ...agents.map((agent) => ({ value: agent.id, label: agent.label, detail: agent.found ? `Installed${agent.version ? ` · ${agent.version}` : ''}` : 'Not installed', disabled: !agent.found })),
      { value: 'none', label: 'No agent', detail: 'macbuild’s own scan and checks' },
    ];
    const value = (state.agent && options.some((option) => option.value === state.agent && !option.disabled)) ? state.agent : found[0]?.id ?? 'none';
    return this.screen({
      title: 'Welcome to macbuild',
      lead: 'Build your Expo apps on this Mac, without a build queue. Setup finds your apps, checks your tools, sets up signing and starts your first build. An agent can do the looking around and ask you only what it needs.',
      fields: [{ id: 'agent', kind: 'select', label: 'Which agent should help?', help: 'It only reads files. macbuild shows you every change before making it.', options, value }],
      notes: found.length ? [] : [{ tone: 'info', text: 'Claude Code and Codex aren’t installed here. macbuild’s own checks work too.' }],
      buttons: [{ id: 'continue', label: 'Continue', primary: true }],
    });
  },

  async apps(state) {
    if (state.found === null) {
      const agent = state.agent && state.agent !== 'none' ? agentLabel(state.agent) : null;
      this.startJob('find', agent ? `${agent} is looking for your apps` : 'Looking for your apps', (ctx) => this.find(ctx));
      return this.view();
    }
    const known = new Set(this.projects().map((item) => real(item.dir)));
    const apps = state.found.map((app) => ({ ...app, added: known.has(real(app.path)) }));
    const missingEas = apps.some((app) => !app.easJson && !app.added);
    const detail = (app) => [tilde(app.path, this.home), app.framework === 'react-native' ? 'React Native' : app.sdk ? `Expo SDK ${app.sdk}` : 'Expo', app.platforms.map(platformName).join(' + '), app.note].filter(Boolean).join(' · ');
    const fields = apps.length ? [{
      id: 'apps', kind: 'multi', label: 'Add which apps?',
      options: apps.map((app) => ({ value: app.path, label: app.title && slugify(app.title) !== app.name ? `${app.title} (${app.name})` : app.name, detail: detail(app), badge: app.added ? 'Added' : null, disabled: app.added })),
      value: apps.filter((app) => app.added || app.suggested).map((app) => app.path),
    }] : [];
    if (missingEas) fields.push({ id: 'easjson', kind: 'confirm', label: 'Add an eas.json where there isn’t one', help: 'With development, preview and production profiles, like eas build:configure makes.', value: true });
    fields.push({ id: 'folder', kind: 'text', for: 'search', label: 'Folder', placeholder: '~/work', help: 'Where else you keep code.' });
    const by = state.findBy || 'macbuild';
    return this.screen({
      title: apps.length ? `${by} found ${plural(apps.length, 'app')}` : 'No apps found yet',
      lead: state.findSay || (apps.length ? 'Pick the ones to build with macbuild. You can add more later with macbuild add.' : 'macbuild looked in your usual code folders. Point it at the folder where your apps are.'),
      by: by === 'macbuild' ? null : by,
      fields,
      buttons: [{ id: 'continue', label: apps.length ? 'Add apps' : 'Continue without apps', primary: true }, { id: 'search', label: 'Search another folder' }],
    });
  },

  async tools() {
    const report = await this.doctor();
    const items = (report.items ?? []).filter((item) => !['projects'].includes(item.id));
    const misses = items.filter((item) => item.status === 'miss');
    const commands = misses.filter((item) => TOOL_FIXES[item.id]).map((item) => {
      const fix = TOOL_FIXES[item.id];
      return { id: `tool:${item.id}`, label: fix.label, detail: item.detail, argv: fix.argv, cwd: this.home, display: fix.argv.map(quote).join(' '), status: 'todo' };
    });
    if (misses.some((item) => item.id === 'tailscale')) {
      const argv = [this.bin, 'setup', '--tailscale'];
      commands.push({ id: 'tool:tailscale', label: 'Put the dashboard on your tailnet', detail: misses.find((item) => item.id === 'tailscale').detail, argv, cwd: this.home, display: argv.map(quote).join(' '), status: 'todo', optional: true });
    }
    const notes = misses.filter((item) => !TOOL_FIXES[item.id] && item.id !== 'tailscale').map((item) => ({ tone: 'warn', text: `${item.label}: ${TOOL_HELP[item.id] ?? item.detail}` }));
    const ok = items.filter((item) => item.status === 'ok');
    if (ok.length) notes.push({ tone: 'ok', text: `Ready: ${ok.map((item) => (item.detail && item.detail.length < 28 && !/^installed|signed in$/.test(item.detail) ? `${item.label} ${item.detail.replace(/^(Xcode|eas-cli\/)\s*/, '')}` : item.label)).join(', ')}` });
    const optional = items.filter((item) => item.status === 'skip');
    if (optional.length) notes.push({ tone: 'info', text: `Optional: ${list(optional.map((item) => item.label))}. macbuild doctor says what each one adds.` });
    if (!items.length) notes.push({ tone: 'warn', text: `macbuild doctor didn’t answer${report.error ? `: ${report.error}` : ''}.` });
    const required = misses.filter((item) => item.id !== 'tailscale');
    return this.screen({
      title: required.length ? cap(`${plural(required.length, 'tool')} to set up`) : 'Your tools are ready',
      lead: required.length ? 'Builds need these. Run each command here or in a terminal, then check again.' : 'Everything a build needs is on this Mac.',
      commands, notes,
      buttons: required.length
        ? [{ id: 'recheck', label: 'Check again', primary: true }, { id: 'continue', label: 'Continue anyway' }]
        : [{ id: 'continue', label: 'Continue', primary: true }, { id: 'recheck', label: 'Check again' }],
    });
  },

  async review(state) {
    if (!this.targets().length) {
      return this.screen({ title: 'No apps to check', lead: 'Add an app on the Apps step, or later with macbuild add <name> <folder>.', buttons: [{ id: 'continue', label: 'Continue', primary: true }] });
    }
    if (state.review === null) {
      const agent = state.agent && state.agent !== 'none' ? agentLabel(state.agent) : null;
      this.startJob('check', agent ? `${agent} is checking your apps` : 'Checking your apps', (ctx) => this.check(ctx));
      return this.view();
    }
    const { questions = [], actions = [], notes = [], say, by } = state.review;
    // A question that one fix needs is drawn inside that fix; the rest stand on their own above the fixes.
    const owner = (q) => { const users = actions.map((action, index) => [action, index]).filter(([action]) => action.answer === q.id); return users.length === 1 ? users[0][1] : -1; };
    const fields = questions.map((q) => {
      const field = fieldFromQuestion(q);
      const at = owner(q);
      return at >= 0 && q.kind === 'text' ? { ...field, attach: { field: 'apply', option: String(at) } } : field;
    });
    if (actions.length) {
      fields.push({
        id: 'apply', kind: 'multi', label: actions.length === 1 ? 'Fix' : 'Fixes',
        options: actions.map((action, index) => ({ value: String(index), tag: actionApp(action), label: describeAction(action), detail: `${action.why}${action.optional ? '. Only Android builds need it.' : ''}` })),
        value: actions.map((action, index) => (action.optional ? null : String(index))).filter(Boolean),
      });
    }
    return this.screen({
      title: actions.some((action) => !action.optional) ? cap(`${plural(actions.filter((action) => !action.optional).length, 'fix', 'fixes')} before your first build`) : actions.length ? 'Your apps are almost ready' : 'Your apps are ready',
      lead: say, by: by && by !== 'macbuild' ? by : null, fields, notes,
      buttons: actions.length
        ? [{ id: 'apply', label: actions.length === 1 ? 'Apply the fix' : 'Apply fixes', primary: true }, { id: 'continue', label: 'Skip' }]
        : [{ id: 'continue', label: 'Continue', primary: true }, { id: 'recheck', label: 'Check again' }],
    });
  },

  async signing(state) {
    const builds = this.builds();
    const commands = []; const proven = [];
    for (const target of this.targets()) {
      const app = readApp(target.dir);
      const dev = devProfile(app.profileInfo); const store = storeProfile(app.profileInfo);
      for (const platform of ['ios', 'android'].filter((item) => app.platforms.includes(item))) {
        for (const [kind, profile] of [['development', dev], ['store', store]]) {
          if (!profile || profile[platform].simulator) continue;
          const id = `signing:${target.name}:${platform}:${profile.name}`;
          const built = builds.some((build) => build.project === target.name && (build.platform ?? 'ios') === platform && build.profile === profile.name && build.status === 'success');
          const argv = ['eas', 'credentials:configure-build', '--platform', platform, '--profile', profile.name];
          if (built && !state.signing[id]) { proven.push(`${target.name} ${platformName(platform)} ${profile.name}`); continue; }
          commands.push({
            id, label: `${target.name} · ${platformName(platform)} · ${profile.name}`,
            detail: platform === 'ios' ? (kind === 'development' ? 'For installing on your iPhone. EAS registers your devices with Apple.' : 'For TestFlight and the App Store.')
              : kind === 'development' ? 'Creates the keystore that signs your Android builds.' : 'For Google Play.',
            argv, cwd: target.dir, display: argv.map(quote).join(' '),
            status: state.signing[id]?.status ?? (built ? 'done' : 'todo'),
            optional: !(platform === 'ios' && kind === 'development'),
          });
        }
      }
    }
    const doctor = await this.doctor();
    const login = doctor.items?.find((item) => item.id === 'expo-login');
    const notes = [{ tone: 'info', text: 'Each one runs eas credentials in a terminal. You sign in to Apple or Google there, and EAS keeps the certificates. macbuild and the agent never see your password.' }];
    if (login && login.status !== 'ok') notes.unshift({ tone: 'warn', text: 'Sign in to Expo first: run eas login (the Tools step has it).' });
    if (proven.length) notes.unshift({ tone: 'ok', text: `Already working, from builds on this Mac: ${list(proven)}.` });
    const todo = commands.filter((item) => item.status !== 'done' && !item.optional).length;
    return this.screen({
      title: commands.length || proven.length ? 'Set up signing' : 'No apps to sign',
      lead: commands.length
        ? `EAS stores your certificates and profiles, so builds sign the app without asking. Do it once per app and kind of build.${todo ? '' : ' The ones you need are done.'}`
        : 'Add an app first, or set signing up later with eas credentials in the app’s folder.',
      commands, notes: commands.length || proven.length ? notes : [],
      buttons: [{ id: 'continue', label: todo ? 'Continue' : 'Continue', primary: true }],
    });
  },

  async mac() {
    const fields = []; const notes = [];
    if (!this.uiInstalled()) {
      fields.push({ id: 'dashboard', kind: 'confirm', label: 'Run the dashboard at login', help: 'Builds, logs and installs at http://localhost:4180, on your iPhone too with Tailscale, and a hammer in the menu bar.', value: true });
    } else notes.push({ tone: 'ok', text: 'The dashboard runs at login.' });
    const phones = await this.devices();
    const current = readSetting(this.paths.env, 'MACBUILD_DEVICE');
    if (phones.length) {
      fields.push({
        id: 'phone', kind: 'select', label: 'Install builds on which iPhone?', help: 'For macbuild <app> --install.',
        options: [...phones.map((phone) => ({ value: phone.id, label: phone.name, detail: [phone.model, phone.wifi ? 'Wi-Fi' : phone.wired ? 'USB' : ''].filter(Boolean).join(' · ') })), { value: '', label: 'None', detail: 'Set it later in ~/.config/macbuild/env' }],
        value: phones.some((phone) => phone.id === current || phone.udid === current) ? phones.find((phone) => phone.id === current || phone.udid === current).id : phones[0].id,
      });
    } else notes.push({ tone: 'info', text: 'No iPhone is paired with this Mac yet. To install builds on yours, connect it with a cable once and tap Trust.' });
    fields.push({ id: 'appleId', kind: 'text', label: 'Apple ID', help: 'Optional. Builds use it to sign in to Apple without asking which account. Your password stays out of macbuild.', placeholder: 'you@example.com', value: readSetting(this.paths.env, 'MACBUILD_APPLE_ID') });
    return this.screen({ title: 'This Mac', lead: 'A few settings for builds on this Mac. Change them any time in ~/.config/macbuild/env.', fields, notes, buttons: [{ id: 'continue', label: 'Continue', primary: true }] });
  },

  async build() {
    const targets = this.targets();
    const phone = readSetting(this.paths.env, 'MACBUILD_DEVICE');
    const phones = phone ? await this.devices() : [];
    const phoneName = phones.find((item) => item.id === phone || item.udid === phone)?.name ?? (phone ? 'your iPhone' : '');
    const options = targets.map((target) => {
      const dev = existsSync(join(target.dir, 'eas.json')) ? devProfile(readApp(target.dir).profileInfo) : null;
      return { value: target.name, label: target.name, detail: dev ? `${dev.name} profile · iOS` : 'needs a development profile', disabled: !dev };
    });
    const ready = options.filter((option) => !option.disabled);
    if (!ready.length) {
      return this.screen({ title: 'Almost done', lead: targets.length ? 'None of your apps has a development profile yet, so there’s nothing to try. Add one to eas.json, then run macbuild <app>.' : 'Add an app with macbuild add <name> <folder>, then build it with macbuild <name>.', buttons: [{ id: 'finish', label: 'Finish', primary: true }] });
    }
    const fields = [{ id: 'app', kind: 'select', label: 'Build which app?', options, value: ready[0].value }];
    if (phoneName) fields.push({ id: 'install', kind: 'confirm', label: `Install it on ${phoneName} when it’s done`, value: true });
    return this.screen({
      title: 'Try your first build',
      lead: 'A development build of your app, signed for your devices. The first one takes 10 to 20 minutes; later ones reuse what they can.',
      fields,
      buttons: [{ id: 'build', label: 'Start the build', primary: true }, { id: 'finish', label: 'Finish without building' }],
    });
  },

  async done(state) {
    const targets = this.targets();
    const notes = [];
    if (targets.length) notes.push({ tone: 'ok', text: `Apps: ${targets.map((item) => item.name).join(', ')}` });
    const signed = Object.entries(state.signing).filter(([, value]) => value.status === 'done').map(([id]) => { const [, app, platform, profile] = id.split(':'); return `${app} ${platformName(platform)} ${profile}`; });
    if (signed.length) notes.push({ tone: 'ok', text: `Signing set up: ${signed.join(', ')}` });
    const misses = (this.cache.doctor?.data?.items ?? []).filter((item) => item.status === 'miss' && item.id !== 'projects' && item.id !== 'tailscale');
    if (misses.length) notes.push({ tone: 'warn', text: `Still missing: ${misses.map((item) => item.label).join(', ')}. Run macbuild doctor to see how to fix them.` });
    const first = targets[0]?.name ?? 'myapp';
    const next = [
      { tone: 'info', text: 'A development build', code: `macbuild ${first}` },
      { tone: 'info', text: 'Build and install on your iPhone', code: `macbuild ${first} --install` },
      { tone: 'info', text: 'Upload to TestFlight from GitHub', code: `macbuild ${first} --submit --ref main` },
    ];
    const buttons = [];
    if (state.buildId) buttons.push({ id: 'open-build', label: 'Follow the build', href: `#/build/${state.buildId}`, primary: true });
    buttons.push({ id: 'open', label: 'Open the dashboard', href: '#/', primary: !state.buildId });
    buttons.push({ id: 'restart', label: 'Run setup again' });
    return this.screen({
      title: 'You’re set up',
      lead: state.buildId || state.buildRequest ? `Your first build of ${state.buildRequest?.app ?? targets[0]?.name ?? 'your app'} is on its way.` : 'macbuild is ready. Here’s how to build from the terminal; agents can run the same commands.',
      notes: [...notes, ...next],
      buttons,
    });
  },
};

const SUBMITS = {
  async welcome(state, button, values) {
    const agents = await this.agents();
    const choice = values.agent ?? state.agent;
    state.agent = choice === 'none' || agents.some((agent) => agent.id === choice && agent.found) ? choice : 'none';
    state.found = null;
    this.go('apps');
  },

  async apps(state, button, values) {
    if (button === 'search') {
      const raw = String(values.folder ?? '').trim();
      const folder = resolve(raw.replace(/^~(?=\/|$)/, this.home));
      if (!raw || !isDir(folder)) { this.flash([{ tone: 'bad', text: raw ? `There’s no folder at ${raw}.` : 'Type a folder to search.' }]); return; }
      if (!state.searched.includes(folder)) state.searched.push(folder);
      state.found = null;
      return;
    }
    const chosen = new Set(tick(values.apps));
    const known = this.projects();
    const added = []; const notes = [];
    for (const app of state.found ?? []) {
      const listed = known.find((item) => real(item.dir) === real(app.path));
      if (listed) { added.push(listed.name); continue; }
      if (!chosen.has(app.path)) continue;
      if (!existsSync(join(app.path, 'eas.json'))) {
        if (!yes(values.easjson ?? true)) { notes.push({ tone: 'warn', text: `Skipped ${app.name}: it needs an eas.json first.` }); continue; }
        writeJsonLike(join(app.path, 'eas.json'), DEFAULT_EAS);
      }
      try { addProject(this.paths.projects, app.name, app.path); added.push(app.name); } catch (error) { notes.push({ tone: 'bad', text: `${app.name}: ${error.message}` }); }
    }
    state.added = [...new Set(added)];
    const fresh = state.added.filter((name) => !known.some((item) => item.name === name));
    this.go('tools');
    if (fresh.length) notes.unshift({ tone: 'ok', text: `Added ${list(fresh)}.` });
    this.flash(notes);
  },

  async tools(state, button) {
    if (button === 'recheck') { await this.doctor(true); return; }
    state.review = null;
    this.go('review');
  },

  async review(state, button, values) {
    if (button === 'recheck') { state.review = null; return; }
    if (button !== 'apply' || !state.review?.actions?.length) { this.go('signing'); return; }
    const answers = {};
    for (const question of state.review.questions) {
      const value = values[`q:${question.id}`];
      answers[question.id] = question.kind === 'multi' ? tick(value).join(',') : question.kind === 'confirm' ? String(yes(value)) : String(value ?? question.default ?? '').trim();
    }
    const picked = new Set(tick(values.apply ?? state.review.actions.map((action, index) => String(index))));
    const chosen = state.review.actions.filter((action, index) => picked.has(String(index)));
    if (!chosen.length) { this.go('signing'); return; }
    this.startJob('apply', chosen.length === 1 ? 'Applying the fix' : `Applying ${chosen.length} fixes`, (ctx) => this.apply(chosen, answers, ctx));
  },

  async signing() { this.go('mac'); },

  async mac(state, button, values) {
    const appleId = String(values.appleId ?? '').trim();
    if (appleId && !SETTINGS.MACBUILD_APPLE_ID.pattern.test(appleId)) { this.flash([{ tone: 'bad', text: `${appleId} doesn’t look like an Apple ID.` }]); return; }
    if (values.appleId !== undefined) writeSetting(this.paths.env, 'MACBUILD_APPLE_ID', appleId);
    if (values.phone !== undefined) {
      const phone = String(values.phone);
      if (phone && !(await this.devices()).some((item) => item.id === phone)) { this.flash([{ tone: 'bad', text: 'That iPhone isn’t paired any more.' }]); return; }
      writeSetting(this.paths.env, 'MACBUILD_DEVICE', phone);
    }
    state.installUi = values.dashboard !== undefined ? yes(values.dashboard) : false;
    this.go('build');
  },

  async build(state, button, values) {
    if (button === 'build') {
      const target = this.targets().find((item) => item.name === values.app);
      const dev = target && existsSync(join(target.dir, 'eas.json')) ? devProfile(readApp(target.dir).profileInfo) : null;
      if (!dev) { this.flash([{ tone: 'bad', text: 'Pick an app with a development profile.' }]); return; }
      const request = { app: target.name, profile: dev.name, install: yes(values.install ?? false) && Boolean(readSetting(this.paths.env, 'MACBUILD_DEVICE')) };
      if (this.hooks.startBuild) {
        const build = await this.hooks.startBuild(request);
        if (build?.error) { this.flash([{ tone: 'bad', text: build.error }]); return; }
        state.buildId = build?.id ?? null;
      }
      state.buildRequest = request;
    }
    this.finish();
  },

  async done(state, button) {
    if (button === 'restart') this.reset();
  },
};
