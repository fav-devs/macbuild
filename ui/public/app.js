// macbuild dashboard. Hash routes, each a function that renders a page from the local server's JSON API; pages showing
// live work poll it, and a one-second ticker keeps elapsed times moving between polls. No framework: HTML strings, with
// every value from the server passed through esc().
const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app'); const side = $('#side'); const tabs = $('#tabs'); const tip = $('#tip');

const ICONS = {
  cube: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><path d="m4 7.4 8 4.6 8-4.6M12 12v9.2"/>',
  layers: '<path d="m12 3 9 4.8-9 4.8-9-4.8z"/><path d="m3 12.2 9 4.8 9-4.8"/><path d="m3 16.4 9 4.8 9-4.8" opacity=".55"/>',
  apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  branch: '<circle cx="6" cy="5.5" r="2.5"/><circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="7.5" r="2.5"/><path d="M6 8v8M18 10c0 4-4 4.5-9.5 7"/>',
  pr: '<circle cx="6" cy="5.5" r="2.5"/><circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-4M13 3.5 10.5 6 13 8.5"/>',
  check: '<circle cx="12" cy="12" r="9.2"/><path d="m8.3 12.2 2.5 2.5 4.9-5.2"/>',
  cross: '<circle cx="12" cy="12" r="9.2"/><path d="m15 9-6 6M9 9l6 6"/>',
  spinner: '<circle cx="12" cy="12" r="9.2" opacity=".25"/><path d="M21.2 12A9.2 9.2 0 0 0 12 2.8"/>',
  clock: '<circle cx="12" cy="12" r="9.2"/><path d="M12 7v5l3 2"/>',
  ban: '<circle cx="12" cy="12" r="9.2"/><path d="m5.6 5.6 12.8 12.8"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.6"/><path d="M11 18.5h2"/>',
  tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2.4"/><path d="M11 18.5h2"/>',
  download: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 16.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2.5"/>',
  rebuild: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  out: '<path d="M8 16 16 8M9.5 8H16v6.5"/>',
  search: '<circle cx="11" cy="11" r="6.8"/><path d="m20 20-4.2-4.2"/>',
  send: '<path d="M21 3 10.4 13.6M21 3l-6.6 18-4-7.4L3 9.6z"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M8.2 15.8a5.4 5.4 0 0 1 0-7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 18.7a9.4 9.4 0 0 1 0-13.4M18.7 5.3a9.4 9.4 0 0 1 0 13.4"/>',
  shield: '<path d="M12 21.5s7.5-3.4 7.5-9.6V5.6L12 2.8 4.5 5.6v6.3c0 6.2 7.5 9.6 7.5 9.6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  braces: '<path d="M8 3.5H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2.5 2 2 0 0 1 2 2.5v4a2 2 0 0 0 2 2h1M16 3.5h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2.5 2 2 0 0 0-2 2.5v4a2 2 0 0 1-2 2h-1"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  tag: '<path d="M3 12.2V4a1 1 0 0 1 1-1h8.2l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-7.1 7.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="7.8" cy="7.8" r="1.3"/>',
  mac: '<rect x="3" y="4" width="18" height="12" rx="1.8"/><path d="M8.5 20h7M12 16v4"/>',
  disk: '<rect x="3" y="13" width="18" height="7.5" rx="2"/><path d="M5.5 13 8 4.5h8l2.5 8.5M7 16.8h.01"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6.5 2.5 8.5 2.5 8.5h-17S6 15.5 6 9"/><path d="M10.3 20.5a2 2 0 0 0 3.4 0"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  alert: '<path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4.5M12 17h.01"/>',
  cloudoff: '<path d="m3 3 18 18M8 6.4A6.5 6.5 0 0 1 18.1 10h.4a4 4 0 0 1 2.4 7.2M17 18H6.5a4.5 4.5 0 0 1-1.2-8.8"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  skip: '<circle cx="12" cy="12" r="9.2"/><path d="m8.2 8.5 3.5 3.5-3.5 3.5M12.8 8.5l3.5 3.5-3.5 3.5"/>',
  link: '<path d="M10 13.5a4.5 4.5 0 0 0 6.8.5l2.7-2.7a4.5 4.5 0 0 0-6.4-6.4L11.6 6.4"/><path d="M14 10.5a4.5 4.5 0 0 0-6.8-.5l-2.7 2.7a4.5 4.5 0 0 0 6.4 6.4l1.5-1.5"/>',
  broom: '<path d="M14.5 3.5 10 12M7 12.5h7.5l2 8H4.5z"/><path d="M8.5 16.5v4M12.5 16.5v4"/>',
};
const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Formatting
const DAY = 86400000;
function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function span(ms, rough = false) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (rough) return seconds < 90 ? '1 min' : `${Math.round(seconds / 60)} min`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const mb = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '—');
const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes >= 1e11 ? 0 : 1)} GB`;
const day = (time) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const when = (time) => new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function dayLabel(time) {
  const date = new Date(time); const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - new Date(time).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, days < 7 ? { weekday: 'long' } : { weekday: 'short', month: 'long', day: 'numeric' });
}

// Builds
const STATUS = {
  queued: ['Queued', 'clock'], running: ['Building', 'spinner'], cancelling: ['Cancelling', 'spinner'],
  success: ['Finished', 'check'], failed: ['Failed', 'cross'], cancelled: ['Cancelled', 'ban'], skipped: ['Reused', 'skip'],
};
const PHASES = {
  SETUP: 'Setup', SETUP_WORKINGDIR: 'Prepare work folder', START_BUILD: 'Start build', PREPARE_PROJECT: 'Prepare project',
  READ_EAS_JSON: 'Read eas.json', READ_PACKAGE_JSON: 'Read package.json', INSTALL_DEPENDENCIES: 'Install dependencies',
  READ_APP_CONFIG: 'Read app config', RUN_EXPO_DOCTOR: 'Expo doctor', PREPARE_CREDENTIALS: 'Prepare credentials', PREBUILD: 'Prebuild',
  RESTORE_CACHE: 'Restore cache', INSTALL_PODS: 'Install pods', CALCULATE_EXPO_UPDATES_RUNTIME_VERSION: 'Runtime version',
  CONFIGURE_EXPO_UPDATES: 'Configure updates', CONFIGURE_XCODE_PROJECT: 'Configure Xcode', RUN_FASTLANE: 'Compile and archive',
  PREPARE_ARTIFACTS: 'Prepare artifacts', SAVE_CACHE: 'Save cache', UPLOAD_APPLICATION_ARCHIVE: 'Package IPA',
  CLEAN_UP_CREDENTIALS: 'Clean up credentials', COMPLETE_BUILD: 'Complete build', SUBMIT: 'Upload to the store', RUN_GRADLEW: 'Gradle build',
};
const phaseName = (name) => PHASES[name] ?? `${name.charAt(0)}${name.slice(1).toLowerCase().replace(/_/g, ' ')}`;
const active = (build) => ['queued', 'running', 'cancelling'].includes(build.status);
// Uploads were 'testflight' before Android, and are 'submit' now.
const submits = (build) => build.action === 'submit' || build.action === 'testflight';
const storeName = (platform) => (platform === 'android' ? 'Google Play' : 'TestFlight');
const store = (build) => build.distribution === 'store' || submits(build);
const short = (build) => build.commit?.short ?? '';
const refOf = (build) => build.ref ?? '';
const subject = (build) => build.commit?.subject || 'Working copy';
const took = (build) => (build.startedAt && build.finishedAt ? span(build.finishedAt - build.startedAt) : '');
const TRIGGERS = { manual: 'Started by hand', push: 'Push to branch', pr: 'Pull request', nightly: 'Nightly build', rebuild: 'Rebuild', cli: 'CLI' };
const triggerOf = (build) => (build.by?.name ? `${esc(build.by.name)}${build.trigger === 'rebuild' ? ' <span class="faint">(rebuild)</span>' : ''}` : esc(TRIGGERS[build.trigger] ?? 'Started by hand'));
const kindOf = (build) => (submits(build) ? storeName(build.platform) : build.profile);
const platformName = (build) => (build.platform === 'android' ? 'Android' : build.simulator ? 'iOS Simulator' : 'iOS');
const FILE_KINDS = { 'app.ipa': 'IPA', 'app.apk': 'APK', 'app.aab': 'AAB', 'app.tar.gz': '.tar.gz' };
const fileKind = (build) => FILE_KINDS[build.artifact ?? 'app.ipa'];
// A build's own file is on this Mac: reused builds point at the earlier build instead.
const hasFile = (build) => Boolean(build.ipaBytes && !build.expired && (build.status === 'success' || (build.status === 'skipped' && !build.reusedFrom)));
const fixHtml = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const RULE_KINDS = { push: 'On every push', pr: 'Pull requests', nightly: 'Every night' };
const ruleTitle = (rule) => ((rule.on ?? 'push') === 'pr' ? 'Each pull request' : rule.on === 'nightly' ? `${esc(rule.branch)} every night at ${esc(rule.at)}` : `${esc(rule.branch)} on every push`);
const ruleDetail = (rule) => `${rule.platform === 'android' ? 'Android' : 'iOS'} · ${esc(rule.profile)}${rule.submit ? ` · ${storeName(rule.platform)}` : ''}${rule.skipUnchanged ? ' · reuses' : ''}${rule.error ? ` · <span class="warn">${esc(rule.error)}</span>` : ''}`;
const statusIcon = (status) => `<span class="st ${status}" role="img" aria-label="${STATUS[status][0]}">${icon(STATUS[status][1])}</span>`;
const badge = (status) => `<span class="badge ${status}">${STATUS[status][0]}</span>`;
const profileTag = (build) => (submits(build) ? `<span class="tag store">${icon('send')}${storeName(build.platform)}</span>` : `<span class="tag ${store(build) ? 'store' : ''}">${esc(build.profile)}</span>`);
const platformTag = (build) => (build.platform === 'android' ? '<span class="tag">Android</span>' : build.simulator ? '<span class="tag">Simulator</span>' : '');

// Project avatars: the app icon when the server found one in app.json, else a monogram on a gradient from the name.
const PALETTE = [['#8b8af5', '#5b5bd6'], ['#62b4ff', '#2f6fe0'], ['#48d6ac', '#0f9d79'], ['#ffbd59', '#f07c1d'], ['#ff86ad', '#dd4579'], ['#bf97ff', '#7d4fe0'], ['#6fd6ec', '#1a93b8'], ['#a3abbd', '#5d6577']];
function avatar(name, size = '') {
  const [a, b] = PALETTE[[...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 9973, 7) % PALETTE.length];
  const img = shell.projects.find((project) => project.name === name)?.icon ? `<img src="/api/projects/${encodeURIComponent(name)}/icon" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="av ${size}" style="--a:${a};--b:${b}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}${img}</span>`;
}

// Server
const shell = { projects: [], system: null };
const routing = { token: 0, controller: new AbortController(), timers: [] };
async function get(path) {
  const { signal } = routing.controller;
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) throw Object.assign(new Error(`Request failed: ${response.status}`), { status: response.status });
  return response.json();
}
async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify(body ?? {}) });
  return response.json().catch(() => ({}));
}
// Runs work again after ms (a number, or a function returning one) until the page changes or work returns 'stop'.
function every(ms, work) {
  const token = routing.token;
  const delay = () => (typeof ms === 'function' ? ms() : ms);
  const tick_ = async () => {
    if (token !== routing.token) return;
    let result;
    try { result = await work(); toast(''); } catch (error) { if (error.name === 'AbortError') return; toast('Reconnecting to your Mac…'); }
    if (token === routing.token && result !== 'stop') routing.timers.push(setTimeout(tick_, delay()));
  };
  routing.timers.push(setTimeout(tick_, delay()));
}
function toast(text) {
  let box = $('.toast');
  if (!text) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'toast'; box.setAttribute('role', 'status'); document.body.append(box); }
  box.innerHTML = `${icon('spinner', 'sm')}${esc(text)}`;
}
function flash(text, bad = false) {
  const box = document.createElement('div');
  box.className = `toast ${bad ? 'bad' : ''}`; box.setAttribute('role', 'status'); box.textContent = text;
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}
const machineName = () => shell.system?.machine?.name || 'this Mac';
const expoCache = new Map();
async function expoOf(name) {
  if (!expoCache.has(name)) expoCache.set(name, await get(`/api/projects/${encodeURIComponent(name)}/expo`));
  return expoCache.get(name);
}

