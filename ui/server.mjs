// macbuild UI: start, watch and install local Expo builds from a phone. Listens on loopback only; `tailscale serve`
// gives it HTTPS on the tailnet, which is also what iOS requires to install an app from a web page.
import { spawn, execFile } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, statfsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, homedir, hostname, loadavg, tmpdir, totalmem, uptime } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import webpush from 'web-push';
import { diagnose } from '../lib/diagnose.mjs';
import { readProfiles } from '../lib/profile.mjs';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = process.env.MACBUILD_DATA ?? join(homedir(), '.local/share/macbuild/builds');
const PORT = Number(process.env.MACBUILD_UI_PORT ?? 4180);
const BIN = process.env.MACBUILD_BIN ?? join(ROOT, 'bin/macbuild');
const UI_URL = process.env.MACBUILD_UI_URL ?? '';
const KEEP_IPAS = 10;
const KEEP_BUILDS = 200;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG = process.env.MACBUILD_CONFIG ?? join(homedir(), '.config/macbuild/ui.json');
const SUBMIT_MARK = /Scheduling (iOS|Android) submission|Submitting your app/;
const ACTIVE = ['queued', 'running', 'cancelling'];

mkdirSync(DATA, { recursive: true });
const dirOf = (id) => join(DATA, id);
const metaOf = (id) => join(dirOf(id), 'meta.json');
const validId = (id) => /^[0-9a-z-]+$/.test(id) && existsSync(metaOf(id));
const read = (id) => JSON.parse(readFileSync(metaOf(id), 'utf8'));
// Only this server writes meta.json, so the list is read from disk again only after a save or a prune.
let buildsCache = null;
const save = (build) => {
  writeFileSync(`${metaOf(build.id)}.tmp`, JSON.stringify(build));
  renameSync(`${metaOf(build.id)}.tmp`, metaOf(build.id));
  buildsCache = null;
};
const allBuilds = () => (buildsCache ??= readdirSync(DATA).filter(validId).map(read).sort((a, b) => b.createdAt - a.createdAt));
const isActive = (build) => ACTIVE.includes(build.status);
const platformOf = (build) => build.platform ?? 'ios';
// Each build's file: app.ipa, app.tar.gz (iOS simulator), app.apk or app.aab. Builds from before Android were all IPAs.
const artifactOf = (build) => join(dirOf(build.id), build.artifact ?? 'app.ipa');
const DOWNLOAD_TYPES = { 'app.apk': 'application/vnd.android.package-archive', 'app.tar.gz': 'application/gzip' };
const submits = (build) => build.action === 'submit' || build.action === 'testflight';

const PROJECTS = process.env.MACBUILD_PROJECTS ?? join(homedir(), '.config/macbuild/projects.conf');
const projects = () => (existsSync(PROJECTS) ? readFileSync(PROJECTS, 'utf8') : '').split('\n')
  .filter((line) => line.includes('|') && !line.startsWith('#'))
  .map((line) => { const [name, dir] = line.split('|'); return { name, dir }; });
async function git(dir, ...args) {
  try { return (await run('git', ['-C', dir, ...args])).stdout.trim(); } catch { return ''; }
}
async function describe(project) {
  const [branch, commit, subject, dirty, top] = await Promise.all([
    git(project.dir, 'branch', '--show-current'), git(project.dir, 'rev-parse', '--short', 'HEAD'),
    git(project.dir, 'log', '-1', '--format=%s'), git(project.dir, 'status', '--porcelain'), git(project.dir, 'rev-parse', '--show-toplevel')]);
  return {
    name: project.name, branch, commit, subject, dirty: dirty ? dirty.split('\n').length : 0, repo: top ? await slug(top) : '',
    icon: Boolean(iconPath(project)), lastBuild: allBuilds().find((build) => build.project === project.name) ?? null,
  };
}
// The app's icon from app.json (expo.ios.icon or expo.icon), so the dashboard can show it. app.config.js isn't run.
function iconPath(project) {
  try {
    const { expo = {} } = JSON.parse(readFileSync(join(project.dir, 'app.json'), 'utf8'));
    const ios = expo.ios?.icon;
    const relativePath = typeof ios === 'string' ? ios : ios?.light ?? expo.icon;
    if (typeof relativePath !== 'string') return null;
    const file = resolve(project.dir, relativePath);
    return file.startsWith(`${resolve(project.dir)}/`) && /\.(png|jpe?g)$/i.test(file) && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}
// How long a running build will probably take: the median of this project's recent successful builds of the same
// kind and platform, preferring the same profile.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function estimate(build) {
  const done = allBuilds().filter((item) => item.status === 'success' && item.startedAt && item.finishedAt && item.project === build.project
    && submits(item) === submits(build) && platformOf(item) === platformOf(build));
  const same = done.filter((item) => item.profile === build.profile);
  const pool = (same.length >= 2 ? same : done).slice(0, 10);
  return pool.length ? median(pool.map((item) => item.finishedAt - item.startedAt)) : null;
}
const withEstimate = (build) => (isActive(build) ? { ...build, estimate: estimate(build) } : build);

const clean = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n')
  .map((line) => line.split('\r').filter((part) => part.trim()).pop() ?? '')
  .map((line) => line.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+\s*/, '').trimEnd())
  .filter((line) => line && !/eas-cli@|To upgrade, run|npm install -g eas-cli|outdated version/.test(line));
const logPath = (id) => join(dirOf(id), 'build.log');
const logText = (id) => (existsSync(logPath(id)) ? readFileSync(logPath(id), 'utf8') : '');
// The log carries [PHASE] prefixes but no times, so phases are stamped as they first appear while the build runs.
function trackPhases(id) {
  if (!existsSync(logPath(id))) return;
  const build = read(id);
  const text = readFileSync(logPath(id), 'latin1');
  const seen = new Set((build.phases ?? []).map((phase) => phase.name));
  const found = [...text.matchAll(/\[([A-Z][A-Z_]{3,})\]/g)].map((match) => match[1]);
  if (SUBMIT_MARK.test(text)) found.push('SUBMIT');
  const fresh = [...new Set(found)].filter((name) => !seen.has(name));
  if (fresh.length) save({ ...build, phases: [...(build.phases ?? []), ...fresh.map((name) => ({ name, at: Date.now() }))] });
}
function failure(text) {
  const lines = clean(text);
  return lines.filter((line) => /❌|error:|Error:|failed|FAILURE|non-zero code/i.test(line) && !/build command failed/.test(line)).slice(-1)[0]?.trim() ?? '';
}

