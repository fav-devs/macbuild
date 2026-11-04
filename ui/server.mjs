// macbuild UI: start, watch and install local iOS builds from a phone. Listens on loopback only; `tailscale serve`
// gives it HTTPS on the tailnet, which is also what iOS requires to install an app from a web page.
import { spawn, execFile } from 'node:child_process';
import { createReadStream, existsSync, statfsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, homedir, loadavg, tmpdir, totalmem, uptime } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import webpush from 'web-push';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DATA = process.env.MACBUILD_DATA ?? join(homedir(), '.local/share/macbuild/builds');
const PORT = Number(process.env.MACBUILD_UI_PORT ?? 4180);
const BIN = process.env.MACBUILD_BIN ?? join(ROOT, 'bin/macbuild');
const KEEP_IPAS = 10;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const CONFIG = process.env.MACBUILD_CONFIG ?? join(homedir(), '.config/macbuild/ui.json');
const SUBMIT_MARK = /Scheduling iOS submission|Submitting your app/;

mkdirSync(DATA, { recursive: true });
const dirOf = (id) => join(DATA, id);
const metaOf = (id) => join(dirOf(id), 'meta.json');
const validId = (id) => /^[0-9a-z-]+$/.test(id) && existsSync(metaOf(id));
const read = (id) => JSON.parse(readFileSync(metaOf(id), 'utf8'));
const save = (build) => {
  writeFileSync(`${metaOf(build.id)}.tmp`, JSON.stringify(build));
  renameSync(`${metaOf(build.id)}.tmp`, metaOf(build.id));
};
const allBuilds = () => readdirSync(DATA).filter(validId).map(read).sort((a, b) => b.createdAt - a.createdAt);

const PROJECTS = process.env.MACBUILD_PROJECTS ?? join(homedir(), '.config/macbuild/projects.conf');
const projects = () => (existsSync(PROJECTS) ? readFileSync(PROJECTS, 'utf8') : '').split('\n')
  .filter((line) => line.includes('|') && !line.startsWith('#'))
  .map((line) => { const [name, dir] = line.split('|'); return { name, dir }; });
async function git(dir, ...args) {
  try { return (await run('git', ['-C', dir, ...args])).stdout.trim(); } catch { return ''; }
}
async function describe(project) {
  const [branch, commit, subject, dirty] = await Promise.all([
    git(project.dir, 'branch', '--show-current'), git(project.dir, 'rev-parse', '--short', 'HEAD'),
    git(project.dir, 'log', '-1', '--format=%s'), git(project.dir, 'status', '--porcelain')]);
  return { name: project.name, branch, commit, subject, dirty: dirty ? dirty.split('\n').length : 0, lastBuild: allBuilds().find((build) => build.project === project.name) ?? null };
}

const clean = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n')
  .map((line) => line.split('\r').filter((part) => part.trim()).pop() ?? '')
  .map((line) => line.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]+\s*/, '').trimEnd())
  .filter((line) => line && !/eas-cli@|To upgrade, run|npm install -g eas-cli|outdated version/.test(line));
const logPath = (id) => join(dirOf(id), 'build.log');
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
function failure(id) {
  if (!existsSync(logPath(id))) return '';
  const lines = clean(readFileSync(logPath(id), 'utf8'));
  return lines.filter((line) => /❌|error:|Error:|failed|non-zero code/i.test(line) && !/build command failed/.test(line)).slice(-1)[0]?.trim() ?? '';
}