// Shell: the sidebar, with the Mac itself at the bottom, on wide screens; tabs on a phone.
const SECTIONS = {
  overview: ['Overview', 'home'], builds: ['Builds', 'layers'], branches: ['Branches', 'branch'], submissions: ['Submissions', 'send'],
  channels: ['Channels', 'radio'], signing: ['Signing', 'shield'], environment: ['Environment', 'braces'], automation: ['Automation', 'bolt'],
};
const ALIASES = { activity: 'builds', insights: 'overview', devices: 'signing' };
function parseRoute() {
  const hash = location.hash || '#/';
  let match = hash.match(/^#\/build\/([0-9a-z-]+)$/);
  if (match) return { page: 'build', id: match[1] };
  match = hash.match(/^#\/p\/([\w.-]+)\/new(?:\?branch=(.*))?$/);
  if (match) return { page: 'new', name: match[1], branch: match[2] === undefined ? null : decodeURIComponent(match[2]) };
  match = hash.match(/^#\/p\/([\w.-]+)(?:\/([\w-]+))?\/?$/);
  if (match) {
    const section = ALIASES[match[2]] ?? match[2] ?? 'overview';
    return { page: 'project', name: match[1], section: SECTIONS[section] ? section : 'overview' };
  }
  return { page: { '#/projects': 'projects', '#/new': 'pick', '#/insights': 'insights', '#/settings': 'settings', '#/setup': 'setup' }[hash] ?? 'builds' };
}
function renderShell(where) {
  const on = (test) => (test ? ' class="on" aria-current="page"' : '');
  const top = ['builds', 'build'].includes(where.page) ? 'builds' : ['projects', 'pick', 'project', 'new'].includes(where.page) ? 'projects' : where.page === 'setup' ? 'settings' : where.page;
  const projectName = ['project', 'new'].includes(where.page) ? where.name : null;
  side.innerHTML = `
    <a class="brand" href="#/"><span class="mark">${icon('cube')}</span>macbuild<span class="tag">local</span></a>
    <nav class="nav" aria-label="Main">
      <a${on(top === 'builds')} href="#/">${icon('layers')}<span>Builds</span></a>
      <a${on(top === 'projects' && !projectName)} href="#/projects">${icon('apps')}<span>Projects</span></a>
      <a${on(top === 'insights')} href="#/insights">${icon('chart')}<span>Insights</span></a>
      <a${on(top === 'settings')} href="#/settings">${icon('gear')}<span>Settings</span></a>
    </nav>
    ${shell.projects.length ? `<div class="nav-label"><span>Projects</span><a href="#/new" title="New build" aria-label="New build">${icon('plus', 'sm')}</a></div>
    <nav class="nav" aria-label="Projects">${shell.projects.map((project) => {
      const last = project.lastBuild;
      const mark = last && (active(last) || last.status === 'failed') ? statusIcon(last.status) : '';
      const open = project.name === projectName;
      return `<a${on(open && where.page === 'project' && where.section === 'overview')} href="#/p/${esc(project.name)}">${avatar(project.name, 'sm')}<span>${esc(project.name)}</span>${mark}</a>
        ${open ? `<div class="sub">${Object.entries(SECTIONS).filter(([key]) => key !== 'overview').map(([key, [label, ic]]) => `<a${on(where.page === 'project' && where.section === key)} href="#/p/${esc(project.name)}/${key}">${icon(ic, 'sm')}<span>${label}</span></a>`).join('')}
          <a${on(where.page === 'new')} href="#/p/${esc(project.name)}/new">${icon('plus', 'sm')}<span>New build</span></a></div>` : ''}`;
    }).join('')}</nav>` : ''}
    <div class="nav-spacer"></div>
    ${machineCard()}`;
  tabs.innerHTML = [['builds', '#/', 'layers', 'Builds'], ['projects', '#/projects', 'apps', 'Projects'], ['insights', '#/insights', 'chart', 'Insights'], ['settings', '#/settings', 'gear', 'Settings']]
    .map(([key, href, ic, label]) => `<a${on(top === key)} href="${href}">${icon(ic)}${label}</a>`).join('');
}
function machineCard() {
  const system = shell.system;
  if (!system) return '';
  const { machine = {}, current } = system;
  const used = system.diskTotal ? 1 - system.diskFree / system.diskTotal : 0;
  return `<div class="machine">
    <div class="machine-head"><span class="led ${current ? 'busy' : 'idle'}"></span><span>${esc(machine.name || 'This Mac')}</span></div>
    <div class="spec">${esc([machine.chip, machine.macos && `macOS ${machine.macos}`].filter(Boolean).join(' · ') || 'Builds run here')}</div>
    ${current ? `<a class="now" href="#/build/${esc(current.id)}">${avatar(current.project, 'xs')}<span><b>Building ${esc(current.project)}</b> · <span class="num" data-since="${current.startedAt}">${span(Date.now() - current.startedAt)}</span></span></a>`
      : `<div class="now">${icon('check', 'sm ok')}<span>Idle${system.queued ? `, ${system.queued} queued` : ''}</span></div>`}
    <div class="meter"><div class="meter-label"><span>Disk</span><span>${gb(system.diskFree)} free</span></div><div class="bar ${used > 0.9 ? 'low' : ''}"><i style="width:${(used * 100).toFixed(1)}%"></i></div></div>
  </div>`;
}
function mobileTop() {
  const current = shell.system?.current;
  return `<div class="mtop"><a class="brand" href="#/"><span class="mark">${icon('cube')}</span>macbuild</a>
    ${current ? `<a class="pill" href="#/build/${esc(current.id)}"><span class="led busy"></span>Building ${esc(current.project)}</a>` : `<span class="pill"><span class="led idle"></span>${esc(machineName())}</span>`}</div>`;
}
async function loadShell() {
  try {
    const [projects, system] = await Promise.all([fetch('/api/projects').then((res) => res.json()), fetch('/api/system').then((res) => res.json())]);
    shell.projects = projects; shell.system = system;
    renderShell(parseRoute());
  } catch {}
}
setInterval(() => { if (!document.hidden) loadShell(); }, 15000);

// Shared pieces
const header = (title, lede, actions = '') => `<header class="head"><div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</header>`;
const card = (title, ic, body, more = '') => `<section class="card"><div class="card-head"><h2>${ic ? icon(ic) : ''}${title}</h2>${more}</div>${body}</section>`;
const more = (href, label) => `<a class="more" href="${href}">${label}${icon('right', 'sm')}</a>`;
const empty = (ic, title, note = '', action = '') => `<div class="empty">${icon(ic)}<strong>${title}</strong>${note ? `<p>${note}</p>` : ''}${action}</div>`;
const skeleton = (rows = 3) => `<div class="sk-rows">${Array.from({ length: rows }, (_, index) => `<span class="sk" style="width:${[72, 54, 64, 46][index % 4]}%"></span>`).join('')}</div>`;
const kv = (pairs, cls = 'kv') => `<dl class="${cls}">${pairs.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const COMMIT_LIVE = new Set(['preparing', 'queued', 'starting', 'running', 'waiting']);
const commitLive = (data) => COMMIT_LIVE.has(data.commitJob?.status);
function changesList(changes) {
  if (!changes?.length) return '';
  const shown = changes.slice(0, 12);
  return `<ul class="changes">${shown.map((item) => `<li><span class="xy">${esc(item.code)}</span><span class="path">${esc(item.path)}</span></li>`).join('')}${changes.length > 12 ? `<li class="faint">and ${changes.length - 12} more</li>` : ''}</ul>`;
}
function commitOffer(data, { github = false } = {}) {
  const dirty = data.changes?.length || data.dirty || 0;
  const ahead = data.ahead || 0;
  const live = commitLive(data);
  if (!live && !dirty && !ahead) return '';
  const note = live
    ? `<p class="hint">T3 is splitting commits${data.commitJob?.link ? ` · <a class="link" href="${esc(data.commitJob.link)}" target="_blank" rel="noreferrer">Open</a>` : ''}</p>`
    : dirty
      ? `<p class="hint warn">${github ? `${plural(dirty, 'local file')} not on GitHub` : plural(dirty, 'uncommitted file')}</p>`
      : `<p class="hint warn">${plural(ahead, 'unpushed commit')}</p>`;
  const button = live ? '' : `<div class="inline commit-actions"><button type="button" class="btn sm" data-commit>${dirty ? 'Split, commit, and push' : 'Push to GitHub'}</button></div>`;
  const error = data.commitJob?.error ? `<p class="hint bad">${esc(data.commitJob.error)}</p>` : '';
  return `${note}${changesList(data.changes)}${button}${error}`;
}
async function runCommit(name, data) {
  const result = await post(`/api/projects/${encodeURIComponent(name)}/commit`, { push: true });
  data.commitJob = result;
  if (result.error && !result.threadId) flash(result.error, true);
  return result;
}
function buildRow(build, { project = true } = {}) {
  return `<a class="row build" href="#/build/${esc(build.id)}">
    ${statusIcon(build.status)}
    <span class="main"><span class="title">${esc(subject(build))}</span><span class="meta">${project ? `<span>${avatar(build.project, 'xs')}${esc(build.project)}</span><span class="sep"></span>` : ''}<span class="trunc">${esc(refOf(build))}</span><span class="sep"></span><span class="mono">${esc(short(build) || 'local')}</span>${build.source === 'working' ? '<span class="tag">local</span>' : ''}</span></span>
    <span class="end">${platformTag(build)}${profileTag(build)}<span class="dur num">${esc(took(build))}</span><span class="when">${ago(build.createdAt)}</span></span>
  </a>`;
}
function dayGroups(builds, row = (build) => buildRow(build)) {
  const groups = [];
  for (const build of builds) {
    const label = dayLabel(build.createdAt);
    if (groups.at(-1)?.label !== label) groups.push({ label, builds: [] });
    groups.at(-1).builds.push(build);
  }
  return groups.map((group) => `<div class="group-label">${esc(group.label)}<span>${plural(group.builds.length, 'build')}</span></div><div class="card rows day-list">${group.builds.map(row).join('')}</div>`).join('');
}
function strip(builds, slots = 16) {
  const recent = builds.slice(0, slots).reverse();
  return `<div class="strip" role="img" aria-label="Last ${recent.length} builds">${'<i></i>'.repeat(slots - recent.length)}${recent.map((build) => `<i class="${build.status}" data-tip="${esc(STATUS[build.status][0])}" data-sub="${esc(`${subject(build)} · ${ago(build.createdAt)}`)}"></i>`).join('')}</div>`;
}
// Progress for a running build: elapsed time against this project's usual build time. The ticker keeps it moving.
function progress(build) {
  const phase = build.phases?.at(-1)?.name;
  return `<div class="label"><span><b class="phase-name">${esc(build.status === 'cancelling' ? 'Cancelling' : phase ? phaseName(phase) : 'Starting')}</b> · <span class="num" data-since="${build.startedAt}">${span(Date.now() - build.startedAt)}</span></span><span data-left="${build.startedAt}|${build.estimate ?? ''}"></span></div>
    <div class="progress ${build.estimate ? '' : 'unknown'}" data-start="${build.startedAt}" data-estimate="${build.estimate ?? ''}"><i></i></div>`;
}
function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-since]').forEach((node) => { node.textContent = span(now - Number(node.dataset.since)); });
  document.querySelectorAll('[data-left]').forEach((node) => {
    const [start, estimate] = node.dataset.left.split('|').map(Number);
    if (!estimate) { node.textContent = 'first build like this'; return; }
    const left = estimate - (now - start);
    node.textContent = left > 45000 ? `about ${span(left, true)} left` : left > -60000 ? 'almost done' : 'longer than usual';
  });
  document.querySelectorAll('.progress[data-estimate]').forEach((node) => {
    const estimate = Number(node.dataset.estimate);
    if (estimate) node.firstElementChild.style.width = `${Math.min(96, ((now - Number(node.dataset.start)) / estimate) * 100).toFixed(1)}%`;
  });
}
setInterval(tick, 1000);
// The running build and the queue behind it, re-rendered only when that work changes so the bar keeps animating.
function liveCard(builds) {
  const running = builds.find((build) => ['running', 'cancelling'].includes(build.status));
  const queued = builds.filter((build) => build.status === 'queued').reverse();
  if (!running && !queued.length) return '';
  const kind = (build) => `${build.platform === 'android' ? 'Android · ' : ''}${kindOf(build)}`;
  return `<section class="card live">
    <div class="live-head"><span class="led busy"></span><b>${running ? 'Building now' : 'Up next'}</b></div>
    ${running ? `<a class="live-main" href="#/build/${esc(running.id)}">
      <span class="who">${avatar(running.project, 'lg')}<div><span class="title">${esc(subject(running))}</span><span class="meta">${esc(running.project)}<span class="sep"></span>${esc(refOf(running))}<span class="sep"></span><span class="mono">${esc(short(running))}</span><span class="sep"></span>${esc(kind(running))}</span></div></span>
      <span class="live-progress">${progress(running)}</span></a>` : ''}
    ${queued.map((build) => `<a class="next" href="#/build/${esc(build.id)}">${icon('clock', 'sm')}<span class="title">${esc(subject(build))}</span><span class="sep"></span><span>${esc(build.project)} · ${esc(refOf(build))} · ${esc(kind(build))}</span></a>`).join('')}
  </section>`;
}
function updateLive(box, builds) {
  if (!box) return;
  const key = builds.filter(active).map((build) => `${build.id}:${build.status}`).join(',');
  if (box.dataset.key === key) {
    const running = builds.find((build) => build.status === 'running');
    const label = box.querySelector('.phase-name');
    if (running && label && running.phases?.length) label.textContent = phaseName(running.phases.at(-1).name);
    return;
  }
  box.dataset.key = key;
  const html = liveCard(builds);
  box.innerHTML = html;
  box.style.marginBottom = html ? '24px' : '';
  tick();
}

// Charts: one column per item, optionally stacked by status. Every value is on the page too, so tooltips never hide data.
function columns(items, { format, axis, height = 170, median: line, width = 600 } = {}) {
  const left = 34; const bottom = 22; const top = 10; const plot = height - bottom - top;
  const totals = items.map((item) => item.parts.reduce((sum, part) => sum + part.value, 0));
  const max = Math.max(...totals, line ?? 0, 0);
  const step = axis(max); const ceiling = Math.max(2 * step * Math.ceil(max / (2 * step)), 2 * step);
  const y = (value) => top + plot - (value / ceiling) * plot;
  const band = (width - left) / Math.max(items.length, 1); const bar = Math.max(3, Math.min(22, band * 0.6));
  const grid = [0, ceiling / 2, ceiling].map((value) => `<line class="${value ? 'grid' : 'base'}" x1="${left}" x2="${width}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 8}" y="${y(value) + 3.5}" text-anchor="end">${esc(format(value, true))}</text>`).join('');
  const marks = items.map((item, index) => {
    const x = left + index * band + (band - bar) / 2;
    let base = 0;
    const shapes = item.parts.filter((part) => part.value > 0).map((part, partIndex, parts) => {
      const y0 = y(base); base += part.value;
      const h = Math.max(1.5, y0 - y(base)); const r = partIndex === parts.length - 1 ? Math.min(3, h, bar / 2) : 0;
      return `<path class="bar ${part.cls ?? ''}" d="M${x} ${y0}V${y0 - h + r}${r ? `Q${x} ${y0 - h} ${x + r} ${y0 - h}H${x + bar - r}Q${x + bar} ${y0 - h} ${x + bar} ${y0 - h + r}` : `H${x + bar}`}V${y0}Z"/>`;
    }).join('');
    return `<g class="c">${shapes}<rect class="hit" tabindex="0" x="${left + index * band}" y="0" width="${band}" height="${height - bottom}" data-tip="${esc(item.tip)}" data-sub="${esc(item.label)}" aria-label="${esc(`${item.label}: ${item.tip}`)}"/></g>`;
  }).join('');
  const stride = Math.ceil(items.length / Math.max(3, Math.floor(width / 80)));
  const ticks = items.map((item, index) => (index % stride === 0 ? `<text x="${left + index * band + band / 2}" y="${height - 6}" text-anchor="middle">${esc(item.tick)}</text>` : '')).join('');
  const medianLine = line ? `<line class="median" x1="${left}" x2="${width}" y1="${y(line)}" y2="${y(line)}"/>` : '';
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${grid}${marks}${medianLine}${ticks}</svg>`;
}
const stepFor = (max) => [1, 2, 5, 10, 20, 50, 100].find((step) => max / step <= 3) ?? 200;
const minutes = (value, axis) => (axis ? `${Math.round(value)}m` : span(value * 60000));

// Pages ----------------------------------------------------------------------------------------------------------------

const prefs = { filter: 'all', query: '', scope: 'all', projectFilter: 'all' };
const FILTERS = { all: 'All', active: 'Active', failed: 'Failed', testflight: 'TestFlight', dev: 'Development' };
const matches = (filter) => (build) => filter === 'all' || (filter === 'active' && active(build)) || (filter === 'failed' && build.status === 'failed')
  || (filter === 'testflight' && submits(build)) || (filter === 'dev' && !store(build)) || (filter === 'store' && store(build));

async function buildsPage() {
  let { builds } = await get('/api/builds');
  app.innerHTML = `${mobileTop()}
    ${header('Builds', '', `<a class="btn primary" href="#/new">${icon('plus')}New build</a>`)}
    <div id="install"></div><div id="setup-banner"></div><div id="live"></div>
    <div class="toolbar"><label class="search">${icon('search')}<input id="q" type="search" placeholder="Search commits, branches, people" aria-label="Search builds" value="${esc(prefs.query)}"></label>
      <div class="seg" role="group" aria-label="Show">${Object.entries(FILTERS).map(([key, label]) => `<button data-filter="${key}" class="${prefs.filter === key ? 'on' : ''}" aria-pressed="${prefs.filter === key}">${key === 'testflight' && builds.some((build) => build.platform === 'android') ? 'Store uploads' : label}</button>`).join('')}</div></div>
    <div id="list"></div>`;
  const draw = () => {
    updateLive($('#live'), builds);
    const words = prefs.query.trim().toLowerCase();
    const shown = builds.filter(matches(prefs.filter)).filter((build) => !words || `${build.project} ${refOf(build)} ${short(build)} ${subject(build)} ${build.commit?.author ?? ''} ${build.profile}`.toLowerCase().includes(words));
    $('#list').innerHTML = shown.length ? dayGroups(shown)
      : `<div class="card">${builds.length ? empty('search', 'No matching builds') : empty('layers', 'No builds yet', '', `<a class="btn primary" href="#/new">${icon('plus')}New build</a>`)}</div>`;
  };
  draw();
  get('/api/setup').then(setupBanner).catch(() => {});
  $('#q').oninput = (event) => { prefs.query = event.target.value; draw(); };
  app.onclick = (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    prefs.filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => { item.classList.toggle('on', item === button); item.setAttribute('aria-pressed', item === button); });
    draw();
  };
  installHint();
  every(() => (builds.some(active) ? 2500 : 15000), async () => { ({ builds } = await get('/api/builds')); draw(); });
}

async function buildPage(id) {
  let logFrom = 0; const groups = []; let shownKey = '';
  let { build, lines, next } = await get(`/api/builds/${id}/log?from=0`);
  app.innerHTML = `
    <nav class="crumbs"><a href="#/">Builds</a><span class="slash">/</span><a href="#/p/${esc(build.project)}">${avatar(build.project, 'xs')}${esc(build.project)}</a><span class="slash">/</span><span class="mono">${esc(short(build) || build.id)}</span></nav>
    <div id="b-head"></div><div id="b-alert"></div><div id="b-top"></div>
    <section class="section"><div class="section-head"><h2>Logs</h2><div class="log-tools"><button class="btn ghost sm" data-expand>Expand all</button><a class="btn sm" href="/api/builds/${esc(id)}/log.txt">${icon('download')}Download</a></div></div>
      <div class="card phases" id="phases"></div></section>`;
  const ingest = (incoming) => {
    for (const line of incoming) {
      const match = line.match(/^\[([A-Z][A-Z_]{3,})\]\s?(.*)$/);
      const name = match ? match[1] : /Scheduling iOS submission|Submitting your app/.test(line) ? 'SUBMIT' : groups.at(-1)?.name ?? 'SETUP';
      let group = groups.find((item) => item.name === name);
      if (!group) { group = { name, lines: [] }; groups.push(group); }
      group.lines.push(match ? match[2] : line);
    }
  };
  const draw = () => {
    const key = `${build.status}|${build.phases?.length ?? 0}|${build.finishedAt ?? ''}|${build.ipaBytes ?? ''}`;
    if (key !== shownKey) {
      shownKey = key;
      $('#b-head').innerHTML = buildHead(build);
      $('#b-alert').innerHTML = buildAlert(build);
      $('#b-top').innerHTML = buildTop(build);
      loadChecks(build);
      tick();
    }
    renderPhases($('#phases'), build, groups);
  };
  ingest(lines); logFrom = next; draw();
  app.onclick = (event) => {
    const expand = event.target.closest('[data-expand]');
    if (expand) {
      const open = [...document.querySelectorAll('.phase')].some((node) => !node.open);
      document.querySelectorAll('.phase').forEach((node) => { node.open = open; });
      expand.textContent = open ? 'Collapse all' : 'Expand all';
    }
    if (event.target.closest('[data-show-failure]')) {
      const failed = $('.phase.failed') ?? $('.phase:last-child');
      if (failed) { failed.open = true; failed.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }
  };
  every(1500, async () => {
    if (!active(build) && build.installed?.status !== 'installing') return 'stop';
    ({ build, lines, next } = await get(`/api/builds/${id}/log?from=${logFrom}`));
    ingest(lines); logFrom = next; draw();
    return active(build) || build.installed?.status === 'installing' ? undefined : 'stop';
  });
}
const installUrl = (build) => `itms-services://?action=download-manifest&url=${encodeURIComponent(`${location.origin}/ota/${build.id}/manifest.plist`)}`;
function installNote(build) {
  const installed = build.installed;
  if (!installed) return '';
  if (installed.status === 'installing') return `<p>Putting it on ${esc(installed.name || 'the iPhone')}…</p>`;
  if (installed.error) return `<p class="hint bad">${esc(installed.error)}</p>`;
  return `<p class="hint ok">On ${esc(installed.name)}</p>`;
}
function buildHead(build) {
  const file = hasFile(build);
  const apk = build.platform === 'android' && build.installable;
  const primary = !file ? '' : build.simulator ? `<button class="btn primary" data-simulator="${esc(build.id)}">${icon('phone')}Open in Simulator</button>`
    : apk ? `<a class="btn primary" href="/api/builds/${esc(build.id)}/artifact">${icon('download')}Install APK</a>`
    : build.installable ? `<a class="btn primary" href="${installUrl(build)}">${icon('phone')}Install</a>` : '';
  const actions = [
    primary,
    build.reusedFrom ? `<a class="btn primary" href="#/build/${esc(build.reusedFrom)}">${icon('right')}Open the reused build</a>` : '',
    file && !apk ? `<a class="btn" href="/api/builds/${esc(build.id)}/artifact">${icon('download')}${fileKind(build)}</a>` : '',
    active(build) ? `<button class="btn danger" data-cancel="${esc(build.id)}" ${build.status === 'cancelling' ? 'disabled' : ''}>${icon('ban')}Cancel</button>` : `<button class="btn" data-rebuild="${esc(build.id)}">${icon('rebuild')}Rebuild</button>`,
  ].join('');
  const person = build.by?.name ?? build.commit?.author;
  return `<header class="head"><div class="bhead">${avatar(build.project, 'lg')}<div><h1>${esc(subject(build))}</h1>
    <div class="facts">${badge(build.status)}${platformTag(build)}${profileTag(build)}${took(build) ? `<span>${icon('timer', 'sm')}${esc(took(build))}</span>` : ''}<span>${icon('clock', 'sm')}${ago(build.createdAt)}</span>${person ? `<span>${icon('user', 'sm')}${esc(person)}</span>` : ''}</div></div></div>
    <div class="actions">${actions}</div></header>`;
}
function buildAlert(build) {
  if (['running', 'cancelling'].includes(build.status)) {
    return `<section class="card live" style="margin-bottom:20px"><div class="live-head"><span class="led busy"></span><b>${build.status === 'cancelling' ? 'Cancelling' : 'Building'}</b></div>
      <div class="live-main"><div class="live-progress">${progress(build)}</div></div></section>`;
  }
  if (build.status === 'queued') return `<div class="callout info" style="margin-bottom:20px">${icon('clock')}<div><b>Waiting</b></div></div>`;
  if (build.status === 'failed') {
    const phase = build.phases?.at(-1)?.name;
    return `<div class="callout" style="margin-bottom:20px">${icon('alert')}<div><b>Failed${phase ? ` during ${esc(phaseName(phase).toLowerCase())}` : ''}</b>
      ${build.hint ? `<p class="fix"><strong>Likely cause: ${esc(build.hint.title)}.</strong> ${fixHtml(build.hint.fix)}</p>` : ''}
      ${build.reason ? `<code>${esc(build.reason)}</code>` : ''}<button class="btn sm" data-show-failure>Show the log</button></div></div>`;
  }
  if (build.status === 'skipped') {
    return `<div class="callout info" style="margin-bottom:20px">${icon('skip')}<div><b>Reused an earlier build</b>${build.reusedFrom ? `<span class="muted"><a class="link" href="#/build/${esc(build.reusedFrom)}">Open it</a></span>` : ''}</div></div>`;
  }
  if (build.submission) return `<div class="callout info" style="margin-bottom:20px">${icon('send')}<div><b>Uploaded to ${build.platform === 'android' ? 'Google Play' : 'App Store Connect'}</b> <a class="link" href="${esc(build.submission)}">View</a></div></div>`;
  return '';
}
function sizeChange(build) {
  if (!build.sizeBefore || !build.ipaBytes) return '';
  const change = build.ipaBytes - build.sizeBefore;
  if (Math.abs(change) < 52429) return ' <span class="faint">· same as before</span>';
  const percent = (change / build.sizeBefore) * 100;
  return ` <span class="${percent > 5 ? 'warn' : 'faint'}" title="Compared with the previous ${esc(build.profile)} build">· ${change > 0 ? '+' : '−'}${mb(Math.abs(change))}</span>`;
}
function buildTop(build) {
  const commit = build.commit;
  const file = hasFile(build);
  const days = build.signing?.expires ? Math.round((new Date(build.signing.expires) - Date.now()) / DAY) : null;
  // One even grid, the way EAS lays out a build's details: what was built, from where, and when.
  const details = `<section class="card details"><div class="card-head"><h2>${icon('layers')}Details</h2>${build.app ? `<span class="faint mono">${esc(build.app.id)}</span>` : ''}</div><div class="card-body">${kv([
    ['Platform', platformName(build)], ['Profile', esc(build.profile)], ['Distribution', build.distribution === 'store' ? 'Store' : 'Internal'],
    ['Version', build.app ? `${esc(build.app.version)} <span class="faint">(${esc(build.app.number)})</span>` : ''],
    ['Branch', `${esc(refOf(build))}${build.source === 'working' ? ' <span class="tag">local</span>' : ''}`],
    ['Commit', commit?.url ? `<a class="link mono" href="${esc(commit.url)}">${esc(commit.short)}</a>` : `<span class="mono">${esc(short(build) || '—')}</span>`],
    ['Pull request', build.pr ? `<a class="link" href="${esc(build.pr.url)}">#${esc(build.pr.number)}</a> <span class="faint">${esc(build.pr.title ?? '')}</span>` : ''],
    ['Checks', build.repo && commit?.hash ? '<span id="checks" class="faint">Loading…</span>' : ''],
    ['Started by', triggerOf(build)], ['Created', when(build.createdAt)],
    ['Waited', build.startedAt ? span(build.startedAt - build.createdAt) : ''], ['Took', active(build) && build.startedAt ? `<span class="num" data-since="${build.startedAt}"></span>` : esc(took(build))],
    ['Size', build.ipaBytes && !build.expired ? `${mb(build.ipaBytes)}${sizeChange(build)}` : build.expired ? '<span class="faint">Removed to save space</span>' : ''],
    ['Channel', esc(build.channel)], ['Runtime', build.runtime && !build.runtime.startsWith('file:') ? `<span class="mono">${esc(build.runtime.slice(0, 12))}</span>` : ''],
    ['Native fingerprint', build.fingerprint ? `<span class="mono" title="${esc(build.fingerprint)}">${esc(build.fingerprint.slice(0, 12))}</span>` : ''],
    ['Signing expires', days !== null ? `<span class="${days < 30 ? 'warn' : ''}">${day(build.signing.expires)} · ${days}d</span>` : ''],
    ['Uncommitted', build.dirty ? `<span class="warn">${plural(build.dirty, 'file')} included</span>` : ''],
  ], 'kv wide')}</div></section>`;
  const qr = `<img src="/api/builds/${esc(build.id)}/qr.svg" alt="QR code"><p class="qr-note">Scan to open on a phone</p>`;
  let aside = '';
  if (!file) aside = '';
  else if (build.simulator) {
    aside = card('Simulator', 'phone', `<div class="install">
      <button class="btn primary block" data-simulator="${esc(build.id)}">${icon('phone')}Open in Simulator</button><a class="btn block" href="/api/builds/${esc(build.id)}/artifact">${icon('download')}Download</a></div>`);
  } else if (build.platform === 'android' && build.installable) {
    aside = card('Install', 'phone', `<div class="install">${qr}<a class="btn primary block" href="/api/builds/${esc(build.id)}/artifact">${icon('download')}Download APK</a></div>`);
  } else if (build.installable) {
    aside = card('Install', 'phone', `<div class="install">${qr}<a class="btn primary block" href="${installUrl(build)}">${icon('phone')}Install on iPhone</a>
      <button class="btn block" data-install="${esc(build.id)}" ${build.installed?.status === 'installing' ? 'disabled' : ''}>${icon('mac')}${build.installed?.status === 'installing' ? 'Installing…' : 'Install from this Mac'}</button>
      ${installNote(build)}</div>`);
  } else {
    aside = card(storeName(build.platform), 'send', `<div class="install"><a class="btn block" href="/api/builds/${esc(build.id)}/artifact">${icon('download')}Download ${fileKind(build)}</a></div>`);
  }
  return aside ? `<div class="cols main-side">${details}<div class="stack">${aside}</div></div>` : details;
}
function loadChecks(build) {
  if (!build.repo || !build.commit?.hash) return;
  get(`/api/builds/${build.id}/github`).then((data) => {
    const box = $('#checks');
    if (!box) return;
    if (!data?.total) { box.textContent = 'None'; return; }
    box.className = '';
    box.innerHTML = `<a class="link" href="${esc(data.url)}">${data.failed ? `<span class="bad">${data.failed} failing</span>` : data.pending ? `${data.pending} running` : `<span class="ok">${data.total} passed</span>`}</a>`;
  }).catch(() => {});
}
// One row per phase on a shared timeline. Rows update in place, so open phases and scroll positions survive polls.
function renderPhases(box, build, groups) {
  if (!groups.length) {
    box.innerHTML = empty(active(build) ? 'spinner' : 'layers', active(build) ? 'Waiting for logs' : 'No log');
    return;
  }
  if (box.querySelector('.empty')) box.innerHTML = '';
  const times = build.phases ?? [];
  const start = build.startedAt ?? times[0]?.at ?? Date.now();
  const end = build.finishedAt ?? Date.now();
  const total = Math.max(1, end - start);
  groups.forEach((group, index) => {
    let node = box.children[index];
    if (!node) {
      node = document.createElement('details');
      node.innerHTML = `<summary><span class="st"></span><span class="name"></span><span class="lane"><i></i></span><span class="time"></span>${icon('right', 'chev')}</summary><pre class="log"></pre>`;
      box.append(node);
    }
    const last = index === groups.length - 1;
    const state = last && active(build) ? 'running' : last && build.status === 'failed' ? 'failed' : last && build.status === 'cancelled' ? 'cancelled' : 'success';
    node.className = `phase ${state}`;
    node.querySelector('.st').className = `st ${state}`;
    node.querySelector('.st').innerHTML = icon(STATUS[state][1]);
    node.querySelector('.name').textContent = phaseName(group.name);
    const position = times.findIndex((item) => item.name === group.name);
    const from = position >= 0 ? times[position].at : null;
    const to = times[position + 1]?.at ?? (last ? end : null);
    node.querySelector('.time').textContent = from && to ? span(to - from) : '';
    const lane = node.querySelector('.lane i');
    lane.style.display = from && to ? '' : 'none';
    if (from && to) { lane.style.left = `${((from - start) / total) * 100}%`; lane.style.width = `${Math.max(0.4, ((to - from) / total) * 100)}%`; }
    const pre = node.querySelector('pre');
    if (pre.dataset.count !== String(group.lines.length)) {
      const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      const fragment = document.createDocumentFragment();
      for (const text of group.lines.slice(-1000)) {
        const line = document.createElement('span');
        line.textContent = text || ' ';
        if (/❌|error[:\s]|failed|ERR!/i.test(text)) line.className = 'e';
        else if (/SUCCEEDED|successful|✔|passed/i.test(text)) line.className = 's';
        else if (/^▸/.test(text)) line.className = 'd';
        fragment.append(line);
      }
      pre.replaceChildren(fragment);
      pre.dataset.count = group.lines.length;
      if (stick) pre.scrollTop = pre.scrollHeight;
    }
    if ((state === 'failed' || state === 'running') && !node.dataset.opened) { node.open = true; node.dataset.opened = '1'; pre.scrollTop = pre.scrollHeight; }
  });
}

async function projectsPage() {
  const { projects, builds } = await get('/api/state');
  app.innerHTML = `${mobileTop()}${header('Projects', '', `<a class="btn primary" href="#/new">${icon('plus')}New build</a>`)}
    <div class="pgrid">${projects.map((project) => {
      const mine = builds.filter((build) => build.project === project.name);
      const last = mine[0]; const release = mine.find((build) => build.app)?.app;
      return `<a class="card pcard" href="#/p/${esc(project.name)}">
        <div class="pcard-top">${avatar(project.name, 'lg')}<div><b>${esc(project.name)}</b><small>${esc(project.repo || 'Local repository')}</small></div>${last ? badge(last.status) : ''}</div>
        <div>${strip(mine)}<div class="strip-label"><span>${mine.length ? `Last ${Math.min(16, mine.length)} builds` : 'No builds yet'}</span><span>${last ? `Built ${ago(last.createdAt)}` : ''}</span></div></div>
        ${kv([['Version', release ? `${esc(release.version)} <span class="faint">(${esc(release.number)})</span>` : '<span class="faint">—</span>'], ['Working copy', `${esc(project.branch || 'detached')}${project.dirty ? ` <span class="warn">· ${project.dirty} changed</span>` : ''}`]])}
      </a>`;
    }).join('')}
    <div class="card pcard add">${icon('plus')}<b>Add a project</b><p><code>macbuild add &lt;name&gt; &lt;path&gt;</code> or <code>macbuild scan</code></p></div></div>`;
}

async function pickPage() {
  const { projects, builds } = await get('/api/state');
  if (projects.length === 1) { location.replace(`#/p/${projects[0].name}/new`); return; }
  app.innerHTML = `<nav class="crumbs"><a href="#/">Builds</a><span class="slash">/</span><span>New build</span></nav>
    ${header('New build')}
    <div class="card rows">${projects.map((project) => {
      const last = builds.find((build) => build.project === project.name);
      return `<a class="row" href="#/p/${esc(project.name)}/new">${avatar(project.name, 'lg')}<span class="main"><span class="title">${esc(project.name)}</span><span class="meta">${esc(project.repo || 'Local repository')}<span class="sep"></span>${last ? `last built ${ago(last.createdAt)}` : 'never built'}</span></span>${icon('right', 'chev')}</a>`;
    }).join('') || empty('apps', 'No projects yet', '<code>macbuild scan</code>')}</div>`;
}