// What's inside a finished build: the app's id and version, and for an IPA, its signing.
async function inspect(build) {
  const file = artifactOf(build);
  if (!existsSync(file)) return;
  build.ipaBytes = statSync(file).size;
  const scratch = join(tmpdir(), `macbuild-${build.id}`);
  mkdirSync(scratch, { recursive: true });
  const plist = async (path) => JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', path], { maxBuffer: 1 << 24 })).stdout);
  const appOf = (info) => ({ id: info.CFBundleIdentifier, name: info.CFBundleDisplayName ?? info.CFBundleName, version: info.CFBundleShortVersionString, number: info.CFBundleVersion });
  try {
    if (platformOf(build) === 'android') {
      build.installable = build.artifact === 'app.apk';
      const tool = androidTool('apkanalyzer');
      if (build.installable) {
        const field = async (...args) => (await run(tool, ['manifest', ...args, file], { timeout: 60000 })).stdout.trim();
        build.app = { id: await field('application-id'), version: await field('version-name'), number: await field('version-code') };
      }
      return;
    }
    if (build.simulator) {
      await run('tar', ['-xzf', file, '-C', scratch]);
      const app = findApp(scratch);
      if (app) build.app = appOf(await plist(join(app, 'Info.plist')));
      build.installable = false;
      return;
    }
    const shell = (command) => run('/bin/sh', ['-c', command], { maxBuffer: 1 << 26 });
    await shell(`unzip -p '${file}' 'Payload/*.app/Info.plist' > '${scratch}/Info.plist'`);
    build.app = appOf(await plist(`${scratch}/Info.plist`));
    const profile = (await shell(`unzip -p '${file}' 'Payload/*.app/embedded.mobileprovision' | security cms -D`)).stdout;
    build.installable = profile.includes('ProvisionedDevices');
    const value = (key) => profile.match(new RegExp(`<key>${key}</key>\\s*<(?:string|date)>([^<]*)<`))?.[1];
    build.signing = {
      profile: value('Name'), team: value('TeamName'), expires: value('ExpirationDate'),
      devices: (profile.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1].match(/<string>/g) ?? []).length,
    };
    try {
      await shell(`unzip -p '${file}' 'Payload/*.app/Expo.plist' > '${scratch}/Expo.plist'`);
      build.runtime = (await plist(`${scratch}/Expo.plist`)).EXUpdatesRuntimeVersion;
    } catch {}
  } catch (error) {
    console.error('inspect', build.id, error.message.split('\n')[0]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function findApp(dir, depth = 0) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.app')) return join(dir, entry.name);
    if (depth < 2) { const found = findApp(join(dir, entry.name), depth + 1); if (found) return found; }
  }
  return null;
}
const androidHome = () => process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
const androidTool = (name) => { const file = join(androidHome(), 'cmdline-tools/latest/bin', name); return existsSync(file) ? file : name; };
function prune() {
  const builds = allBuilds();
  builds.filter((build) => existsSync(artifactOf(build))).slice(KEEP_IPAS).forEach((build) => {
    rmSync(artifactOf(build), { force: true });
    rmSync(join(dirOf(build.id), 'sim'), { recursive: true, force: true });
    save({ ...build, installable: false, expired: true });
  });
  // Older history goes too, logs and all, so the build folder doesn't grow forever.
  builds.slice(KEEP_BUILDS).filter((build) => !isActive(build)).forEach((build) => rmSync(dirOf(build.id), { recursive: true, force: true }));
  buildsCache = null;
}

const config = () => { try { return { triggers: [], ...JSON.parse(readFileSync(CONFIG, 'utf8')) }; } catch { return { triggers: [] }; } };
const saveConfig = (next) => { mkdirSync(dirname(CONFIG), { recursive: true }); writeFileSync(CONFIG, JSON.stringify({ ...config(), ...next }, null, 2)); };
const repoOf = async (name) => git(projects().find((known) => known.name === name).dir, 'rev-parse', '--show-toplevel');
const headOf = async (repo, branch) => (await git(repo, 'ls-remote', 'origin', `refs/heads/${branch}`)).split(/\s/)[0];
const validRef = (ref) => /^[\w./-]{1,200}$/.test(ref) && !ref.startsWith('-') && !ref.includes('..');
async function slug(repo) {
  // The URL as configured: `remote get-url` applies insteadOf rewrites, which can hide that origin is on GitHub.
  const remote = await git(repo, 'config', '--get', 'remote.origin.url');
  // owner/name; names can contain dots (next.js), so only a trailing .git is dropped.
  return remote.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? '';
}
const remoteCache = new Map();
function refresh(repo, repoSlug) {
  let cached = remoteCache.get(repo);
  if (!cached) {
    cached = { at: 0, prs: [], pending: null };
    remoteCache.set(repo, cached);
  }
  if (!cached.pending && Date.now() - cached.at >= 30000) {
    cached.pending = Promise.all([
      run('git', ['-C', repo, 'fetch', '-q', '--prune', 'origin'], { timeout: 12000 }).catch(() => null),
      repoSlug ? gh('pr', 'list', '--repo', repoSlug, '--state', 'open', '--limit', '30', '--json', 'number,headRefName,title,url') : null,
    ]).then(([, prs]) => {
      if (prs) cached.prs = prs;
    }).finally(() => { cached.at = Date.now(); cached.pending = null; });
  }
  return cached;
}
async function gh(...args) {
  try { return JSON.parse((await run('gh', args, { timeout: 12000, maxBuffer: 1 << 24 })).stdout); } catch { return null; }
}
async function commitInfo(repo, ref) {
  const out = await git(repo, 'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct', ref);
  if (!out) return null;
  const [hash, short, subject, author, time] = out.split('\x1f');
  const repoSlug = await slug(repo);
  return { hash, short, subject, author, date: Number(time) * 1000, url: repoSlug ? `https://github.com/${repoSlug}/commit/${hash}` : '' };
}
function easProfiles(dir) {
  try { return readProfiles(join(dir, 'eas.json')); } catch { return []; }
}
async function enqueue({ project, profile, platform = 'ios', ref, label, submit, skipUnchanged, trigger, by }) {
  const known = projects().find((candidate) => candidate.name === project);
  if (!known) return { error: 'unknown project' };
  if (!['ios', 'android'].includes(platform)) return { error: 'unknown platform' };
  const chosen = easProfiles(known.dir).find((candidate) => candidate.name === profile);
  if (!chosen) return { error: 'unknown profile' };
  const target = chosen[platform];
  if (submit && target.simulator) return { error: 'simulator builds can’t be uploaded to the App Store' };
  if (ref && !validRef(ref)) return { error: 'bad ref' };
  const repo = await repoOf(project);
  await git(repo, 'fetch', '-q', '--prune', 'origin');
  const resolved = ref ? (await git(repo, 'rev-parse', '--verify', '-q', `origin/${ref}^{commit}`)) || (await git(repo, 'rev-parse', '--verify', '-q', `${ref}^{commit}`)) : 'HEAD';
  if (!resolved) return { error: 'that branch or commit is not on GitHub' };
  const commit = await commitInfo(repo, resolved);
  const branch = ref ? (label ?? ref) : await git(repo, 'branch', '--show-current');
  const repoSlug = await slug(repo);
  const pr = branch && repoSlug ? (await gh('pr', 'list', '--repo', repoSlug, '--head', branch, '--state', 'all', '--limit', '1', '--json', 'number,title,url'))?.[0] : null;
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const build = {
    // The id keeps to what validId accepts, whatever the project is called (my_app, My.App).
    id: `${stamp}-${project.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`, project, platform, action: submit ? 'submit' : 'build', profile,
    distribution: chosen.distribution, channel: chosen.channel, artifact: `app.${target.artifact}`, simulator: target.simulator,
    devClient: chosen.developmentClient, skipUnchanged: Boolean(skipUnchanged) && !submit,
    source: ref ? 'github' : 'working', ref: branch, commit, pr: pr ?? null, repo: repoSlug, trigger, by: by ?? null, status: 'queued', createdAt: Date.now(),
    dirty: ref ? 0 : (await git(repo, 'status', '--porcelain')).split('\n').filter(Boolean).length,
  };
  if (existsSync(metaOf(build.id))) return { error: 'a build just started' };
  mkdirSync(dirOf(build.id), { recursive: true });
  save(build);
  next();
  return build;
}
async function commits(project, branch) {
  if (!validRef(branch)) return [];
  const repo = await repoOf(project.name);
  const out = await git(repo, 'log', '-20', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct', `origin/${branch}`);
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, short, subject, author, time] = line.split('\x1f');
    return { hash, short, subject, author, date: Number(time) * 1000 };
  });
}
async function projectDetail(project) {
  const repo = await repoOf(project.name);
  const repoSlug = await slug(repo);
  const remote = refresh(repo, repoSlug);
  const refreshing = Boolean(remote.pending);
  const refs = await git(repo, 'for-each-ref', 'refs/remotes/origin', '--sort=-committerdate', '--count=30', '--format=%(refname:lstrip=3)%1f%(objectname:short)%1f%(subject)%1f%(authorname)%1f%(committerdate:unix)');
  const prs = remote.prs;
  const branches = refs.split('\n').filter(Boolean).map((line) => {
    const [name, short, subject, author, time] = line.split('\x1f');
    return { name, short, subject, author, date: Number(time) * 1000, pr: prs.find((pr) => pr.headRefName === name) ?? null };
  }).filter((branch) => branch.name && branch.name !== 'HEAD');
  const builds = allBuilds().filter((build) => build.project === project.name);
  const done = builds.filter((build) => ['success', 'failed'].includes(build.status));
  const times = done.filter((build) => build.status === 'success' && build.startedAt).map((build) => build.finishedAt - build.startedAt).sort((a, b) => a - b);
  const current = await git(repo, 'branch', '--show-current');
  const behind = current ? Number(await git(repo, 'rev-list', '--count', `HEAD..origin/${current}`)) || 0 : 0;
  const ios = builds.filter((build) => platformOf(build) === 'ios' && !build.simulator);
  return {
    ...(await describe(project)), repo: repoSlug, refreshing, behind, branches, profiles: easProfiles(project.dir), builds: builds.slice(0, 60).map(withEstimate),
    signing: ios.find((build) => build.signing)?.signing ?? null, storeSigning: ios.find((build) => build.signing && !build.installable)?.signing ?? null,
    stats: { total: done.length, passed: done.filter((build) => build.status === 'success').length, median: times[Math.floor(times.length / 2)] ?? 0 },
    triggers: config().triggers.filter((rule) => rule.project === project.name),
  };
}
async function checks(build) {
  if (!build.repo || !build.commit) return null;
  const data = await gh('api', `repos/${build.repo}/commits/${build.commit.hash}/check-runs?per_page=50`);
  if (!data) return null;
  const runs = (data.check_runs ?? []).filter((item) => !item.name?.startsWith('macbuild/'));
  const failed = runs.filter((item) => ['failure', 'timed_out', 'cancelled'].includes(item.conclusion));
  return { total: runs.length, failed: failed.length, pending: runs.filter((item) => item.status !== 'completed').length, url: `https://github.com/${build.repo}/commit/${build.commit.hash}/checks` };
}