async function inspectIpa(build) {
  const ipa = join(dirOf(build.id), 'app.ipa');
  if (!existsSync(ipa)) return;
  build.ipaBytes = statSync(ipa).size;
  const scratch = join(tmpdir(), `macbuild-${build.id}`);
  mkdirSync(scratch, { recursive: true });
  try {
    const shell = (command) => run('/bin/sh', ['-c', command], { maxBuffer: 1 << 26 });
    await shell(`unzip -p '${ipa}' 'Payload/*.app/Info.plist' > '${scratch}/Info.plist'`);
    const info = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', `${scratch}/Info.plist`], { maxBuffer: 1 << 24 })).stdout);
    build.app = { id: info.CFBundleIdentifier, name: info.CFBundleDisplayName ?? info.CFBundleName, version: info.CFBundleShortVersionString, number: info.CFBundleVersion };
    const profile = (await shell(`unzip -p '${ipa}' 'Payload/*.app/embedded.mobileprovision' | security cms -D`)).stdout;
    build.installable = profile.includes('ProvisionedDevices');
    const value = (key) => profile.match(new RegExp(`<key>${key}</key>\\s*<(?:string|date)>([^<]*)<`))?.[1];
    build.signing = {
      profile: value('Name'), team: value('TeamName'), expires: value('ExpirationDate'),
      devices: (profile.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1].match(/<string>/g) ?? []).length,
    };
    try {
      await shell(`unzip -p '${ipa}' 'Payload/*.app/Expo.plist' > '${scratch}/Expo.plist'`);
      const expo = JSON.parse((await run('plutil', ['-convert', 'json', '-o', '-', `${scratch}/Expo.plist`])).stdout);
      build.runtime = expo.EXUpdatesRuntimeVersion;
    } catch {}
  } catch (error) {
    console.error('inspect', build.id, error.message);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function prune() {
  allBuilds().filter((build) => existsSync(join(dirOf(build.id), 'app.ipa'))).slice(KEEP_IPAS).forEach((build) => {
    rmSync(join(dirOf(build.id), 'app.ipa'), { force: true });
    save({ ...build, installable: false, expired: true });
  });
}

const config = () => { try { return { triggers: [], ...JSON.parse(readFileSync(CONFIG, 'utf8')) }; } catch { return { triggers: [] }; } };
const saveConfig = (next) => { mkdirSync(dirname(CONFIG), { recursive: true }); writeFileSync(CONFIG, JSON.stringify({ ...config(), ...next }, null, 2)); };
const repoOf = async (name) => git(projects().find((known) => known.name === name).dir, 'rev-parse', '--show-toplevel');
const headOf = async (repo, branch) => (await git(repo, 'ls-remote', 'origin', `refs/heads/${branch}`)).split(/\s/)[0];
const validRef = (ref) => /^[\w./-]{1,200}$/.test(ref) && !ref.startsWith('-') && !ref.includes('..');
async function slug(repo) {
  const remote = await git(repo, 'remote', 'get-url', 'origin');
  return remote.match(/github\.com[:/]([^/]+\/[^/.]+)/)?.[1] ?? '';
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
async function commitInfo(repo, ref, name) {
  const out = await git(repo, 'log', '-1', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct', ref);
  if (!out) return null;
  const [hash, short, subject, author, time] = out.split('\x1f');
  const repoSlug = await slug(repo);
  return { hash, short, subject, author, date: Number(time) * 1000, url: repoSlug ? `https://github.com/${repoSlug}/commit/${hash}` : '' };
}
function easProfiles(dir) {
  try {
    const { build } = JSON.parse(readFileSync(join(dir, 'eas.json'), 'utf8'));
    const value = (name, key) => build[name]?.[key] ?? (build[name]?.extends ? value(build[name].extends, key) : undefined);
    return Object.keys(build).filter((name) => !value(name, 'ios')?.simulator).map((name) => ({ name, distribution: value(name, 'distribution') ?? 'store', channel: value(name, 'channel') ?? '' }));
  } catch { return []; }
}
async function enqueue({ project, profile, ref, label, submit, trigger }) {
  const known = projects().find((candidate) => candidate.name === project);
  if (!known) return { error: 'unknown project' };
  const profiles = easProfiles(known.dir);
  const chosen = profiles.find((candidate) => candidate.name === profile);
  if (!chosen) return { error: 'unknown profile' };
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
    id: `${stamp}-${project}`.toLowerCase(), project, action: submit ? 'testflight' : 'build', profile, distribution: chosen.distribution, channel: chosen.channel,
    source: ref ? 'github' : 'working', ref: branch, commit, pr: pr ?? null, repo: repoSlug, trigger, status: 'queued', createdAt: Date.now(),
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
  return {
    ...(await describe(project)), repo: repoSlug, refreshing, behind, branches, profiles: easProfiles(project.dir), builds: builds.slice(0, 30),
    signing: builds.find((build) => build.signing)?.signing ?? null, storeSigning: builds.find((build) => build.signing && !build.installable)?.signing ?? null,
    stats: { total: done.length, passed: done.filter((build) => build.status === 'success').length, median: times[Math.floor(times.length / 2)] ?? 0 },
    triggers: config().triggers.filter((rule) => rule.project === project.name),
  };
}
async function checks(build) {
  if (!build.repo || !build.commit) return null;
  const data = await gh('api', `repos/${build.repo}/commits/${build.commit.hash}/check-runs?per_page=50`);
  if (!data) return null;
  const runs = data.check_runs ?? [];
  const failed = runs.filter((run) => ['failure', 'timed_out', 'cancelled'].includes(run.conclusion));
  return { total: runs.length, failed: failed.length, pending: runs.filter((run) => run.status !== 'completed').length, url: `https://github.com/${build.repo}/commit/${build.commit.hash}/checks` };
}
// Web Push: keys and subscriptions live in the local config. Apple delivers to a Home Screen web app on iOS 16.4+.
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
  const title = `${build.project}: ${build.status === 'success' ? 'build finished' : build.status === 'failed' ? 'build failed' : 'build cancelled'}`;
  const payload = JSON.stringify({ title, body: `${build.ref ?? ''} ${build.commit?.short ?? ''} · ${build.commit?.subject ?? ''}`.trim(), url: `/#/build/${build.id}` });
  const dead = [];
  await Promise.all(subscriptions.map((subscription) => webpush.sendNotification(subscription, payload).catch((error) => {
    if ([404, 410].includes(error.statusCode)) dead.push(subscription.endpoint);
    else console.error('push', error.statusCode ?? error.message);
  })));
  if (dead.length) saveConfig({ subscriptions: config().subscriptions.filter((item) => !dead.includes(item.endpoint)) });
}
const tools = {};
async function toolVersions() {
  if (tools.xcode) return tools;
  const out = async (command, args) => { try { return (await run(command, args, { timeout: 15000 })).stdout.trim(); } catch { return ''; } };
  tools.xcode = (await out('xcodebuild', ['-version'])).split('\n')[0].replace('Xcode ', '');
  tools.eas = (await out('eas', ['--version'])).match(/eas-cli\/([\d.]+)/)?.[1] ?? '';
  tools.node = process.version.slice(1);
  return tools;
}
async function system() {
  const disk = statfsSync(homedir());
  const battery = await run('pmset', ['-g', 'batt']).then(({ stdout }) => stdout.match(/(\d+)%;\s*([a-zA-Z ]+)/)).catch(() => null);
  const builds = allBuilds();
  return {
    diskFree: disk.bavail * disk.bsize, diskTotal: disk.blocks * disk.bsize, load: loadavg()[0], cores: cpus().length, memory: totalmem(), uptime: uptime(),
    battery: battery ? { percent: Number(battery[1]), state: battery[2].trim() } : null, tools: await toolVersions(),
    queued: builds.filter((build) => build.status === 'queued').length, running: builds.find((build) => build.status === 'running')?.id ?? null,
    ipaBytes: builds.reduce((sum, build) => sum + (build.expired ? 0 : build.ipaBytes ?? 0), 0), push: (config().subscriptions ?? []).length, triggers: config().triggers,
  };
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
  const [info, submissions, channels, cloud, production, preview, development, devices] = await Promise.all([
    safe(eas(project.dir, 'project:info')),
    safe(easJson(project.dir, 'submit:list', '--platform', 'ios', '--limit', '8').catch(() => eas(project.dir, 'submit:list', '--platform', 'ios', '--limit', '8', '--json').then(parsed))),
    safe(easJson(project.dir, 'channel:list')),
    safe(easJson(project.dir, 'build:list', '--platform', 'ios', '--limit', '20')),
    safe(envNames(project.dir, 'production')), safe(envNames(project.dir, 'preview')), safe(envNames(project.dir, 'development')),
    team ? safe(eas(project.dir, 'device:list', '--apple-team-id', team, '--non-interactive')) : null,
  ]);
  const full = info?.match(/fullName\s+@([^/\s]+)\/(\S+)/);
  const data = {
    url: full ? `https://expo.dev/accounts/${full[1]}/projects/${full[2]}` : '',
    submissions: (submissions ?? []).map((item) => ({ id: item.id, status: item.status, createdAt: item.createdAt, completedAt: item.completedAt, ascApp: item.iosConfig?.ascAppIdentifier })),
    channels: (channels?.currentPage ?? []).map((item) => ({ name: item.name, paused: item.isPaused, branches: (item.updateBranches ?? []).map((branch) => ({ name: branch.name, updates: branch.updateGroups?.length ?? 0 })) })),
    cloud: (cloud ?? []).map((item) => ({ profile: item.buildProfile, status: item.status, createdAt: item.createdAt, version: item.appVersion, number: item.appBuildVersion })),
    env: { production, preview, development },
    devices: (devices ?? '').split(/\n\s*\n/).map((block) => ({ name: block.match(/^Name\s+(.+)$/m)?.[1], kind: block.match(/^Class\s+(.+)$/m)?.[1], udid: block.match(/^UDID\s+(\S+)/m)?.[1]?.slice(-6) })).filter((item) => item.name),
    fetchedAt: Date.now(),
  };
  expoCache.set(project.name, { at: Date.now(), data });
  return data;
}
async function watchPushes() {
  const { triggers } = config();
  for (const rule of triggers) {
    const repo = await repoOf(rule.project);
    const sha = await headOf(repo, rule.branch);
    if (!sha || sha === rule.sha) continue;
    saveConfig({ triggers: config().triggers.map((item) => (item === rule || (item.project === rule.project && item.branch === rule.branch) ? { ...item, sha } : item)) });
    await enqueue({ project: rule.project, profile: rule.profile, ref: rule.branch, submit: rule.submit, trigger: 'push' });
  }
}
setInterval(() => watchPushes().catch((error) => console.error('watch', error.message)), 60000);

let current = null;
async function next() {
  if (current) return;
  const build = allBuilds().reverse().find((candidate) => candidate.status === 'queued');
  if (!build) return;
  const args = [build.project, '--profile', build.profile, '--fast', '--output', join(dirOf(build.id), 'app.ipa')];
  if (build.action === 'testflight') args.push('--testflight');
  if (build.source !== 'working') args.push('--ref', build.commit.hash);
  const child = spawn(BIN, args, { detached: true, stdio: 'ignore', env: { ...process.env, MACBUILD_LOG: logPath(build.id) } });
  current = { id: build.id, child };
  save({ ...build, status: 'running', startedAt: Date.now() });
  const tracker = setInterval(() => trackPhases(build.id), 2000);
  child.on('close', async (code) => {
    clearInterval(tracker);
    trackPhases(build.id);
    const finished = read(build.id);
    finished.status = finished.status === 'cancelling' ? 'cancelled' : code === 0 ? 'success' : 'failed';
    finished.finishedAt = Date.now();
    if (finished.status === 'failed') finished.reason = failure(build.id);
    if (existsSync(logPath(build.id))) finished.submission = readFileSync(logPath(build.id), 'utf8').match(/https:\/\/expo\.dev\S+\/submissions\/[0-9a-f-]+/)?.[0];
    await inspectIpa(finished);
    save(finished);
    notify(finished).catch((error) => console.error('notify', error.message));
    current = null;
    prune();
    next();
  });
}
function cancel(id) {
  const build = read(id);
  if (build.status === 'queued') return save({ ...build, status: 'cancelled', finishedAt: Date.now() });
  if (current?.id !== id) return;
  save({ ...build, status: 'cancelling' });
  const { pid } = current.child;
  try { process.kill(-pid, 'SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 5000);
}
for (const build of allBuilds()) {
  if (['running', 'cancelling'].includes(build.status)) save({ ...build, status: 'failed', reason: 'The UI restarted during this build', finishedAt: Date.now() });
}

const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const xml = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const origin = (req) => process.env.MACBUILD_UI_URL ?? `https://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
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

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  // a custom header cannot be sent cross-site without a preflight this server never approves
  if (req.method !== 'GET' && req.headers['x-macbuild'] !== '1') return json(res, 403, { error: 'forbidden' });
  if (url.pathname === '/api/system' && req.method === 'GET') return json(res, 200, await system());
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
    return json(res, 200, { projects: await Promise.all(projects().map(describe)), builds: builds.slice(0, 200) });
  }
  if (parts[1] === 'projects' && parts[2] && req.method === 'GET') {
    const project = projects().find((known) => known.name === parts[2]);
    if (!project) return json(res, 404, { error: 'unknown project' });
    if (parts[3] === 'commits') return json(res, 200, await commits(project, url.searchParams.get('branch') ?? ''));
    if (parts[3] === 'expo') {
      if (url.searchParams.has('refresh')) expoCache.delete(project.name);
      return json(res, 200, await expo(project));
    }
    return json(res, 200, await projectDetail(project));
  }
  if (url.pathname === '/api/triggers' && req.method === 'POST') {
    const { project, branch, profile, submit, enabled } = await body(req);
    if (!projects().some((known) => known.name === project)) return json(res, 400, { error: 'unknown project' });
    const others = config().triggers.filter((rule) => !(rule.project === project && rule.branch === branch));
    if (!enabled) { saveConfig({ triggers: others }); return json(res, 200, { triggers: others }); }
    const repo = await repoOf(project);
    const sha = await headOf(repo, branch);
    if (!sha) return json(res, 400, { error: 'branch not on origin' });
    const triggers = [...others, { project, branch, profile: profile ?? 'development', submit: Boolean(submit), sha }];
    saveConfig({ triggers });
    return json(res, 200, { triggers });
  }
  if (url.pathname === '/api/builds' && req.method === 'POST') {
    const { project, profile, ref, label, submit } = await body(req);
    if (label && !validRef(label)) return json(res, 400, { error: 'bad branch' });
    const build = await enqueue({ project, profile, ref, label, submit, trigger: 'manual' });
    return json(res, build.error ? 400 : 201, build);
  }
  const id = parts[2];
  if (parts[1] === 'builds' && id && validId(id)) {
    if (parts[3] === 'cancel' && req.method === 'POST') { cancel(id); return json(res, 200, read(id)); }
    if (parts[3] === 'rebuild' && req.method === 'POST') {
      const old = read(id);
      const build = await enqueue({ project: old.project, profile: old.profile, ref: old.source === 'working' ? null : old.commit.hash, label: old.ref, submit: old.action === 'testflight', trigger: 'rebuild' });
      return json(res, build.error ? 400 : 201, build);
    }
    if (parts[3] === 'qr.svg' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(await QRCode.toString(`${origin(req)}/#/build/${id}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    }
    if (parts[3] === 'github' && req.method === 'GET') return json(res, 200, await checks(read(id)));
    if (parts[3] === 'log.txt' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${id}.log"` });
      return res.end(existsSync(logPath(id)) ? clean(readFileSync(logPath(id), 'utf8')).join('\n') : '');
    }
    if (parts[3] === 'app.ipa' && req.method === 'GET') {
      const ipa = join(dirOf(id), 'app.ipa');
      if (!existsSync(ipa)) return json(res, 404, { error: 'artifact removed' });
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': statSync(ipa).size, 'content-disposition': `attachment; filename="${read(id).project}-${read(id).profile}.ipa"` });
      return createReadStream(ipa).pipe(res);
    }
    if (parts[3] === 'log' && req.method === 'GET') {
      const from = Number(url.searchParams.get('from') ?? 0);
      const path = logPath(id);
      const size = existsSync(path) ? statSync(path).size : 0;
      let lines = []; let nextOffset = from;
      if (size > from) {
        const start = from === 0 ? Math.max(0, size - 200000) : from;
        const text = readFileSync(path).subarray(start).toString('utf8');
        const end = text.lastIndexOf('\n');
        if (end >= 0) { lines = clean(text.slice(0, end)); nextOffset = start + Buffer.byteLength(text.slice(0, end + 1)); }
      }
      return json(res, 200, { build: read(id), lines, next: nextOffset });
    }
    if (!parts[3] && req.method === 'GET') return json(res, 200, read(id));
  }
  return json(res, 404, { error: 'not found' });
}
function ota(req, res, url) {
  const [, , id, file] = url.pathname.split('/');
  if (!id || !validId(id)) { res.writeHead(404); return res.end(); }
  const build = read(id);
  const ipa = join(dirOf(id), 'app.ipa');
  if (!existsSync(ipa) || !build.installable) { res.writeHead(404); return res.end(); }
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
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/ota/')) return ota(req, res, url);
    serve(res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, '127.0.0.1', () => { console.log(`macbuild UI on 127.0.0.1:${PORT}`); next(); });