// Project pages share a header and, on a phone, a row of section tabs.
async function projectPage({ name, section }) {
  const data = await get(`/api/projects/${encodeURIComponent(name)}`);
  const release = data.builds.find((build) => build.app)?.app;
  const latestDev = data.builds.find((build) => build.status === 'success' && build.installable && build.ipaBytes && !build.expired);
  const crumbs = `<nav class="crumbs"><a href="#/projects">Projects</a><span class="slash">/</span>${section === 'overview' ? `<span>${esc(name)}</span>` : `<a href="#/p/${esc(name)}">${avatar(name, 'xs')}${esc(name)}</a><span class="slash">/</span><span>${SECTIONS[section][0]}</span>`}</nav>`;
  const head = section === 'overview'
    ? `<header class="head"><div class="phead">${avatar(name, 'xl')}<div><h1>${esc(name)}</h1><div class="facts">
        ${data.repo ? `<a href="https://github.com/${esc(data.repo)}">${icon('github', 'sm')}${esc(data.repo)}</a>` : `<span>${icon('branch', 'sm')}Local repository</span>`}
        ${release ? `<span class="mono">${esc(release.id)}</span><span>${icon('tag', 'sm')}${esc(release.version)} (${esc(release.number)})</span>` : ''}</div></div></div>
        <div class="actions">${latestDev ? `<a class="btn" href="#/build/${esc(latestDev.id)}">${icon('phone')}Install latest</a>` : ''}<a class="btn primary" href="#/p/${esc(name)}/new">${icon('plus')}New build</a></div></header>`
    : header(SECTIONS[section][0], '', `<a class="btn primary" href="#/p/${esc(name)}/new">${icon('plus')}New build</a>`);
  const ptabs = `<nav class="ptabs" aria-label="Project sections">${Object.entries(SECTIONS).map(([key, [label]]) => `<a${key === section ? ' class="on" aria-current="page"' : ''} href="#/p/${esc(name)}${key === 'overview' ? '' : `/${key}`}">${label}</a>`).join('')}</nav>`;
  app.innerHTML = `${crumbs}${head}${ptabs}<div id="pbody"></div>`;
  await PROJECT_SECTIONS[section](data, $('#pbody'));
  if (data.refreshing) every(2500, async () => { const fresh = await get(`/api/projects/${encodeURIComponent(name)}`); if (!fresh.refreshing) { route(); return 'stop'; } return undefined; });
}