// Telling people: Web Push to phones, a Slack or Discord webhook, and a commit status on GitHub.
const buildUrl = (build) => (UI_URL ? `${UI_URL}/#/build/${build.id}` : '');
const minutesOf = (build) => (build.startedAt && build.finishedAt ? `${Math.max(1, Math.round((build.finishedAt - build.startedAt) / 60000))} min` : '');
const OUTCOMES = { success: 'built', failed: 'failed', cancelled: 'was cancelled', skipped: 'didn’t need a new build: native code unchanged' };
function vapid() {
  let keys = config().vapid;
  if (!keys) { keys = webpush.generateVAPIDKeys(); saveConfig({ vapid: keys }); }
  webpush.setVapidDetails('https://github.com/fav-devs/macbuild', keys.publicKey, keys.privateKey);
  return keys;
}
async function notify(build) {
  const subscriptions = config().subscriptions ?? [];
  if (!subscriptions.length) return;
  vapid();
  const title = `${build.project}: ${{ success: 'build finished', failed: 'build failed', skipped: 'no new build needed' }[build.status] ?? 'build cancelled'}`;
  const payload = JSON.stringify({ title, body: `${build.ref ?? ''} ${build.commit?.short ?? ''} · ${build.commit?.subject ?? ''}`.trim(), url: `/#/build/${build.id}` });
  const dead = [];
  await Promise.all(subscriptions.map((subscription) => webpush.sendNotification(subscription, payload).catch((error) => {
    if ([404, 410].includes(error.statusCode)) dead.push(subscription.endpoint);
    else console.error('push', error.statusCode ?? error.message);
  })));
  if (dead.length) saveConfig({ subscriptions: config().subscriptions.filter((item) => !dead.includes(item.endpoint)) });
}
async function sendWebhook(build, hook = config().webhook) {
  if (!hook) return;
  const what = `${build.project} ${build.platform === 'android' ? 'Android' : 'iOS'} ${build.profile}`;
  const text = `${what} ${OUTCOMES[build.status] ?? build.status}${minutesOf(build) && build.status === 'success' ? ` in ${minutesOf(build)}` : ''}: ${build.commit?.subject ?? 'working copy'}`
    + `${build.ref ? ` (${build.ref}${build.commit?.short ? ` ${build.commit.short}` : ''})` : ''}${build.hint ? `. ${build.hint.title}.` : ''}${buildUrl(build) ? ` ${buildUrl(build)}` : ''}`;
  // Discord takes `content`; Slack and most others take `text`.
  const payload = /discord(app)?\.com\/api\/webhooks/.test(hook) ? { content: text } : { text };
  const response = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`the webhook answered ${response.status}`);
}
async function postStatus(build, state, description) {
  // Only for pushed commits: a working-copy build can include changes the commit doesn't have.
  if (!config().githubStatus || !build.repo || !build.commit?.hash || build.source === 'working') return;
  const args = ['api', '-X', 'POST', `repos/${build.repo}/statuses/${build.commit.hash}`, '-f', `state=${state}`,
    '-f', `context=macbuild/${platformOf(build)}/${build.profile}`, '-f', `description=${description.slice(0, 139)}`];
  if (/^https?:\/\//.test(buildUrl(build))) args.push('-f', `target_url=${buildUrl(build)}`);
  await run('gh', args, { timeout: 15000 }).catch((error) => console.error('status', build.id, error.message.split('\n')[0]));
}

// What this Mac is, for the dashboard: read once, it doesn't change while the server runs.
let machineInfo = null;
async function machine() {
  if (machineInfo) return machineInfo;
  const out = async (command, args) => { try { return (await run(command, args, { timeout: 5000 })).stdout.trim(); } catch { return ''; } };
  const [name, chip, macos] = await Promise.all([out('scutil', ['--get', 'ComputerName']), out('sysctl', ['-n', 'machdep.cpu.brand_string']), out('sw_vers', ['-productVersion'])]);
  machineInfo = { name: name || hostname().replace(/\.local$/, ''), chip: chip || cpus()[0]?.model || '', macos, memory: totalmem() };
  return machineInfo;
}
const tools = {};
async function toolVersions() {
  if (tools.xcode !== undefined) return tools;
  const out = async (command, args) => { try { const { stdout, stderr } = await run(command, args, { timeout: 15000 }); return `${stdout}${stderr}`.trim(); } catch { return ''; } };
  tools.xcode = (await out('xcodebuild', ['-version'])).split('\n')[0].replace('Xcode ', '');
  tools.eas = (await out('eas', ['--version'])).match(/eas-cli\/([\d.]+)/)?.[1] ?? '';
  tools.node = process.version.slice(1);
  tools.gh = /Logged in/i.test(await out('gh', ['auth', 'status']));
  tools.android = existsSync(androidHome());
  return tools;
}
const settingsView = () => {
  const { webhook, githubStatus, appleTeam } = config();
  // The webhook's host only: the rest of its URL is a secret.
  return { webhook: webhook ? hostOf(webhook) || 'set' : '', githubStatus: Boolean(githubStatus), appleTeam: appleTeam ?? '' };
};

const UI_PLIST = join(homedir(), 'Library/LaunchAgents/local.macbuild.ui.plist');
const BAR_PLIST = join(homedir(), 'Library/LaunchAgents/local.macbuild.menubar.plist');
const BAR_BIN = join(homedir(), '.local/bin/macbuild-menubar');
const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
const localUrl = () => `http://127.0.0.1:${PORT}`;
const phoneUrl = () => (/^https:\/\//.test(UI_URL) ? UI_URL : '');
function plistLogin(file) {
  try { return /<key>RunAtLoad<\/key>\s*<true\/>/.test(readFileSync(file, 'utf8')); } catch { return false; }
}
function setPlistLogin(file, on) {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/(<key>RunAtLoad<\/key>\s*)<(true|false)\/>/, `$1<${on ? 'true' : 'false'}/>`);
  if (next === text) return plistLogin(file) === on;
  writeFileSync(file, next);
  return true;
}
async function agentLoaded(label) {
  try { await run('launchctl', ['print', `gui/${uid}/${label}`], { timeout: 4000 }); return true; } catch { return false; }
}
let doctorCache = { at: 0, data: null };
async function doctorReport() {
  if (Date.now() - doctorCache.at < 15000 && doctorCache.data) return doctorCache.data;
  try {
    const { stdout } = await run(BIN, ['doctor', '--json'], { timeout: 25000, maxBuffer: 1 << 20 });
    const line = stdout.trim().split('\n').filter(Boolean).at(-1);
    doctorCache = { at: Date.now(), data: JSON.parse(line) };
  } catch (error) {
    doctorCache = { at: Date.now(), data: { ok: false, items: [], error: (error.stderr?.toString() || error.message).split('\n')[0] } };
  }
  return doctorCache.data;
}
const slimBuild = (build) => (build ? { id: build.id, project: build.project, profile: build.profile, status: build.status, subject: build.commit?.subject ?? '' } : null);
async function setupView() {
  const cfg = config();
  const doctor = await doctorReport();
  const barOn = await agentLoaded('local.macbuild.menubar');
  return {
    setupComplete: Boolean(cfg.setupComplete),
    loginAtLogin: existsSync(UI_PLIST) ? plistLogin(UI_PLIST) : cfg.loginAtLogin !== false,
    menubar: barOn,
    menubarInstalled: existsSync(BAR_BIN),
    url: UI_URL || localUrl(),
    localUrl: localUrl(),
    phoneUrl: phoneUrl(),
    doctor,
    projects: projects().map((project) => project.name),
  };
}
function menubarView() {
  const builds = allBuilds();
  const current = builds.find((item) => ['running', 'cancelling'].includes(item.status));
  const last = builds.find((item) => !ACTIVE.includes(item.status));
  return {
    url: localUrl(),
    phoneUrl: phoneUrl() || UI_URL || localUrl(),
    loginAtLogin: existsSync(UI_PLIST) ? plistLogin(UI_PLIST) : config().loginAtLogin !== false,
    current: slimBuild(current),
    last: slimBuild(last),
    queued: builds.filter((item) => item.status === 'queued').length,
    projects: projects().map((project) => project.name),
    doctorMiss: doctorCache.data?.items?.filter((item) => item.status === 'miss').length ?? 0,
  };
}
async function applySetup(req, res) {
  const { setupComplete, loginAtLogin, menubar } = await body(req);
  const changes = {};
  if (setupComplete !== undefined) changes.setupComplete = Boolean(setupComplete) || undefined;
  if (loginAtLogin !== undefined) {
    const on = Boolean(loginAtLogin);
    changes.loginAtLogin = on || undefined;
    setPlistLogin(UI_PLIST, on);
    setPlistLogin(BAR_PLIST, on);
  }
  if (menubar !== undefined) {
    const on = Boolean(menubar);
    changes.menubar = on || undefined;
    if (on) {
      try {
        await run(join(ROOT, 'install-ui.sh'), ['--menubar-only'], { timeout: 120000 });
      } catch (error) {
        const detail = (error.stderr?.toString() || error.message).split('\n').find((line) => line.trim()) || 'Couldn’t start the menu bar';
        return json(res, 400, { error: detail });
      }
    } else {
      await run('launchctl', ['bootout', `gui/${uid}/local.macbuild.menubar`], { timeout: 5000 }).catch(() => {});
      setPlistLogin(BAR_PLIST, false);
    }
  }
  saveConfig(changes);
  return json(res, 200, await setupView());
}
async function system() {
  const disk = statfsSync(homedir());
  const battery = await run('pmset', ['-g', 'batt']).then(({ stdout }) => stdout.match(/(\d+)%;\s*([a-zA-Z ]+)/)).catch(() => null);
  const builds = allBuilds();
  return {
    diskFree: disk.bavail * disk.bsize, diskTotal: disk.blocks * disk.bsize, load: loadavg()[0], cores: cpus().length, memory: totalmem(), uptime: uptime(),
    battery: battery ? { percent: Number(battery[1]), state: battery[2].trim() } : null, tools: await toolVersions(), machine: await machine(),
    kept: { builds: builds.length, ipas: builds.filter((build) => !build.expired && build.ipaBytes).length, maxBuilds: KEEP_BUILDS, maxIpas: KEEP_IPAS },
    queued: builds.filter((build) => build.status === 'queued').length, running: builds.find((build) => build.status === 'running')?.id ?? null,
    current: (() => { const build = builds.find((item) => ['running', 'cancelling'].includes(item.status)); return build ? withEstimate(build) : null; })(),
    ipaBytes: builds.reduce((sum, build) => sum + (build.expired ? 0 : build.ipaBytes ?? 0), 0), push: (config().subscriptions ?? []).length,
    // missing: its project left projects.conf, so the project page can't turn the rule off; settings offers Remove.
    triggers: config().triggers.map((rule) => ({ ...rule, missing: !projects().some((known) => known.name === rule.project) })),
    settings: settingsView(),
  };
}

// Disk cleanup: what builds leave behind, measured with du. Only these fixed folders can be cleared, never a path from
// a request, and nothing while a build runs.
function diskItems() {
  const home = homedir();
  const derived = join(home, 'Library/Developer/Xcode/DerivedData');
  return [
    { key: 'derived', label: 'Xcode build files', path: derived, except: 'CompilationCache.noindex' },
    { key: 'compile-cache', label: 'Compilation cache', path: join(derived, 'CompilationCache.noindex') },
    { key: 'device-support', label: 'iOS device support', path: join(home, 'Library/Developer/Xcode/iOS DeviceSupport') },
    { key: 'pods', label: 'CocoaPods cache', path: join(home, 'Library/Caches/CocoaPods') },
    { key: 'gradle', label: 'Gradle cache', path: join(home, '.gradle/caches') },
    { key: 'work', label: 'macbuild work folders', path: join(home, '.cache/macbuild') },
    { key: 'simulators', label: 'Unavailable simulators', command: ['xcrun', 'simctl', 'delete', 'unavailable'], path: join(home, 'Library/Developer/CoreSimulator/Devices') },
    { key: 'history', label: 'Build history and IPAs', path: DATA, keep: true },
  ];
}
const sizeOf = async (path) => {
  if (!existsSync(path)) return 0;
  try { return Number((await run('du', ['-sk', path], { timeout: 180000, maxBuffer: 1 << 20 })).stdout.split(/\s/)[0]) * 1024 || 0; } catch { return null; }
};
let diskCache = null;
async function disk(fresh = false) {
  if (!fresh && diskCache && Date.now() - diskCache.at < 60000) return diskCache.data;
  const items = diskItems();
  const sizes = await Promise.all(items.map((item) => sizeOf(item.path)));
  const exceptSize = await sizeOf(join(items[0].path, items[0].except));
  sizes[0] = sizes[0] === null ? null : Math.max(0, sizes[0] - (exceptSize ?? 0));
  const data = { items: items.map(({ key, label, keep }, index) => ({ key, label, bytes: sizes[index], cleanable: !keep })), measuredAt: Date.now() };
  diskCache = { at: Date.now(), data };
  return data;
}
async function cleanDisk(key) {
  if (allBuilds().some((build) => ['running', 'cancelling'].includes(build.status))) return { status: 409, error: 'A build is running. Clean up once it’s done.' };
  const item = diskItems().find((candidate) => candidate.key === key);
  if (!item || item.keep) return { status: 400, error: 'unknown item' };
  if (item.command) await run(item.command[0], item.command.slice(1), { timeout: 120000 });
  else if (item.except) {
    if (existsSync(item.path)) readdirSync(item.path).filter((name) => name !== item.except).forEach((name) => rmSync(join(item.path, name), { recursive: true, force: true }));
  } else rmSync(item.path, { recursive: true, force: true });
  diskCache = null;
  return { status: 200 };
}

// Read-only Expo data through the CLI, cached so a page view does not cost a round of network calls.
const expoCache = new Map();
const expoPending = new Map();
async function eas(dir, ...args) {
  const { stdout } = await run('eas', args, { cwd: dir, timeout: 30000, maxBuffer: 1 << 24 });
  return stdout;
}
const parsed = (text) => JSON.parse(text.slice(text.search(/[[{]/), Math.max(text.lastIndexOf(']'), text.lastIndexOf('}')) + 1));
const easJson = async (dir, ...args) => parsed(await eas(dir, ...args, '--json', '--non-interactive'));
// Values are dropped here: only names ever reach the browser.
const envNames = async (dir, environment) => (await eas(dir, 'env:list', environment, '--format', 'short')).split('\n')
  .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1]).filter(Boolean);
async function expo(project) {
  const cached = expoCache.get(project.name);
  if (cached && Date.now() - cached.at < 300000) return cached.data;
  if (expoPending.has(project.name)) return expoPending.get(project.name);
  const pending = loadExpo(project).finally(() => expoPending.delete(project.name));
  expoPending.set(project.name, pending);
  return pending;
}
async function loadExpo(project) {
  const safe = (work) => work.catch((error) => { console.error('expo', project.name, error.message.split('\n')[0]); return null; });
  const team = config().appleTeam ?? process.env.MACBUILD_APPLE_TEAM;
  const submitList = (platform) => easJson(project.dir, 'submit:list', '--platform', platform, '--limit', '8').catch(() => eas(project.dir, 'submit:list', '--platform', platform, '--limit', '8', '--json').then(parsed));
  const [info, iosSubmissions, androidSubmissions, channels, cloud, production, preview, development, devices] = await Promise.all([
    safe(eas(project.dir, 'project:info')), safe(submitList('ios')), safe(submitList('android')),
    safe(easJson(project.dir, 'channel:list')),
    safe(easJson(project.dir, 'build:list', '--platform', 'all', '--limit', '20').catch(() => easJson(project.dir, 'build:list', '--platform', 'ios', '--limit', '20'))),
    safe(envNames(project.dir, 'production')), safe(envNames(project.dir, 'preview')), safe(envNames(project.dir, 'development')),
    team ? safe(eas(project.dir, 'device:list', '--apple-team-id', team, '--non-interactive')) : null,
  ]);
  const full = info?.match(/fullName\s+@([^/\s]+)\/(\S+)/);
  const submissions = [...(iosSubmissions ?? []).map((item) => ({ ...item, platform: 'ios' })), ...(androidSubmissions ?? []).map((item) => ({ ...item, platform: 'android' }))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const data = {
    url: full ? `https://expo.dev/accounts/${full[1]}/projects/${full[2]}` : '',
    submissions: submissions.map((item) => ({ id: item.id, platform: item.platform, status: item.status, createdAt: item.createdAt, completedAt: item.completedAt, ascApp: item.iosConfig?.ascAppIdentifier })),
    channels: (channels?.currentPage ?? []).map((item) => ({ name: item.name, paused: item.isPaused, branches: (item.updateBranches ?? []).map((branch) => ({ name: branch.name, updates: branch.updateGroups?.length ?? 0 })) })),
    cloud: (cloud ?? []).map((item) => ({ profile: item.buildProfile, platform: String(item.platform ?? 'ios').toLowerCase(), status: item.status, createdAt: item.createdAt, version: item.appVersion, number: item.appBuildVersion })),
    env: { production, preview, development },
    devices: (devices ?? '').split(/\n\s*\n/).map((block) => ({ name: block.match(/^Name\s+(.+)$/m)?.[1], kind: block.match(/^Class\s+(.+)$/m)?.[1], udid: block.match(/^UDID\s+(\S+)/m)?.[1]?.slice(-6) })).filter((item) => item.name),
    fetchedAt: Date.now(),
  };
  expoCache.set(project.name, { at: Date.now(), data });
  return data;
}

// Rules for automatic builds, checked every minute:
//   push     build a branch each time it's pushed
//   pr       build each pull request's newest commit (from this repository only: forks would run untrusted code here)
//   nightly  build a branch once a day after `at`, if it has new commits
// A commit counts as built once its build is queued, so a failed attempt is tried again a minute later; a newer push
// replaces a build of the same branch that hasn't started yet.
const RULES = ['push', 'pr', 'nightly'];
const ruleKey = (rule) => `${rule.project}\u0000${rule.on ?? 'push'}\u0000${rule.on === 'pr' ? '' : rule.branch}`;
const setTrigger = (rule, changes) => saveConfig({
  triggers: config().triggers.map((item) => {
    if (ruleKey(item) !== ruleKey(rule)) return item;
    const { error: _old, ...rest } = item;
    return { ...rest, ...changes };
  }),
});
function supersede(project, label, trigger, sha) {
  for (const build of allBuilds().filter((item) => item.status === 'queued' && item.project === project && item.ref === label && item.trigger === trigger)) {
    save({ ...build, status: 'cancelled', finishedAt: Date.now(), reason: `Replaced by a newer commit (${sha.slice(0, 7)})` });
  }
}
const ruleBuild = (rule, extra) => ({ project: rule.project, profile: rule.profile, platform: rule.platform ?? 'ios', submit: rule.submit, skipUnchanged: rule.skipUnchanged, ...extra });
const localDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const WATCHERS = {
  async push(rule) {
    const sha = await headOf(await repoOf(rule.project), rule.branch);
    if (!sha) return { error: 'could not read this branch from GitHub' };
    if (sha === rule.sha) return {};
    supersede(rule.project, rule.branch, 'push', sha);
    const build = await enqueue(ruleBuild(rule, { ref: rule.branch, trigger: 'push' }));
    return build.error ? { error: `could not start a build: ${build.error}` } : { changes: { sha } };
  },
  async nightly(rule, now = new Date()) {
    const [hour, minute] = (rule.at ?? '02:00').split(':').map(Number);
    if (rule.lastRun === localDay(now) || now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return {};
    const sha = await headOf(await repoOf(rule.project), rule.branch);
    if (!sha) return { error: 'could not read this branch from GitHub' };
    if (sha === rule.sha) return { changes: { lastRun: localDay(now) } }; // nothing new since the last nightly build
    const build = await enqueue(ruleBuild(rule, { ref: rule.branch, trigger: 'nightly' }));
    return build.error ? { error: `could not start a build: ${build.error}` } : { changes: { sha, lastRun: localDay(now) } };
  },
  async pr(rule) {
    const repoSlug = await slug(await repoOf(rule.project));
    if (!repoSlug) return { error: 'the project’s origin isn’t on GitHub' };
    const open = await gh('pr', 'list', '--repo', repoSlug, '--state', 'open', '--limit', '50', '--json', 'number,headRefName,headRefOid,isCrossRepository');
    if (!open) return { error: 'needs the GitHub CLI, signed in (gh auth login)' };
    const seen = { ...(rule.prs ?? {}) };
    const prs = {};
    let error = '';
    // Each must name its head commit: without one, enqueue would build the working copy instead.
    for (const pr of open.filter((item) => !item.isCrossRepository && validRef(item.headRefName) && /^[0-9a-f]{40}$/.test(item.headRefOid ?? ''))) {
      prs[pr.number] = seen[pr.number];
      if (seen[pr.number] === pr.headRefOid) continue;
      supersede(rule.project, pr.headRefName, 'pr', pr.headRefOid);
      const build = await enqueue(ruleBuild(rule, { ref: pr.headRefOid, label: pr.headRefName, trigger: 'pr' }));
      if (build.error) error = `could not build #${pr.number}: ${build.error}`;
      else prs[pr.number] = pr.headRefOid;
    }
    return { error, changes: JSON.stringify(prs) === JSON.stringify(rule.prs ?? {}) ? undefined : { prs } };
  },
};
let watching = false;
async function watchRules() {
  if (watching) return; // a slow fetch must not start a second round that queues the same commit again
  watching = true;
  try {
    for (const rule of config().triggers) {
      // A rule that can't run (project removed, profile renamed) records why, and the others carry on.
      let outcome = {};
      try {
        outcome = !projects().some((known) => known.name === rule.project) ? { error: 'project is no longer in projects.conf' } : await WATCHERS[rule.on ?? 'push'](rule);
      } catch (failure) {
        outcome = { error: failure.message };
      }
      const error = outcome.error ?? '';
      if (error && error !== rule.error) console.error('watch', rule.project, rule.on ?? 'push', rule.branch ?? '', error);
      if (outcome.changes || error !== (rule.error ?? '')) setTrigger(rule, { ...outcome.changes, ...(error ? { error } : {}) });
    }
  } finally {
    watching = false;
  }
}
setInterval(() => watchRules().catch((error) => console.error('watch', error.message)), 60000);

let current = null;
const orphans = new Set();
const buildSucceeded = (text) => /^Build successful\s*$/m.test(text) || /^macbuild: unchanged since /m.test(text);
const logFresh = (id, ms = 30000) => existsSync(logPath(id)) && Date.now() - statSync(logPath(id)).mtimeMs < ms;
function followOrphan(build) {
  if (orphans.has(build.id)) return;
  orphans.add(build.id);
  const tracker = setInterval(() => trackPhases(build.id), 2000);
  const tick = async () => {
    const latest = read(build.id);
    const text = logText(build.id);
    if (buildSucceeded(text)) {
      clearInterval(tracker);
      orphans.delete(build.id);
      try { await finish(latest, 0); } catch (error) { console.error('finish', build.id, error.message); }
      if (!orphans.size) { prune(); next(); }
      return;
    }
    if (!logFresh(build.id, 45000)) {
      clearInterval(tracker);
      orphans.delete(build.id);
      if (['running', 'cancelling'].includes(latest.status)) {
        save({ ...latest, status: 'failed', reason: 'The UI restarted during this build', finishedAt: Date.now() });
      }
      if (!orphans.size) next();
      return;
    }
    setTimeout(tick, 2000);
  };
  setTimeout(tick, 2000);
}
async function recoverInterrupted() {
  for (const build of allBuilds()) {
    const restartFail = build.status === 'failed' && build.reason === 'The UI restarted during this build';
    if (!['running', 'cancelling'].includes(build.status) && !restartFail) continue;
    const text = logText(build.id);
    if (buildSucceeded(text)) {
      await finish({ ...read(build.id), status: build.status === 'cancelling' ? 'cancelling' : 'running' }, 0);
      continue;
    }
    if (['running', 'cancelling'].includes(build.status) && logFresh(build.id)) {
      followOrphan(build);
      continue;
    }
    if (['running', 'cancelling'].includes(build.status)) {
      save({ ...build, status: 'failed', reason: 'The UI restarted during this build', finishedAt: Date.now() });
    }
  }
}
async function next() {
  if (current || orphans.size) return;
  const build = allBuilds().findLast((candidate) => candidate.status === 'queued');
  if (!build) return;
  const args = [build.project, '--platform', platformOf(build), '--profile', build.profile, '--fast', '--output', artifactOf(build)];
  if (submits(build)) args.push('--submit');
  if (build.skipUnchanged) args.push('--skip-unchanged');
  if (build.source !== 'working') args.push('--ref', build.commit.hash);
  const child = spawn(BIN, args, { detached: true, stdio: 'ignore', env: { ...process.env, MACBUILD_LOG: logPath(build.id) } });
  current = { id: build.id, child };
  const started = { ...build, status: 'running', startedAt: Date.now() };
  save(started);
  const tracker = setInterval(() => trackPhases(build.id), 2000);
  // Listen before anything is awaited: a build that ends at once would otherwise close unheard.
  child.on('close', async (code) => {
    clearInterval(tracker);
    trackPhases(build.id);
    try {
      await finish(read(build.id), code);
    } catch (error) {
      console.error('finish', build.id, error.message);
    }
    current = null;
    prune();
    next();
  });
  machine().then(({ name }) => postStatus(started, 'pending', `Building on ${name}`));
}
async function finish(build, code) {
  const text = logText(build.id);
  build.fingerprint = text.match(/^macbuild: fingerprint (\S+)/m)?.[1];
  const reused = text.match(/^macbuild: unchanged since (.+)$/m)?.[1]?.trim();
  build.status = build.status === 'cancelling' ? 'cancelled' : code !== 0 ? 'failed' : reused ? 'skipped' : 'success';
  build.finishedAt = Date.now();
  if (build.status === 'failed') { build.reason = failure(text); build.hint = diagnose(text); }
  else { delete build.reason; delete build.hint; }
  build.submission = text.match(/https:\/\/expo\.dev\S+\/submissions\/[0-9a-f-]+/)?.[0];
  if (build.status === 'skipped') {
    // The earlier build this one stands for: one of the dashboard's own when its file is in a build folder, else a copy.
    const inside = relative(DATA, reused);
    const earlier = !inside.startsWith('..') && inside.split(sep)[0];
    if (earlier && validId(earlier)) {
      const original = read(earlier);
      Object.assign(build, { reusedFrom: earlier, app: original.app, ipaBytes: original.ipaBytes, installable: false });
    } else if (existsSync(reused)) {
      copyFileSync(reused, artifactOf(build));
      await inspect(build);
    }
  }
  if (build.status === 'success') {
    await inspect(build);
    const before = allBuilds().find((item) => item.id !== build.id && item.status === 'success' && item.ipaBytes && item.project === build.project
      && item.profile === build.profile && platformOf(item) === platformOf(build));
    if (before && build.ipaBytes) build.sizeBefore = before.ipaBytes;
  }
  save(build);
  notify(build).catch((error) => console.error('notify', error.message));
  sendWebhook(build).catch((error) => console.error('webhook', error.message));
  const state = { success: 'success', skipped: 'success', failed: 'failure' }[build.status] ?? 'error';
  const description = { success: `Built in ${minutesOf(build)}`, skipped: 'Native code unchanged; reused an earlier build', failed: build.hint?.title ?? build.reason ?? 'Failed' }[build.status] ?? 'Cancelled';
  postStatus(build, state, description);
}
function cancel(id) {
  const build = read(id);
  if (build.status === 'queued') return save({ ...build, status: 'cancelled', finishedAt: Date.now() });
  if (current?.id !== id && !orphans.has(id)) return;
  save({ ...build, status: 'cancelling' });
  const pid = current?.id === id ? current.child?.pid : null;
  if (pid) {
    try { process.kill(-pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 5000);
    return;
  }
  spawn('pkill', ['-TERM', '-f', logPath(id)], { stdio: 'ignore' });
}
// Opens a simulator build in the Simulator on this Mac, booting an iPhone simulator if none is running.
async function openInSimulator(build) {
  if (!build.simulator || !existsSync(artifactOf(build))) throw new Error('This build isn’t a simulator build, or its file was removed.');
  const dir = join(dirOf(build.id), 'sim');
  if (!existsSync(dir)) { mkdirSync(dir); await run('tar', ['-xzf', artifactOf(build), '-C', dir]); }
  const app = findApp(dir);
  if (!app) throw new Error('No .app in this build.');
  const bundle = build.app?.id ?? (await run('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', join(app, 'Info.plist')])).stdout.trim();
  let device = 'booted';
  if (!/Booted/.test((await run('xcrun', ['simctl', 'list', 'devices', 'booted'])).stdout)) {
    device = (await run('xcrun', ['simctl', 'list', 'devices', 'available'])).stdout.match(/iPhone[^(\n]*\(([0-9A-F-]{36})\)/)?.[1];
    if (!device) throw new Error('No iPhone simulator found. Add one in Xcode.');
    await run('xcrun', ['simctl', 'boot', device]);
    await run('open', ['-a', 'Simulator']).catch(() => {});
  }
  await run('xcrun', ['simctl', 'install', device, app], { timeout: 120000 });
  await run('xcrun', ['simctl', 'launch', device, bundle], { timeout: 60000 });
  return { bundle };
}


// DNS rebinding: a web page can point its own domain at 127.0.0.1, which makes its requests same-origin, so they could
// send the x-macbuild header. Every request has to name this server: loopback, the tailnet name Tailscale serve keeps in
// the Host header (*.ts.net names only resolve to tailnet addresses), or a host listed in MACBUILD_UI_HOSTS.
const hostOf = (value) => { try { return new URL(value.includes('://') ? value : `http://${value}`).host; } catch { return ''; } };
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`, hostOf(UI_URL),
  ...(process.env.MACBUILD_UI_HOSTS ?? '').split(',').map((host) => hostOf(host.trim()))].filter(Boolean));
const knownHost = (host = '') => HOSTS.has(host.toLowerCase()) || /^([a-z0-9-]+\.)+ts\.net(:\d+)?$/i.test(host);
// Who asked, from the headers Tailscale serve adds for people on the tailnet. Requests on the Mac itself have none.
const who = (req) => {
  const name = req.headers['tailscale-user-name']; const login = req.headers['tailscale-user-login'];
  return name || login ? { name: String(name || login).slice(0, 80), login: String(login ?? '').slice(0, 120) } : null;
};

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const origin = (req) => UI_URL || `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
const manifest = (build, url) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>items</key><array><dict>
<key>assets</key><array><dict><key>kind</key><string>software-package</string><key>url</key><string>${xml(url)}</string></dict></array>
<key>metadata</key><dict><key>bundle-identifier</key><string>${xml(build.app.id)}</string><key>bundle-version</key><string>${xml(build.app.version)}</string><key>kind</key><string>software</string><key>title</key><string>${xml(build.app.name)}</string></dict>
</dict></array></dict></plist>`;
async function body(req, limit = 4096) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > limit) throw new Error('too large'); }
  return JSON.parse(text || '{}');
}
const download = (res, build) => {
  const file = artifactOf(build);
  if (!existsSync(file)) return json(res, 404, { error: 'artifact removed' });
  const name = `${build.project}-${build.profile}.${(build.artifact ?? 'app.ipa').slice(4)}`;
  res.writeHead(200, { 'content-type': DOWNLOAD_TYPES[build.artifact] ?? 'application/octet-stream', 'content-length': statSync(file).size, 'content-disposition': `attachment; filename="${name}"` });
  return createReadStream(file).pipe(res);
};

async function rules(req, res) {
  const { project, on = 'push', branch, profile, platform = 'ios', submit, skipUnchanged, at, enabled } = await body(req);
  if (!RULES.includes(on)) return json(res, 400, { error: 'unknown kind of rule' });
  const rule = { project, on, branch: on === 'pr' ? undefined : branch };
  const others = () => config().triggers.filter((item) => ruleKey(item) !== ruleKey(rule));
  // Turning a rule off works for a project that has since been removed, too.
  if (!enabled) { const triggers = others(); saveConfig({ triggers }); return json(res, 200, { triggers }); }
  const known = projects().find((item) => item.name === project);
  if (!known) return json(res, 400, { error: 'unknown project' });
  if (!['ios', 'android'].includes(platform)) return json(res, 400, { error: 'unknown platform' });
  const chosen = easProfiles(known.dir).find((item) => item.name === (profile ?? 'development'));
  if (!chosen) return json(res, 400, { error: 'unknown profile' });
  if (submit && chosen[platform].simulator) return json(res, 400, { error: 'simulator builds can’t be uploaded' });
  if (on !== 'pr' && !validRef(branch ?? '')) return json(res, 400, { error: 'pick a branch' });
  if (on === 'nightly' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(at ?? '')) return json(res, 400, { error: 'pick a time, like 02:00' });
  const repo = await repoOf(project);
  Object.assign(rule, { profile: chosen.name, platform, submit: Boolean(submit), skipUnchanged: Boolean(skipUnchanged) && !submit });
  if (on === 'push') {
    // From the next push on: the commit already there isn't built.
    rule.sha = await headOf(repo, branch);
    if (!rule.sha) return json(res, 400, { error: 'branch not on origin' });
  }
  if (on === 'nightly') {
    rule.at = at;
    const now = new Date(); const [hour, minute] = at.split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute) rule.lastRun = localDay(now); // first run tomorrow
  }
  if (on === 'pr') {
    // From now on: pull requests already open are built when they're next pushed to.
    const repoSlug = await slug(repo);
    const open = repoSlug ? await gh('pr', 'list', '--repo', repoSlug, '--state', 'open', '--limit', '50', '--json', 'number,headRefOid') : null;
    if (!open) return json(res, 400, { error: 'Pull request builds need the GitHub CLI, signed in (gh auth login).' });
    rule.prs = Object.fromEntries(open.map((pr) => [pr.number, pr.headRefOid]));
  }
  // Read again after the network calls: the watcher may have updated another rule meanwhile.
  const triggers = [...others(), Object.fromEntries(Object.entries(rule).filter(([, value]) => value !== undefined))];
  saveConfig({ triggers });
  return json(res, 200, { triggers });
}
async function settings(req, res) {
  const { webhook, githubStatus, appleTeam } = await body(req);
  const changes = {};
  if (webhook !== undefined) {
    if (webhook && !/^https:\/\/[^\s/]+\/\S*$/.test(webhook)) return json(res, 400, { error: 'The webhook URL has to start with https://' });
    changes.webhook = webhook || undefined;
  }
  if (githubStatus !== undefined) changes.githubStatus = Boolean(githubStatus) || undefined;
  if (appleTeam !== undefined) {
    if (appleTeam && !/^[A-Z0-9]{10}$/.test(appleTeam)) return json(res, 400, { error: 'An Apple Team ID is 10 capital letters and digits.' });
    changes.appleTeam = appleTeam || undefined;
    expoCache.clear();
  }
  saveConfig(changes);
  return json(res, 200, settingsView());
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  // a custom header cannot be sent cross-site without a preflight this server never approves
  if (req.method !== 'GET' && req.headers['x-macbuild'] !== '1') return json(res, 403, { error: 'forbidden' });
  if (url.pathname === '/api/system' && req.method === 'GET') return json(res, 200, await system());
  if (url.pathname === '/api/setup' && req.method === 'GET') return json(res, 200, await setupView());
  if (url.pathname === '/api/setup' && req.method === 'POST') return applySetup(req, res);
  if (url.pathname === '/api/menubar' && req.method === 'GET') return json(res, 200, menubarView());
  if (url.pathname === '/api/projects/scan' && req.method === 'POST') {
    await run(BIN, ['scan'], { timeout: 60000 }).catch(() => {});
    const listed = allBuilds();
    return json(res, 200, projects().map((project) => ({ name: project.name, icon: Boolean(iconPath(project)), lastBuild: listed.find((build) => build.project === project.name) ?? null })));
  }
  if (url.pathname === '/api/disk' && req.method === 'GET') return json(res, 200, await disk(url.searchParams.has('fresh')));
  if (url.pathname === '/api/disk/clean' && req.method === 'POST') {
    const { status, error } = await cleanDisk((await body(req)).key);
    return json(res, status, error ? { error } : await disk(true));
  }
  if (url.pathname === '/api/settings' && req.method === 'POST') return settings(req, res);
  if (url.pathname === '/api/settings/webhook-test' && req.method === 'POST') {
    try {
      await sendWebhook({ id: '', project: 'macbuild', platform: 'ios', profile: 'test', status: 'success', commit: { subject: 'Webhooks are working' } });
      return json(res, 200, { ok: true });
    } catch (error) {
      return json(res, 400, { error: config().webhook ? `Couldn’t send: ${error.message}` : 'Save a webhook URL first.' });
    }
  }
  if (url.pathname === '/api/push/key' && req.method === 'GET') return json(res, 200, { key: vapid().publicKey });
  if (url.pathname === '/api/push' && req.method === 'POST') {
    const { subscription, remove, test } = await body(req, 8192);
    const others = (config().subscriptions ?? []).filter((item) => item.endpoint !== (subscription?.endpoint ?? remove));
    if (test) { await notify({ project: 'macbuild', status: 'success', id: '', commit: { subject: 'Notifications are working' } }); return json(res, 200, {}); }
    saveConfig({ subscriptions: subscription ? [...others, subscription] : others });
    return json(res, 200, { count: subscription ? others.length + 1 : others.length });
  }
  if (url.pathname === '/api/state' && req.method === 'GET') {
    const builds = allBuilds();
    return json(res, 200, { projects: await Promise.all(projects().map(describe)), builds: builds.slice(0, 200).map(withEstimate) });
  }
  // The build list alone, for the page that polls it: /api/state also runs git in every project.
  if (url.pathname === '/api/builds' && req.method === 'GET') return json(res, 200, { builds: allBuilds().slice(0, 200).map(withEstimate) });
  // Project names, icons and latest builds, without git: the sidebar asks for this on every page.
  if (url.pathname === '/api/projects' && req.method === 'GET') {
    const builds = allBuilds();
    return json(res, 200, projects().map((project) => ({ name: project.name, icon: Boolean(iconPath(project)), lastBuild: builds.find((build) => build.project === project.name) ?? null })));
  }
  if (parts[1] === 'projects' && parts[2] && req.method === 'GET') {
    const project = projects().find((known) => known.name === parts[2]);
    if (!project) return json(res, 404, { error: 'unknown project' });
    if (parts[3] === 'commits') return json(res, 200, await commits(project, url.searchParams.get('branch') ?? ''));
    if (parts[3] === 'icon') {
      const file = iconPath(project);
      if (!file) { res.writeHead(404, { 'cache-control': 'max-age=300' }); return res.end(); }
      res.writeHead(200, { 'content-type': /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', 'cache-control': 'max-age=3600' });
      return createReadStream(file).pipe(res);
    }
    if (parts[3] === 'expo') {
      if (url.searchParams.has('refresh')) expoCache.delete(project.name);
      return json(res, 200, await expo(project));
    }
    return json(res, 200, await projectDetail(project));
  }
  if (url.pathname === '/api/triggers' && req.method === 'POST') return rules(req, res);
  if (url.pathname === '/api/builds' && req.method === 'POST') {
    const { project, profile, platform, ref, label, submit, skipUnchanged } = await body(req);
    if (label && !validRef(label)) return json(res, 400, { error: 'bad branch' });
    const build = await enqueue({ project, profile, platform, ref, label, submit, skipUnchanged, trigger: 'manual', by: who(req) });
    return json(res, build.error ? 400 : 201, build);
  }
  const id = parts[2];
  if (parts[1] === 'builds' && id && validId(id)) {
    if (parts[3] === 'cancel' && req.method === 'POST') { cancel(id); return json(res, 200, read(id)); }
    if (parts[3] === 'rebuild' && req.method === 'POST') {
      const old = read(id);
      const build = await enqueue({ project: old.project, profile: old.profile, platform: platformOf(old), ref: old.source === 'working' ? null : old.commit.hash, label: old.ref, submit: submits(old), skipUnchanged: false, trigger: 'rebuild', by: who(req) });
      return json(res, build.error ? 400 : 201, build);
    }
    if (parts[3] === 'simulator' && req.method === 'POST') {
      try { return json(res, 200, await openInSimulator(read(id))); } catch (error) { return json(res, 400, { error: error.message.split('\n')[0] }); }
    }
    if (parts[3] === 'qr.svg' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(await QRCode.toString(`${origin(req)}/#/build/${id}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    }
    if (parts[3] === 'github' && req.method === 'GET') return json(res, 200, await checks(read(id)));
    if (parts[3] === 'log.txt' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${id}.log"` });
      return res.end(clean(logText(id)).join('\n'));
    }
    if ((parts[3] === 'artifact' || parts[3] === 'app.ipa') && req.method === 'GET') return download(res, read(id));
    if (parts[3] === 'log' && req.method === 'GET') {
      const from = Number(url.searchParams.get('from') ?? 0) || 0;
      const path = logPath(id);
      const size = existsSync(path) ? statSync(path).size : 0;
      let lines = []; let nextOffset = from;
      if (size > from) {
        const start = from === 0 ? Math.max(0, size - 200000) : from;
        const text = readFileSync(path).subarray(start).toString('utf8');
        const end = text.lastIndexOf('\n');
        if (end >= 0) { lines = clean(text.slice(0, end)); nextOffset = start + Buffer.byteLength(text.slice(0, end + 1)); }
      }
      return json(res, 200, { build: withEstimate(read(id)), lines, next: nextOffset });
    }
    if (!parts[3] && req.method === 'GET') return json(res, 200, withEstimate(read(id)));
  }
  return json(res, 404, { error: 'not found' });
}
function ota(req, res, url) {
  const [, , id, file] = url.pathname.split('/');
  if (!id || !validId(id)) { res.writeHead(404); return res.end(); }
  const build = read(id);
  const ipa = artifactOf(build);
  if ((build.artifact ?? 'app.ipa') !== 'app.ipa' || !existsSync(ipa) || !build.installable) { res.writeHead(404); return res.end(); }
  if (file === 'manifest.plist') {
    res.writeHead(200, { 'content-type': 'text/xml' });
    return res.end(manifest(build, `${origin(req)}/ota/${id}/app.ipa`));
  }
  if (file === 'app.ipa') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(ipa).size });
    return createReadStream(ipa).pipe(res);
  }
  res.writeHead(404); res.end();
}
function serve(res, pathname) {
  const file = resolve(HERE, 'public', `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(join(HERE, 'public')) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

createServer(async (req, res) => {
  if (!knownHost(req.headers.host)) { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('unknown host\n'); }
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/ota/')) return ota(req, res, url);
    serve(res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`macbuild UI on 127.0.0.1:${PORT}`);
  recoverInterrupted().catch((error) => console.error('recover', error.message)).finally(() => { prune(); next(); });
});