function withExpo(name, box, render) {
  expoOf(name).then((expo) => { if (box.isConnected) box.innerHTML = render(expo); })
    .catch((error) => { if (box.isConnected && error.name !== 'AbortError') box.innerHTML = empty('cloudoff', 'Expo didn’t answer'); });
}
const EXPO_STATUS = { FINISHED: 'success', ERRORED: 'failed', CANCELED: 'cancelled', CANCELLED: 'cancelled', IN_PROGRESS: 'running', IN_QUEUE: 'queued', NEW: 'queued' };
const expoIcon = (value) => statusIcon(EXPO_STATUS[value] ?? 'running');
const expiryOf = (signing) => (signing?.expires ? Math.round((new Date(signing.expires) - Date.now()) / DAY) : null);

const PROJECT_SECTIONS = {
  async overview(data, box) {
    const name = data.name;
    const week = data.builds.filter((build) => Date.now() - build.createdAt < 7 * DAY).length;
    const dev = data.builds.find((build) => !store(build) && !active(build)); const prod = data.builds.find((build) => store(build) && !active(build));
    const latestRow = (build, label) => (build ? `<a class="row" href="#/build/${esc(build.id)}"><span class="kind">${label}</span>${statusIcon(build.status)}<span class="main"><span class="title">${esc(subject(build))}</span><span class="meta"><span class="trunc">${esc(refOf(build))}</span><span class="sep"></span><span class="mono">${esc(short(build))}</span>${build.app ? `<span class="sep"></span><span>${esc(build.app.version)} (${esc(build.app.number)})</span>` : ''}</span></span><span class="end">${profileTag(build)}<span class="when">${ago(build.createdAt)}</span></span></a>`
      : `<div class="row"><span class="kind">${label}</span><span class="main faint">No ${label.toLowerCase()} builds yet</span></div>`);
    const expiry = (signing) => {
      const left = expiryOf(signing);
      return left === null ? '<span class="faint">No build yet</span>' : `<span class="${left < 30 ? 'warn' : ''}">${day(signing.expires)} · ${left}d</span>`;
    };
    box.innerHTML = `<div id="plive"></div>
      <div class="cols main-side">
        <div class="stack">
          ${card('Latest builds', 'layers', `<div class="rows latest">${latestRow(dev, 'Development')}${latestRow(prod, 'Production')}</div>`, more(`#/p/${esc(name)}/builds`, 'All builds'))}
          ${card('Recent activity', 'clock', data.builds.length ? `<div class="rows">${data.builds.slice(0, 6).map((build) => buildRow(build, { project: false })).join('')}</div>` : empty('layers', 'No builds yet', '', `<a class="btn primary" href="#/p/${esc(name)}/new">${icon('plus')}New build</a>`), more(`#/p/${esc(name)}/builds`, 'View all'))}
          ${card('Branches', 'branch', `<div class="rows">${data.branches.slice(0, 4).map((branch) => branchRow(name, branch, data)).join('') || empty('branch', 'No branches')}</div>`, more(`#/p/${esc(name)}/branches`, 'All branches'))}
        </div>
        <div class="stack">
          ${card('Health', 'chart', `<div class="card-body">${strip(data.builds)}<div class="strip-label"><span>Last ${Math.min(16, data.builds.length)}</span></div></div>
            <dl class="stats3" style="border-top:1px solid var(--line)"><div><dt>Passed</dt><dd>${data.stats.total ? `${Math.round((data.stats.passed / data.stats.total) * 100)}<small>%</small>` : '—'}</dd></div><div><dt>Typical</dt><dd>${data.stats.median ? `${Math.round(data.stats.median / 60000)}<small>min</small>` : '—'}</dd></div><div><dt>This week</dt><dd>${week}</dd></div></dl>`)}
          ${card('Signing', 'shield', kv([['Development profile', expiry(data.signing)], ['Devices', data.signing ? String(data.signing.devices) : '<span class="faint">—</span>'], ['App Store profile', expiry(data.storeSigning)]], 'list-kv'), more(`#/p/${esc(name)}/signing`, 'Details'))}
          ${card('Working copy', 'mac', `${kv([['Branch', esc(data.branch || 'detached')], ['Commit', `<span class="mono">${esc(data.commit)}</span>`], ['Changes', data.dirty ? `<span class="warn">${plural(data.dirty, 'file')}</span>` : 'Clean'], ['GitHub', data.behind ? `<span class="warn">${data.behind} behind</span>` : data.ahead ? `<span class="warn">${data.ahead} ahead</span>` : 'Up to date']], 'list-kv')}${data.dirty || data.ahead || commitLive(data) ? `<div class="card-body commit-box">${commitOffer(data)}</div>` : ''}`)}
          ${card('Automatic builds', 'bolt', data.triggers.length ? `<div class="rows">${data.triggers.map((rule) => `<a class="row compact" href="#/p/${esc(name)}/automation">${icon(rule.on === 'pr' ? 'pr' : rule.on === 'nightly' ? 'clock' : 'branch', 'sm faint')}<span class="main"><span class="title">${ruleTitle(rule)}</span><span class="meta">${ruleDetail(rule)}</span></span><span class="led ${rule.error ? '' : 'idle'}"></span></a>`).join('')}</div>`
            : '<div class="card-body muted">Off</div>', more(`#/p/${esc(name)}/automation`, 'Manage'))}
          ${card('Releases', 'send', `<div id="releases">${skeleton(3)}</div>`, more(`#/p/${esc(name)}/submissions`, 'Submissions'))}
        </div>
      </div>`;
    updateLive($('#plive'), data.builds);
    app.onclick = async (event) => {
      if (!event.target.closest('[data-commit]')) return;
      await runCommit(name, data);
      route();
    };
    if (commitLive(data)) every(2500, async () => { const fresh = await get(`/api/projects/${encodeURIComponent(name)}`); if (!commitLive(fresh)) { route(); return 'stop'; } return undefined; });
    withExpo(name, $('#releases'), (expo) => {
      const last = expo.submissions[0];
      return kv([
        ['Last submission', last ? `<span style="display:inline-flex;gap:6px;align-items:center">${expoIcon(last.status)}${ago(new Date(last.createdAt).getTime())}</span>` : '<span class="faint">None yet</span>'],
        ['Channels', String(expo.channels.length)],
        ['Expo project', expo.url ? `<a class="link" href="${esc(expo.url)}">Open on expo.dev</a>` : '—'],
      ], 'list-kv');
    });
    if (data.builds.some(active)) every(2500, async () => { const fresh = await get(`/api/projects/${encodeURIComponent(name)}`); updateLive($('#plive'), fresh.builds); if (!fresh.builds.some(active)) { route(); return 'stop'; } return undefined; });
  },
  async builds(data, box) {
    const name = data.name;
    const views = { all: 'All', dev: 'Development', store: 'Production', failed: 'Failed' };
    const draw = () => {
      const shown = data.builds.filter(matches(prefs.projectFilter));
      $('#plist').innerHTML = shown.length ? dayGroups(shown, (build) => buildRow(build, { project: false })) : `<div class="card">${empty('layers', 'Nothing here yet')}</div>`;
    };
    box.innerHTML = `<div id="plive"></div><div class="toolbar"><div class="seg" role="group" aria-label="Show">${Object.entries(views).map(([key, label]) => `<button data-view="${key}" class="${prefs.projectFilter === key ? 'on' : ''}">${label}<span class="count">${data.builds.filter(matches(key)).length}</span></button>`).join('')}</div></div>
      <div id="plist"></div>
      <div class="section"><div class="section-head"><h2>Cloud builds</h2></div><div class="card" id="cloud">${skeleton(2)}</div></div>`;
    updateLive($('#plive'), data.builds);
    draw();
    app.onclick = (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      prefs.projectFilter = button.dataset.view;
      document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('on', item === button));
      draw();
    };
    withExpo(name, $('#cloud'), (expo) => (expo.cloud.length ? `<div class="rows">${expo.cloud.slice(0, 8).map((item) => `<div class="row compact">${expoIcon(item.status)}<span class="main"><span class="title">${esc(item.profile)}${item.platform === 'android' ? ' <span class="tag">Android</span>' : ''}</span><span class="meta">${esc(item.version ?? '')} (${esc(item.number ?? '')})</span></span><span class="end"><span class="when">${ago(new Date(item.createdAt).getTime())}</span></span></div>`).join('')}</div>`
      : empty('cloudoff', 'No cloud builds')));
    if (data.builds.some(active)) every(3000, async () => { const fresh = await get(`/api/projects/${encodeURIComponent(name)}`); data.builds = fresh.builds; updateLive($('#plive'), fresh.builds); draw(); });
  },
  async branches(data, box) {
    box.innerHTML = `<div class="card rows">${data.branches.map((branch) => branchRow(data.name, branch, data, true)).join('') || empty('branch', 'No branches')}</div>
      ${data.refreshing ? '<p class="hint">Checking GitHub for new branches…</p>' : ''}`;
  },
  async submissions(data, box) {
    const uploads = data.builds.filter(submits);
    box.innerHTML = `<div class="cols two">
      ${card('Store submissions', 'send', `<div id="subs">${skeleton(3)}</div>`)}
      ${card('Uploads from this Mac', 'mac', uploads.length ? `<div class="rows">${uploads.slice(0, 10).map((build) => buildRow(build, { project: false })).join('')}</div>` : empty('send', 'No uploads yet'))}
    </div>`;
    withExpo(data.name, $('#subs'), (expo) => (expo.submissions.length ? `<div class="rows">${expo.submissions.map((item) => `<div class="row">${expoIcon(item.status)}<span class="main"><span class="title">${esc(item.status.charAt(0) + item.status.slice(1).toLowerCase().replace(/_/g, ' '))}</span><span class="meta">${item.platform === 'android' ? 'Google Play' : `App Store Connect app <span class="mono">${esc(item.ascApp ?? '—')}</span>`}</span></span><span class="end"><span class="when">${ago(new Date(item.createdAt).getTime())}</span></span></div>`).join('')}</div>${expo.url ? `<div class="card-foot"><a class="link" href="${esc(expo.url)}/submissions">All submissions on expo.dev</a></div>` : ''}`
      : empty('send', 'No submissions yet')));
  },
  async channels(data, box) {
    box.innerHTML = `<div class="card" id="chan">${skeleton(3)}</div>`;
    withExpo(data.name, $('#chan'), (expo) => (expo.channels.length ? `<div class="rows">${expo.channels.map((item) => `<div class="row"><span class="st">${icon('radio')}</span><span class="main"><span class="title">${esc(item.name)} ${item.paused ? '<span class="tag warn">paused</span>' : ''}</span><span class="meta">${item.branches.map((branch) => `<span>${icon('branch', 'xs')}${esc(branch.name)} · ${plural(branch.updates, 'update')}</span>`).join('<span class="sep"></span>') || 'No branch'}</span></span><span class="end hide-sm">${(() => { const used = data.profiles.filter((profile) => profile.channel === item.name).map((profile) => profile.name); return used.length ? `<span class="faint">${used.length === 1 ? 'profile' : 'profiles'}</span> ${esc(used.join(', '))}` : ''; })()}</span></div>`).join('')}</div>`
      : empty('radio', 'No channels')));
  },
  async signing(data, box) {
    const profile = (signing, label) => {
      if (!signing) return card(label, 'shield', empty('shield', 'No build yet'));
      const left = expiryOf(signing);
      return card(label, 'shield', `<div class="card-body"><div class="expiry"><span class="${left < 30 ? 'warn' : ''}"><b>${left}</b> days left</span><div class="bar ${left < 30 ? 'low' : ''}"><i style="width:${Math.max(2, Math.min(100, (left / 365) * 100))}%"></i></div></div></div>
        ${kv([['Profile', `<span class="mono">${esc(signing.profile)}</span>`], ['Team', esc(signing.team)], ['Expires', day(signing.expires)], ['Devices', signing.devices ? String(signing.devices) : 'Any (App Store)']], 'list-kv')}`);
    };
    box.innerHTML = `<div class="cols two">${profile(data.signing, 'Development profile')}${profile(data.storeSigning, 'App Store profile')}</div>
      <div class="section"><div class="section-head"><h2>Devices</h2></div><div class="card" id="devices">${skeleton(3)}</div></div>`;
    withExpo(data.name, $('#devices'), (expo) => (expo.devices.length ? `<div class="rows">${expo.devices.map((item) => `<div class="row compact"><span class="st">${icon(item.kind === 'IPAD' ? 'tablet' : 'phone')}</span><span class="main"><span class="title">${esc(item.name)}</span><span class="meta">${esc({ IPHONE: 'iPhone', IPAD: 'iPad' }[item.kind] ?? item.kind ?? '')}<span class="sep"></span><span class="mono">…${esc(item.udid ?? '')}</span></span></span></div>`).join('')}</div>`
      : empty('phone', 'No devices')));
  },
  async environment(data, box) {
    box.innerHTML = `<div class="stack" id="env">${skeleton(4)}</div>`;
    withExpo(data.name, $('#env'), (expo) => Object.entries(expo.env).map(([environment, names]) => card(environment.charAt(0).toUpperCase() + environment.slice(1), 'braces',
      names ? `<div class="card-body chips">${names.length ? names.map((item) => `<span class="code">${esc(item)}</span>`).join('') : '<span class="faint">None set</span>'}</div>` : '<div class="card-body faint">Not available</div>',
      names ? `<span class="faint">${plural(names.length, 'variable')}</span>` : '')).join(''));
  },
  async automation(data, box) {
    const name = data.name;
    const branches = data.branches.map((branch) => branch.name);
    const ruleIcon = (rule) => icon(rule.on === 'pr' ? 'pr' : rule.on === 'nightly' ? 'clock' : 'branch', 'sm faint');
    box.innerHTML = `<div class="cols main-side"><div class="stack">
        ${card('Rules', 'bolt', data.triggers.length ? `<div class="rows">${data.triggers.map((rule) => `<label class="toggle"><span><b>${ruleIcon(rule)} ${ruleTitle(rule)}</b><small>${ruleDetail(rule)}${!rule.error && rule.sha ? ` · last built <span class="mono">${esc(rule.sha.slice(0, 7))}</span>` : ''}</small></span><input class="switch" type="checkbox" checked data-rule-on="${esc(rule.on ?? 'push')}" data-rule-branch="${esc(rule.branch ?? '')}" aria-label="${esc(ruleTitle(rule))}"></label>`).join('')}</div>`
          : empty('bolt', 'No rules yet'))}
      </div><div class="stack">
        ${card('Add a rule', 'plus', `<form class="card-body form" id="rule">
          <label class="field"><span>When</span><select class="select" name="when">${Object.entries(RULE_KINDS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
          <label class="field" id="rule-branch"><span>Branch</span><select class="select" name="branch">${branches.map((branch) => `<option ${branch === 'main' ? 'selected' : ''}>${esc(branch)}</option>`).join('')}</select></label>
          <label class="field" id="rule-at" hidden><span>Time</span><input class="input" type="time" name="at" value="02:00"></label>
          <label class="field"><span>Platform</span><select class="select" name="platform"><option value="ios">iOS</option><option value="android">Android</option></select></label>
          <label class="field"><span>Profile</span><select class="select" name="profile">${data.profiles.map((item) => `<option value="${esc(item.name)}" ${item.name === 'development' ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
          <label class="toggle" style="padding:0"><span><b id="rule-store">Upload to TestFlight</b></span><input class="switch" type="checkbox" name="submit"></label>
          <label class="toggle" style="padding:0"><span><b>Reuse if unchanged</b></span><input class="switch" type="checkbox" name="skip"></label>
          <button class="btn primary">${icon('bolt')}Add rule</button><p class="hint bad" id="rule-error"></p></form>`)}
      </div></div>`;
    const form = $('#rule');
    let when = 'push';
    const sync = () => {
      const profile = data.profiles.find((item) => item.name === form.profile.value);
      const target = profile?.[form.platform.value];
      const storeProfile = profile?.distribution === 'store' && !target?.simulator;
      form.submit.disabled = !storeProfile;
      if (!storeProfile) form.submit.checked = false;
      form.skip.disabled = form.submit.checked;
      if (form.submit.checked) form.skip.checked = false;
      $('#rule-store').textContent = `Upload to ${storeName(form.platform.value)}`;
      $('#rule-branch').hidden = when === 'pr';
      $('#rule-at').hidden = when !== 'nightly';
    };
    form.onchange = () => { when = form.when.value; sync(); };
    form.profile.value = data.profiles.find((item) => item.developmentClient)?.name ?? form.profile.value;
    form.skip.checked = Boolean(data.profiles.find((item) => item.name === form.profile.value)?.developmentClient);
    sync();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const result = await post('/api/triggers', { project: name, on: when, branch: form.branch.value, at: form.at.value, profile: form.profile.value, platform: form.platform.value, submit: form.submit.checked, skipUnchanged: form.skip.checked, enabled: true });
      if (result.error) $('#rule-error').textContent = result.error; else route();
    };
    box.onchange = async (event) => {
      if (!event.target.matches('[data-rule-on]')) return;
      await post('/api/triggers', { project: name, on: event.target.dataset.ruleOn, branch: event.target.dataset.ruleBranch, enabled: false });
      route();
    };
  },
};
function branchRow(name, branch, data, full = false) {
  const last = data.builds.find((build) => build.ref === branch.name);
  const rule = data.triggers.find((item) => item.branch === branch.name);
  return `<a class="row" href="#/p/${esc(name)}/new?branch=${encodeURIComponent(branch.name)}">${last ? statusIcon(last.status) : `<span class="st">${icon('branch')}</span>`}
    <span class="main"><span class="title">${esc(branch.name)} ${branch.pr ? `<span class="tag">${icon('pr')}#${esc(branch.pr.number)}</span>` : ''} ${rule ? `<span class="tag">${icon('bolt')}auto</span>` : ''}</span>
    <span class="meta"><span class="mono">${esc(branch.short)}</span><span class="sep"></span><span class="trunc">${esc(branch.subject)}</span>${full ? `<span class="sep"></span><span>${esc(branch.author)}</span>` : ''}</span></span>
    <span class="end"><span class="when">${ago(branch.date)}</span>${full ? `<span class="btn sm hide-sm">${icon('layers')}Build</span>` : icon('right', 'chev')}</span></a>`;
}

async function newBuildPage({ name, branch }) {
  const [data, setup] = await Promise.all([get(`/api/projects/${encodeURIComponent(name)}`), get('/api/setup').catch(() => ({}))]);
  const form = {
    source: branch === '' ? 'working' : 'branch',
    branch: branch || data.branches.find((item) => item.name === 'main')?.name || data.branches[0]?.name || '',
    commit: '', platform: 'ios', profile: data.profiles.find((item) => item.name === 'development')?.name ?? data.profiles[0]?.name, submit: false, skip: null,
    install: setup.autoInstall && setup.autoInstall !== 'off',
  };
  if (!form.branch) form.source = 'working';
  let commits = [];
  const profileOf = () => data.profiles.find((item) => item.name === form.profile);
  const target = () => profileOf()?.[form.platform] ?? { artifact: 'ipa', simulator: false };
  const isStore = () => profileOf()?.distribution === 'store' && !target().simulator;
  // Development and simulator builds load JavaScript from Metro, so reusing one with the same native code loses nothing.
  const devLike = () => Boolean(profileOf()?.developmentClient || target().simulator);
  const skip = () => (form.skip ?? devLike()) && !form.submit;
  const pushRule = () => data.triggers.find((item) => (item.on ?? 'push') === 'push' && item.branch === form.branch);
  const typical = () => {
    const times = data.builds.filter((build) => build.status === 'success' && build.profile === form.profile && (build.platform ?? 'ios') === form.platform && build.startedAt).map((build) => build.finishedAt - build.startedAt);
    return times.length ? median(times) : null;
  };
  const describeProfile = (item) => {
    const kind = item[form.platform];
    if (form.platform === 'android') return `${kind.artifact.toUpperCase()} · ${item.distribution === 'store' ? 'Google Play' : 'Internal'}`;
    return kind.simulator ? 'Simulator' : item.distribution === 'store' ? 'App Store' : 'Internal';
  };
  app.innerHTML = `<nav class="crumbs"><a href="#/projects">Projects</a><span class="slash">/</span><a href="#/p/${esc(name)}">${avatar(name, 'xs')}${esc(name)}</a><span class="slash">/</span><span>New build</span></nav>
    ${header('New build')}
    <div class="cols main-side"><form class="form" id="nb" onsubmit="return false">
      ${card('Source', 'branch', `<div class="card-body">
        <div class="seg" role="group" aria-label="Source"><button type="button" data-source="branch">GitHub branch</button><button type="button" data-source="working">Working copy</button></div>
        <div id="src"></div></div>`)}
      ${card('Platform and profile', 'layers', `<div class="card-body">
        <div class="seg" role="group" aria-label="Platform"><button type="button" data-platform="ios">iOS</button><button type="button" data-platform="android">Android</button></div>
        <div class="choices" id="profiles"></div></div>`)}
      ${card('After the build', 'send', `<div class="rows"><label class="toggle"><span><b id="submit-label">Upload to TestFlight</b><small id="tf-note"></small></span><input class="switch" type="checkbox" id="submit"></label>
        <label class="toggle"><span><b>Reuse if unchanged</b><small id="skip-note"></small></span><input class="switch" type="checkbox" id="skip"></label>
        <label class="toggle" id="phone-install-row"><span><b>Install on iPhone</b><small id="phone-install-note"></small></span><input class="switch" type="checkbox" id="phone-install"></label>
        <label class="toggle"><span><b>Build on every push</b><small id="auto-note"></small></span><input class="switch" type="checkbox" id="auto"></label></div>`)}
    </form>
    <aside class="stack"><section class="card" id="sum"></section></aside></div>`;
  const drawSource = () => {
    document.querySelectorAll('[data-source]').forEach((button) => button.classList.toggle('on', button.dataset.source === form.source));
    $('#src').innerHTML = `${form.source === 'branch'
      ? `<div class="form"><label class="field"><span>Branch</span><select class="select" id="branch">${data.branches.map((item) => `<option value="${esc(item.name)}" ${item.name === form.branch ? 'selected' : ''}>${esc(item.name)}${item.pr ? ` · #${esc(item.pr.number)}` : ''}</option>`).join('')}</select></label>
        <label class="field"><span>Commit</span><select class="select" id="commit">${commits.map((item, index) => `<option value="${index ? esc(item.hash) : ''}" ${(index ? item.hash : '') === form.commit ? 'selected' : ''}>${esc(item.short)} · ${esc(item.subject.slice(0, 60))}${index ? '' : ' (latest)'}</option>`).join('') || '<option>Loading…</option>'}</select></label></div>`
      : ''}${commitOffer(data, { github: form.source === 'branch' })}`;
  };
  const drawProfiles = () => {
    document.querySelectorAll('[data-platform]').forEach((button) => button.classList.toggle('on', button.dataset.platform === form.platform));
    $('#profiles').innerHTML = data.profiles.map((item) => `<label class="choice"><input type="radio" name="profile" value="${esc(item.name)}" ${item.name === form.profile ? 'checked' : ''}><b>${esc(item.name)}</b><small>${esc(describeProfile(item))}${item.channel ? ` · ${esc(item.channel)} channel` : ''}</small></label>`).join('');
  };
  const drawSummary = () => {
    const profile = profileOf();
    const commit = commits.find((item) => item.hash === form.commit) ?? commits[0];
    const usual = typical();
    if (!isStore()) form.submit = false;
    $('#submit').disabled = !isStore();
    $('#submit').checked = form.submit;
    $('#submit-label').textContent = `Upload to ${storeName(form.platform)}`;
    $('#tf-note').textContent = isStore() ? '' : 'Store profiles only';
    $('#skip').disabled = form.submit;
    $('#skip').checked = skip();
    $('#skip-note').textContent = form.submit ? 'Store uploads always build' : '';
    const rule = pushRule();
    const phoneOk = form.platform === 'ios' && !target().simulator && !form.submit;
    $('#phone-install-row').hidden = !phoneOk;
    $('#phone-install').checked = phoneOk && form.install;
    $('#phone-install-note').textContent = setup.phone
      ? `${setup.phone.name}${setup.phone.wifi ? ' · Wi-Fi' : setup.phone.wired ? ' · USB' : ''}`
      : 'Paired iPhone in Xcode';
    $('#auto').disabled = form.source !== 'branch';
    $('#auto').checked = Boolean(rule) && form.source === 'branch';
    $('#auto-note').textContent = form.source !== 'branch' ? 'Pick a GitHub branch' : '';
    $('#sum').innerHTML = `<div class="card-head"><h2>${avatar(name, 'sm')}${esc(name)}</h2><span class="faint">Summary</span></div>
      ${kv([
        ['Source', form.source === 'branch' ? esc(form.branch) : 'Working copy'],
        ['Commit', form.source === 'branch' ? (commit ? `<span class="mono">${esc(commit.short)}</span>${form.commit ? '' : ' <span class="faint">latest</span>'}` : '…') : `<span class="mono">${esc(data.commit)}</span>${data.dirty ? ' <span class="warn">+ changes</span>' : ''}`],
        ['Platform', form.platform === 'android' ? 'Android' : target().simulator ? 'iOS Simulator' : 'iOS'], ['Profile', profile ? esc(profile.name) : '—'],
        ['Builds', form.platform === 'android' ? target().artifact.toUpperCase() : target().simulator ? 'Simulator app' : 'IPA'],
        ['Then', form.submit ? `Upload to ${storeName(form.platform)}` : skip() ? 'Reuse if unchanged' : 'Keep the build here'], ['Usually takes', usual ? `about ${span(usual, true)}` : 'New for this profile'],
      ], 'list-kv')}
      <div class="card-body" style="border-top:1px solid var(--line)"><button class="btn primary lg block" id="go">${icon('layers')}Start build</button><p class="hint bad" id="error"></p></div>`;
  };
  const loadCommits = async () => {
    commits = [];
    drawSource(); drawSummary();
    if (form.source !== 'branch' || !form.branch) return;
    const wanted = form.branch;
    const list = await get(`/api/projects/${encodeURIComponent(name)}/commits?branch=${encodeURIComponent(wanted)}`);
    if (wanted !== form.branch) return;
    commits = list; drawSource(); drawSummary();
  };
  app.onclick = async (event) => {
    const source = event.target.closest('[data-source]');
    if (source) { form.source = source.dataset.source; form.commit = ''; loadCommits(); return; }
    const platform = event.target.closest('[data-platform]');
    if (platform) { form.platform = platform.dataset.platform; form.skip = null; drawProfiles(); drawSummary(); return; }
    if (event.target.closest('[data-commit]')) {
      const button = event.target.closest('[data-commit]');
      button.disabled = true;
      await runCommit(name, data);
      drawSource(); drawSummary();
      if (commitLive(data)) every(2500, async () => {
        const fresh = await get(`/api/projects/${encodeURIComponent(name)}`);
        data.dirty = fresh.dirty; data.changes = fresh.changes; data.ahead = fresh.ahead; data.commitJob = fresh.commitJob; data.t3 = fresh.t3;
        drawSource(); drawSummary();
        if (!commitLive(data)) {
          if (form.source === 'branch' && !data.dirty) loadCommits();
          return 'stop';
        }
        return undefined;
      });
      return;
    }
    if (event.target.closest('#go')) {
      const go = $('#go'); go.disabled = true;
      const ref = form.source === 'branch' ? form.commit || form.branch : null;
      const created = await post('/api/builds', { project: name, profile: form.profile, platform: form.platform, ref, label: form.source === 'branch' ? form.branch : undefined, submit: form.submit, skipUnchanged: skip(), install: form.platform === 'ios' && !target().simulator && !form.submit ? form.install : false });
      if (created.id) location.hash = `#/build/${created.id}`;
      else { $('#error').textContent = created.error ?? 'Could not start the build'; go.disabled = false; }
    }
  };
  app.onchange = async (event) => {
    const { target: input } = event;
    if (input.id === 'branch') { form.branch = input.value; form.commit = ''; loadCommits(); }
    if (input.id === 'commit') { form.commit = input.value; drawSummary(); }
    if (input.name === 'profile') { form.profile = input.value; form.skip = null; drawSummary(); }
    if (input.id === 'submit') { form.submit = input.checked; drawSummary(); }
    if (input.id === 'skip') { form.skip = input.checked; drawSummary(); }
    if (input.id === 'phone-install') { form.install = input.checked; drawSummary(); }
    if (input.id === 'auto') {
      const result = await post('/api/triggers', { project: name, on: 'push', branch: form.branch, profile: form.profile, platform: form.platform, submit: form.submit, skipUnchanged: skip(), enabled: input.checked });
      if (result.error) $('#error').textContent = result.error;
      data.triggers = (await get(`/api/projects/${encodeURIComponent(name)}`)).triggers;
      drawSummary();
    }
  };
  drawProfiles();
  await loadCommits();
}

async function insightsPage() {
  const { builds } = await get('/api/builds');
  const names = [...new Set([...shell.projects.map((project) => project.name), ...builds.map((build) => build.project)])];
  const picked = builds.filter((build) => prefs.scope === 'all' || build.project === prefs.scope);
  const now = Date.now();
  const inDays = (from, to) => picked.filter((build) => now - build.createdAt >= from * DAY && now - build.createdAt < to * DAY);
  const week = inDays(0, 7); const before = inDays(7, 14);
  const finished = picked.filter((build) => ['success', 'failed'].includes(build.status));
  const passed = finished.filter((build) => build.status === 'success');
  const good = picked.filter((build) => build.status === 'success' && build.startedAt && build.finishedAt);
  const times = good.map((build) => build.finishedAt - build.startedAt);
  const busy = week.filter((build) => build.startedAt && build.finishedAt).reduce((sum, build) => sum + build.finishedAt - build.startedAt, 0);
  const change = week.length - before.length;
  const perDay = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (13 - index));
    const list = picked.filter((build) => build.createdAt >= date.getTime() && build.createdAt < date.getTime() + DAY);
    const count = (status) => list.filter((build) => build.status === status).length;
    return { label: day(date), tick: day(date), tip: plural(list.length, 'build'), parts: [{ value: count('success') }, { value: count('failed'), cls: 'failed' }, { value: list.length - count('success') - count('failed'), cls: 'cancelled' }] };
  });
  const recent = good.slice(0, 20).reverse();
  const durations = recent.map((build) => ({ label: `${build.project} · ${short(build)} · ${day(build.createdAt)}`, tick: day(build.createdAt), tip: span(build.finishedAt - build.startedAt), parts: [{ value: (build.finishedAt - build.startedAt) / 60000 }] }));
  const phaseTimes = {};
  for (const build of good) {
    (build.phases ?? []).forEach((phase, index) => {
      const end = build.phases[index + 1]?.at ?? build.finishedAt;
      if (end && phase.name !== 'SUBMIT') (phaseTimes[phase.name] ??= []).push(end - phase.at);
    });
  }
  const phases = Object.entries(phaseTimes).map(([key, list]) => ({ key, ms: median(list) })).sort((a, b) => b.ms - a.ms).slice(0, 7);
  const longest = Math.max(1, ...phases.map((item) => item.ms));
  const byProject = names.map((name) => {
    const mine = builds.filter((build) => build.project === name);
    const done = mine.filter((build) => ['success', 'failed'].includes(build.status));
    const ok = mine.filter((build) => build.status === 'success' && build.startedAt && build.finishedAt);
    const sized = mine.find((build) => build.status === 'success' && build.ipaBytes && !build.simulator);
    return { name, week: mine.filter((build) => now - build.createdAt < 7 * DAY).length, rate: done.length ? Math.round((done.filter((build) => build.status === 'success').length / done.length) * 100) : null, typical: ok.length ? median(ok.map((build) => build.finishedAt - build.startedAt)) : null, last: mine[0], size: sized?.ipaBytes };
  });
  // App size over time for one project: builds of the platform and profile of its latest build, so like is compared with like.
  const sized = picked.filter((build) => build.status === 'success' && build.ipaBytes && !build.simulator);
  const sizeSeries = prefs.scope === 'all' || !sized.length ? [] : sized.filter((build) => (build.platform ?? 'ios') === (sized[0].platform ?? 'ios') && build.profile === sized[0].profile).slice(0, 20).reverse();
  const sizes = sizeSeries.map((build, index) => {
    const before = sizeSeries[index - 1]?.ipaBytes;
    const change = before ? build.ipaBytes - before : 0;
    return { label: `${short(build)} · ${day(build.createdAt)}${Math.abs(change) >= 52429 ? ` · ${change > 0 ? '+' : '−'}${mb(Math.abs(change))}` : ''}`, tick: day(build.createdAt), tip: mb(build.ipaBytes), parts: [{ value: build.ipaBytes / 1048576 }] };
  });
  const sizeTitle = sizeSeries.length ? `${sizeSeries[0].platform === 'android' ? 'Android' : 'iOS'} · ${sizeSeries[0].profile}` : '';
  const kpi = (ic, label, value, note = '') => `<div class="card kpi"><div class="k">${icon(ic)}${label}</div><div class="v">${value}</div>${note ? `<div class="n">${note}</div>` : ''}</div>`;
  app.innerHTML = `${mobileTop()}${header('Insights')}
    <div class="toolbar"><div class="seg" role="group" aria-label="Projects">${['all', ...names].map((name) => `<button data-scope="${esc(name)}" class="${prefs.scope === name ? 'on' : ''}">${name === 'all' ? 'All' : esc(name)}</button>`).join('')}</div></div>
    <div class="kpis">
      ${kpi('layers', 'This week', week.length, `<span class="delta ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change > 0 ? '+' : ''}${change}</span>`)}
      ${kpi('check', 'Passed', finished.length ? `${Math.round((passed.length / finished.length) * 100)}%` : '—')}
      ${kpi('timer', 'Typical', times.length ? span(median(times)) : '—')}
      ${kpi('mac', 'Mac time', busy ? span(busy) : '—')}
    </div>
    <div class="cols two section">
      ${card('Builds per day', 'chart', '<div class="card-body chart" data-chart="0"></div>', '<div class="legend"><span><i></i>Finished</span><span><i class="failed"></i>Failed</span></div>')}
      ${card('Build time', 'timer', recent.length ? '<div class="card-body chart" data-chart="1"></div>' : empty('timer', 'No finished builds yet'), '<div class="legend"><span><i></i>Last 20</span><span><i class="median"></i>Median</span></div>')}
    </div>
    <div class="cols two section">
      ${card('Phases', 'clock', phases.length ? `<div class="card-body hbars">${phases.map((item) => `<div class="hbar"><span>${esc(phaseName(item.key))}</span><div class="track"><i style="width:${((item.ms / longest) * 100).toFixed(1)}%"></i></div><em>${span(item.ms)}</em></div>`).join('')}</div>` : empty('clock', 'No timings yet'))}
      ${card('App size', 'download', sizes.length > 1 ? '<div class="card-body chart" data-chart="2"></div>' : empty('download', prefs.scope === 'all' ? 'Pick a project' : 'Need two builds'), sizeTitle ? `<span class="faint">${esc(sizeTitle)}</span>` : '')}
    </div>
    <div class="section">
      ${card('By project', 'apps', `<div class="table-wrap"><table class="table"><thead><tr><th>Project</th><th class="r">This week</th><th class="r">Passed</th><th class="r">Typical</th><th class="r">App size</th><th class="r">Last build</th></tr></thead><tbody>${byProject.map((row) => `<tr><td><a class="who" href="#/p/${esc(row.name)}">${avatar(row.name, 'sm')}${esc(row.name)}</a></td><td class="r">${row.week}</td><td class="r">${row.rate === null ? '—' : `${row.rate}%`}</td><td class="r">${row.typical ? span(row.typical) : '—'}</td><td class="r">${row.size ? mb(row.size) : '—'}</td><td class="r">${row.last ? `<span class="last">${statusIcon(row.last.status)}${ago(row.last.createdAt)}</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>`)}
    </div>`;
  // Drawn once the cards exist, at their real width, so the axis text stays at its intended size.
  const charts = [
    [perDay, { format: (value, axis) => (axis ? String(Math.round(value)) : plural(value, 'build')), axis: stepFor }],
    [durations, { format: minutes, axis: stepFor, median: times.length ? median(times) / 60000 : null }],
    [sizes, { format: (value, axis) => (axis ? `${Math.round(value)} MB` : `${value.toFixed(1)} MB`), axis: stepFor }],
  ];
  document.querySelectorAll('[data-chart]').forEach((box) => {
    const [items, options] = charts[box.dataset.chart];
    box.innerHTML = columns(items, { ...options, width: Math.max(280, box.clientWidth - 32) });
  });
  app.onclick = (event) => {
    const button = event.target.closest('[data-scope]');
    if (button) { prefs.scope = button.dataset.scope; insightsPage().catch(() => {}); }
  };
}

function setupBanner(setup) {
  const box = $('#setup-banner');
  if (!box || setup.setupComplete) return;
  const miss = (setup.doctor?.items ?? []).filter((item) => item.status === 'miss').length;
  if (!miss) return;
  box.innerHTML = `<div class="banner">${icon('mac')}<span>${plural(miss, 'setup item')} to fix</span><a class="btn sm" href="#/setup" style="margin-left:auto">Guide</a><button class="btn ghost sm" data-hide-setup aria-label="Dismiss">${icon('x')}</button></div>`;
  box.querySelector('[data-hide-setup]').onclick = async () => { await post('/api/setup', { setupComplete: true }); box.innerHTML = ''; };
}
const SETUP_STEPS = [['tools', 'Tools'], ['apps', 'Apps'], ['mac', 'This Mac'], ['phone', 'Phone']];
function doctorRows(items) {
  return `<div class="rows">${(items ?? []).map((item) => `<div class="row compact">
    <span class="st ${item.status === 'ok' ? 'success' : item.status === 'miss' ? 'failed' : ''}">${icon(item.status === 'ok' ? 'check' : item.status === 'miss' ? 'cross' : 'skip')}</span>
    <span class="main"><span class="title">${esc(item.label)}</span><span class="meta wrap">${esc(item.detail)}</span></span>
  </div>`).join('')}</div>`;
}
async function setupPage() {
  const data = await get('/api/setup');
  const miss = (data.doctor?.items ?? []).filter((item) => item.status === 'miss');
  const step = prefs.setupStep ?? (miss.length ? 'tools' : data.projects.length ? 'mac' : 'apps');
  const tools = data.doctor?.items ?? [];
  const pane = {
    tools: card('Tools', 'gear', tools.length ? doctorRows(tools) : empty('gear', 'Couldn’t read doctor', esc(data.doctor?.error ?? ''))),
    apps: card('Apps', 'apps', data.projects.length
      ? `<div class="rows">${data.projects.map((name) => `<a class="row" href="#/p/${esc(name)}">${avatar(name, 'sm')}<span class="main"><span class="title">${esc(name)}</span></span></a>`).join('')}</div>`
      : empty('apps', 'No apps yet', 'Scan the usual project folders, or add one with macbuild add.'),
    '<button class="btn sm" id="scan">Scan</button>'),
    mac: card('This Mac', 'mac', `<div class="rows">
      <label class="toggle"><span><b>Open at login</b></span><input class="switch" type="checkbox" id="login-at-login" ${data.loginAtLogin ? 'checked' : ''}></label>
      <label class="toggle"><span><b>Menu bar</b></span><input class="switch" type="checkbox" id="menubar" ${data.menubar ? 'checked' : ''}></label>
    </div>`),
    phone: card('Phone', 'phone', `<div class="setting">
      <div><b>This Mac</b><p class="hint mono" id="local-url">${esc(data.localUrl)}</p></div>
      <div><b>On your tailnet</b><p class="hint mono" id="phone-url">${esc(data.phoneUrl || 'Tailscale not publishing HTTPS yet')}</p></div>
      <div class="inline">${data.phoneUrl ? '<button class="btn sm" id="copy-phone">Copy phone URL</button>' : ''}<button class="btn sm ghost" id="copy-local">Copy local URL</button></div>
    </div>`),
  };
  app.innerHTML = `${mobileTop()}${header('Setup', '', `<a class="btn ghost sm" href="#/settings">${icon('left')}Settings</a>`)}
    <div class="setup">
      <div class="seg" role="tablist">${SETUP_STEPS.map(([key, label]) => `<button data-step="${key}" class="${step === key ? 'on' : ''}" aria-selected="${step === key}">${label}</button>`).join('')}</div>
      ${pane[step] ?? pane.tools}
      <div class="setup-foot">
        ${miss.length ? `<p class="hint">${plural(miss.length, 'item')} still missing</p>` : '<p class="hint ok">Ready to build</p>'}
        <button class="btn primary" id="setup-done">${miss.length ? 'Done for now' : 'Done'}</button>
      </div>
    </div>`;
  const save = async (changes) => {
    const result = await post('/api/setup', changes);
    if (result.error) { flash(result.error, true); return; }
    route();
  };
  const login = $('#login-at-login');
  if (login) login.onchange = () => save({ loginAtLogin: login.checked });
  const bar = $('#menubar');
  if (bar) bar.onchange = () => save({ menubar: bar.checked });
  app.onclick = async (event) => {
    const next = event.target.closest('[data-step]');
    if (next) { prefs.setupStep = next.dataset.step; setupPage().catch(() => {}); return; }
    if (event.target.closest('#scan')) {
      event.target.closest('#scan').disabled = true;
      await post('/api/projects/scan');
      route();
      return;
    }
    if (event.target.closest('#copy-phone') && data.phoneUrl) {
      try { await navigator.clipboard.writeText(data.phoneUrl); flash('Copied'); } catch { flash(data.phoneUrl); }
    }
    if (event.target.closest('#copy-local')) {
      try { await navigator.clipboard.writeText(data.localUrl); flash('Copied'); } catch { flash(data.localUrl); }
    }
    if (event.target.closest('#setup-done')) { await save({ setupComplete: true }); location.hash = '#/'; }
  };
}

async function settingsPage() {
  const [data, setup] = await Promise.all([get('/api/system'), get('/api/setup').catch(() => ({}))]);
  const canPush = 'PushManager' in window && 'serviceWorker' in navigator;
  const enabled = canPush ? Boolean(await Promise.race([pushState(), new Promise((resolve) => { setTimeout(() => resolve(null), 800); })])) : false;
  const { machine = {}, settings = {}, tools = {} } = data;
  const used = data.diskTotal ? 1 - data.diskFree / data.diskTotal : 0;
  const load = Math.min(1, data.load / Math.max(1, data.cores));
  const hours = Math.floor(data.uptime / 3600);
  const meter = (label, value, fraction, low = false) => `<div><div class="meter-label"><span>${label}</span><span>${value}</span></div><div class="bar ${low ? 'low' : ''}"><i style="width:${(fraction * 100).toFixed(1)}%"></i></div></div>`;
  app.innerHTML = `${mobileTop()}${header('Settings')}
    <div class="settings"><div class="stack">
      <section class="card"><div class="hero-mac"><span class="mac">${icon('mac')}</span><div><b>${esc(machine.name || 'This Mac')}</b><small>${esc([machine.chip, machine.memory && `${Math.round(machine.memory / 1073741824)} GB`, machine.macos && `macOS ${machine.macos}`].filter(Boolean).join(' · '))}</small></div>
        <span class="pill" style="margin-left:auto">${data.current ? '<span class="led busy"></span>Building' : '<span class="led idle"></span>Idle'}</span></div>
        <div class="meters">${meter('Disk', `${gb(data.diskFree)} free of ${gb(data.diskTotal)}`, used, used > 0.9)}${meter('Load', `${data.load.toFixed(1)} on ${data.cores} cores`, load)}${data.battery ? meter('Battery', `${data.battery.percent}% · ${esc(data.battery.state)}`, data.battery.percent / 100, data.battery.percent < 20) : ''}</div>
        ${kv([['Up for', hours > 47 ? `${Math.floor(hours / 24)} days` : plural(hours, 'hour')], ['Queue', data.current ? `Building, ${data.queued} waiting` : `${data.queued} waiting`]], 'list-kv')}</section>
      ${card('Disk', 'broom', `<div id="disk">${skeleton(5)}</div>`, '<button class="btn sm ghost" id="disk-again">Measure again</button>')}
      ${card('Notifications', 'bell', `<label class="toggle"><span><b>When a build finishes</b><small id="push-note">${canPush ? (enabled ? 'On' : '') : 'Add to Home Screen first'}</small></span><input class="switch" type="checkbox" id="push" ${enabled ? 'checked' : ''} ${canPush ? '' : 'disabled'}></label>
        ${enabled ? '<div class="card-foot"><button class="btn sm" id="push-test">Send a test</button></div>' : ''}`)}
      ${card('On this Mac', 'mac', `<div class="rows">
        <label class="toggle"><span><b>Open at login</b></span><input class="switch" type="checkbox" id="login-at-login" ${setup.loginAtLogin ? 'checked' : ''}></label>
        <label class="toggle"><span><b>Menu bar</b></span><input class="switch" type="checkbox" id="menubar" ${setup.menubar ? 'checked' : ''}></label>
        <div class="toggle" style="cursor:default"><span><b>Install on iPhone</b><small>${setup.phone ? `${esc(setup.phone.name)}${setup.phone.wifi ? ' · Wi-Fi' : setup.phone.wired ? ' · USB' : ''}` : 'After a finished iOS build'}</small></span>
          <div class="seg" role="group" aria-label="Install on iPhone" id="auto-install">${[['off', 'Off'], ['wifi', 'Wi-Fi'], ['always', 'Always']].map(([value, label]) => `<button type="button" data-auto-install="${value}" class="${(settings.autoInstall || 'off') === value ? 'on' : ''}">${label}</button>`).join('')}</div></div>
        <a class="row compact" href="#/setup"><span class="main"><span class="title">Setup guide</span></span>${icon('right', 'sm')}</a>
      </div>`)}
    </div><div class="stack">
      ${card('Integrations', 'link', `<div class="rows">
        <label class="toggle"><span><b>GitHub checks</b><small>${tools.gh ? '' : 'Run gh auth login'}</small></span><input class="switch" type="checkbox" id="gh-status" ${settings.githubStatus ? 'checked' : ''} ${tools.gh || settings.githubStatus ? '' : 'disabled'}></label>
        <form class="setting" id="hook-form"><div><b>Slack or Discord</b></div>
          <div class="inline"><input class="input" id="hook" type="url" placeholder="${settings.webhook ? 'Replace webhook URL' : 'Webhook URL'}" autocomplete="off" aria-label="Webhook URL"><button class="btn sm">Save</button>${settings.webhook ? '<button type="button" class="btn sm" id="hook-test">Test</button><button type="button" class="btn sm ghost" id="hook-remove">Remove</button>' : ''}</div>
          <p class="hint" id="hook-note"></p></form>
        <form class="setting" id="team-form"><div><b>Apple Team ID</b></div>
          <div class="inline"><input class="input mono" id="team" placeholder="ABCDE12345" value="${esc(settings.appleTeam ?? '')}" maxlength="10" autocomplete="off" aria-label="Apple Team ID"><button class="btn sm">Save</button></div><p class="hint" id="team-note"></p></form>
      </div>`)}
      ${card('Automatic builds', 'bolt', data.triggers.length ? `<div class="rows">${data.triggers.map((rule) => `<div class="row">${avatar(rule.project, 'sm')}<span class="main"><span class="title">${esc(rule.project)} <span class="faint">/</span> ${ruleTitle(rule)}</span><span class="meta">${ruleDetail(rule)}</span></span>
          ${rule.missing ? `<button class="btn sm remove-rule" data-project="${esc(rule.project)}" data-on="${esc(rule.on ?? 'push')}" data-branch="${esc(rule.branch ?? '')}">Remove</button>` : `<a class="btn sm ghost" href="#/p/${esc(rule.project)}/automation">Manage</a>`}</div>`).join('')}</div>`
        : empty('bolt', 'None yet'))}
      ${card('Storage', 'disk', kv([['Builds kept', `${data.kept?.builds ?? '—'} <span class="faint">of ${data.kept?.maxBuilds ?? 200}</span>`], ['Build files kept', `${data.kept?.ipas ?? '—'} <span class="faint">of ${data.kept?.maxIpas ?? 10}</span>`], ['Space used', mb(data.ipaBytes)]], 'list-kv'))}
      ${card('Tools', 'gear', setup.doctor?.items?.length ? doctorRows(setup.doctor.items) : kv([['Xcode', esc(tools.xcode || '—')], ['EAS CLI', esc(tools.eas || '—')], ['Node.js', esc(tools.node)], ['GitHub CLI', tools.gh ? 'Signed in' : '<span class="faint">Not signed in</span>'], ['Android SDK', tools.android ? 'Found' : '<span class="faint">Not installed</span>']], 'list-kv'))}
      ${card('About', 'cube', `<div class="card-body muted"><a class="link" href="https://github.com/fav-devs/macbuild">github.com/fav-devs/macbuild</a></div>`)}
    </div></div>`;
  const drawDisk = (disk) => {
    const clearable = disk.items.filter((item) => item.cleanable && item.bytes).reduce((sum, item) => sum + item.bytes, 0);
    $('#disk').innerHTML = `<div class="rows">${disk.items.map((item) => `<div class="row"><span class="main"><span class="title">${esc(item.label)}</span></span>
      <span class="end"><span class="num">${item.bytes === null ? '—' : item.bytes ? (item.bytes >= 1e9 ? gb(item.bytes) : mb(item.bytes)) : 'Empty'}</span>${item.cleanable ? `<button class="btn sm" data-clean="${esc(item.key)}" data-label="${esc(item.label)}" ${item.bytes || item.key === 'simulators' ? '' : 'disabled'}>Clear</button>` : '<span class="btn sm ghost" style="visibility:hidden">Clear</span>'}</span></div>`).join('')}</div>
      ${clearable ? `<div class="card-foot">${clearable >= 1e9 ? gb(clearable) : mb(clearable)} can be cleared</div>` : ''}`;
  };
  const loadDisk = async (fresh) => { $('#disk').innerHTML = skeleton(5); drawDisk(await get(`/api/disk${fresh ? '?fresh' : ''}`)); };
  loadDisk(false).catch(() => { $('#disk').innerHTML = empty('disk', 'Couldn’t measure the disk'); });
  const toggle = $('#push');
  if (toggle) toggle.onchange = () => togglePush(toggle.checked, $('#push-note'));
  const saveSetting = async (changes, note) => {
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify(changes) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { note.className = 'hint bad'; note.textContent = result.error ?? 'Couldn’t save that.'; return false; }
    return true;
  };
  $('#gh-status').onchange = async (event) => { await saveSetting({ githubStatus: event.target.checked }, $('#hook-note')); };
  const saveMac = async (changes, toggle) => {
    const result = await post('/api/setup', changes);
    if (result.error) { flash(result.error, true); if (toggle) toggle.checked = !toggle.checked; }
  };
  const login = $('#login-at-login');
  if (login) login.onchange = () => saveMac({ loginAtLogin: login.checked }, login);
  const bar = $('#menubar');
  if (bar) bar.onchange = () => saveMac({ menubar: bar.checked }, bar);
  const autoInstall = $('#auto-install');
  if (autoInstall) autoInstall.onclick = async (event) => {
    const button = event.target.closest('[data-auto-install]');
    if (!button) return;
    autoInstall.querySelectorAll('button').forEach((item) => item.classList.toggle('on', item === button));
    await saveSetting({ autoInstall: button.dataset.autoInstall }, $('#hook-note'));
  };
  $('#hook-form').onsubmit = async (event) => { event.preventDefault(); if ($('#hook').value && await saveSetting({ webhook: $('#hook').value.trim() }, $('#hook-note'))) route(); };
  $('#team-form').onsubmit = async (event) => {
    event.preventDefault();
    if (await saveSetting({ appleTeam: $('#team').value.trim().toUpperCase() }, $('#team-note'))) { expoCache.clear(); $('#team-note').className = 'hint ok'; $('#team-note').textContent = 'Saved.'; }
  };
  app.onclick = async (event) => {
    const test = event.target.closest('#push-test');
    if (test) { test.textContent = 'Sent'; await post('/api/push', { test: true }); }
    if (event.target.closest('#hook-test')) {
      const result = await post('/api/settings/webhook-test');
      $('#hook-note').className = `hint ${result.error ? 'bad' : 'ok'}`;
      $('#hook-note').textContent = result.error ?? 'Sent. Check the channel.';
    }
    if (event.target.closest('#hook-remove') && confirm('Stop sending build messages to this webhook?')) { if (await saveSetting({ webhook: '' }, $('#hook-note'))) route(); }
    if (event.target.closest('#disk-again')) loadDisk(true);
    const clean = event.target.closest('[data-clean]');
    if (clean && confirm(`Clear ${clean.dataset.label}?`)) {
      clean.disabled = true; clean.textContent = 'Clearing…';
      const response = await fetch('/api/disk/clean', { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify({ key: clean.dataset.clean }) });
      const result = await response.json().catch(() => ({}));
      if (response.ok) drawDisk(result); else { flash(result.error ?? 'Couldn’t clear that.', true); clean.disabled = false; clean.textContent = 'Clear'; }
    }
  };
}

function offline() {
  app.innerHTML = `${mobileTop()}<div class="card" style="margin-top:12vh">${empty('cloudoff', 'Can’t reach your Mac')}</div>`;
  every(5000, async () => { const response = await fetch('/api/projects', { cache: 'no-store' }); if (!response.ok) throw new Error('offline'); route(); return 'stop'; });
}
function notFound(what) {
  app.innerHTML = `<div class="card" style="margin-top:12vh">${empty('search', `No ${what} here`, '', `<a class="btn" href="#/">${icon('left')}Back to builds</a>`)}</div>`;
}

// Installing as an app, and notifications
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installHint() {
  const box = $('#install');
  let hidden = false;
  try { hidden = Boolean(localStorage.hideInstall); } catch {}
  if (!box || standalone() || hidden || !/iPhone|iPad/.test(navigator.userAgent)) return;
  box.innerHTML = `<div class="banner">${icon('phone')}<span>Add to Home Screen</span><button class="btn ghost sm" style="margin-left:auto" data-hide-install aria-label="Dismiss">${icon('x')}</button></div>`;
  box.querySelector('[data-hide-install]').onclick = () => { try { localStorage.hideInstall = '1'; } catch {} box.innerHTML = ''; };
}
const urlKey = (key) => Uint8Array.from(atob((key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  return (await navigator.serviceWorker.ready).pushManager.getSubscription();
}
async function togglePush(on, note) {
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (!on) {
      if (existing) { await post('/api/push', { remove: existing.endpoint }); await existing.unsubscribe(); }
      note.textContent = 'Off'; return;
    }
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked.');
    const { key } = await get('/api/push/key');
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) });
    await post('/api/push', { subscription: subscription.toJSON() });
    note.textContent = 'On';
  } catch (error) {
    note.textContent = error.message; $('#push').checked = false;
  }
}

// Router
const PAGES = {
  builds: buildsPage, build: (where) => buildPage(where.id), projects: projectsPage, pick: pickPage,
  project: projectPage, new: newBuildPage, insights: insightsPage, settings: settingsPage, setup: setupPage,
};
async function route() {
  routing.token += 1;
  routing.controller.abort(); routing.controller = new AbortController();
  routing.timers.forEach(clearTimeout); routing.timers = [];
  hideTip(); toast('');
  app.onclick = null; app.onchange = null;
  const where = parseRoute();
  app.dataset.page = where.page;
  renderShell(where);
  try {
    await PAGES[where.page](where);
    tick();
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (error.status === 404) notFound(where.page === 'build' ? 'build' : 'project'); else offline();
  }
}
function hideTip() { tip.style.display = 'none'; }
function showTip(target) {
  tip.replaceChildren();
  const value = document.createElement('b'); value.textContent = target.dataset.tip;
  tip.append(value, document.createTextNode(target.dataset.sub ?? ''));
  tip.style.display = 'block';
  const box = target.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, box.left + box.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
}
document.addEventListener('pointerover', (event) => { if (event.target.dataset?.tip !== undefined) showTip(event.target); else hideTip(); });
document.addEventListener('focusin', (event) => { if (event.target.dataset?.tip !== undefined) showTip(event.target); });
document.addEventListener('click', async (event) => {
  if (event.target.dataset?.tip !== undefined) { showTip(event.target); return; }
  const cancel = event.target.closest('[data-cancel]');
  const rebuild = event.target.closest('[data-rebuild]');
  const remove = event.target.closest('.remove-rule');
  const simulator = event.target.closest('[data-simulator]');
  const install = event.target.closest('[data-install]');
  if (simulator) {
    simulator.disabled = true;
    const result = await post(`/api/builds/${simulator.dataset.simulator}/simulator`);
    simulator.disabled = false;
    flash(result.error ?? `Opened ${result.bundle} in the Simulator on ${machineName()}.`, Boolean(result.error));
  }
  if (install) {
    install.disabled = true;
    const result = await post(`/api/builds/${install.dataset.install}/install`);
    if (result.error) { install.disabled = false; flash(result.error, true); }
    else { flash(result.installed?.error ?? (result.installed?.name ? `On ${result.installed.name}` : 'Installing…'), Boolean(result.installed?.error)); route(); }
  }
  if (cancel && confirm('Cancel this build?')) { await post(`/api/builds/${cancel.dataset.cancel}/cancel`); route(); }
  if (rebuild && confirm('Build this again?')) {
    const created = await post(`/api/builds/${rebuild.dataset.rebuild}/rebuild`);
    if (created.id) location.hash = `#/build/${created.id}`;
  }
  if (remove) { await post('/api/triggers', { project: remove.dataset.project, on: remove.dataset.on, branch: remove.dataset.branch, enabled: false }); route(); }
});
addEventListener('hashchange', () => { scrollTo(0, 0); route(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !['new', 'settings', 'setup'].includes(parseRoute().page)) { loadShell(); route(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadShell().finally(route);
