// macbuild dashboard. Hash routes, each a function that renders a page from the local server's JSON API; pages showing
// live work poll it, and a one-second ticker keeps elapsed times moving between polls. No framework: HTML strings, with
// every value from the server passed through esc().
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
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
  play: '<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.2"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15h4.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  dot: '<circle cx="12" cy="12" r="3.2"/>',
  globe: '<circle cx="12" cy="12" r="9.2"/><path d="M2.8 12h18.4M12 2.8c2.6 2.6 3.8 5.7 3.8 9.2s-1.2 6.6-3.8 9.2c-2.6-2.6-3.8-5.7-3.8-9.2S9.4 5.4 12 2.8"/>',
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
  UPDATE: 'Publish OTA update',
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
const store = (build) => build.action !== 'update' && (build.distribution === 'store' || submits(build));
const short = (build) => build.commit?.short ?? '';
const refOf = (build) => build.ref ?? '';
const subject = (build) => build.action === 'update' ? build.updateMessage || 'OTA update' : build.commit?.subject || 'Working copy';
const took = (build) => (build.startedAt && build.finishedAt ? span(build.finishedAt - build.startedAt) : '');
const TRIGGERS = { manual: 'Started by hand', push: 'Push to branch', pr: 'Pull request', nightly: 'Nightly build', rebuild: 'Rebuild', cli: 'CLI' };
const triggerOf = (build) => (build.by?.name ? `${esc(build.by.name)}${build.trigger === 'rebuild' ? ' <span class="faint">(rebuild)</span>' : ''}` : esc(TRIGGERS[build.trigger] ?? 'Started by hand'));
const kindOf = (build) => (build.action === 'update' ? `OTA · ${build.channel}` : submits(build) ? storeName(build.platform) : build.profile);
const platformName = (build) => (build.platform === 'all' ? 'iOS + Android' : build.platform === 'android' ? 'Android' : build.simulator ? 'iOS Simulator' : 'iOS');
const FILE_KINDS = { 'app.ipa': 'IPA', 'app.apk': 'APK', 'app.aab': 'AAB', 'app.tar.gz': '.tar.gz' };
const fileKind = (build) => FILE_KINDS[build.artifact ?? 'app.ipa'];
// A build's own file is on this Mac: reused builds point at the earlier build instead.
const hasFile = (build) => Boolean(build.action !== 'update' && build.ipaBytes && !build.expired && (build.status === 'success' || (build.status === 'failed' && build.buildCompleted) || (build.status === 'skipped' && !build.reusedFrom)));
const fixHtml = (text) => esc(text).replace(/`([^`]+)`/g, '<code>$1</code>');
const RULE_KINDS = { push: 'On every push', pr: 'Pull requests', nightly: 'Every night' };
const ruleTitle = (rule) => ((rule.on ?? 'push') === 'pr' ? 'Each pull request' : rule.on === 'nightly' ? `${esc(rule.branch)} every night at ${esc(rule.at)}` : `${esc(rule.branch)} on every push`);
const ruleDetail = (rule) => `${rule.platform === 'android' ? 'Android' : 'iOS'} · ${esc(rule.profile)}${rule.submit ? ` · ${storeName(rule.platform)}` : ''}${rule.skipUnchanged ? ' · reuses' : ''}${rule.error ? ` · <span class="warn">${esc(rule.error)}</span>` : ''}`;
const statusIcon = (status) => `<span class="st ${status}" role="img" aria-label="${STATUS[status][0]}">${icon(STATUS[status][1])}</span>`;
const badge = (status, label = STATUS[status][0]) => `<span class="badge ${status}">${esc(label)}</span>`;
const buildBadge = (build) => badge(build.status, build.action === 'update' && build.status === 'running' ? 'Publishing OTA' : build.status === 'failed' && build.buildCompleted ? 'Build ready · post-build step failed' : undefined);
const profileTag = (build) => (build.action === 'update' ? `<span class="tag">${icon('radio')}OTA · ${esc(build.channel)}</span>` : submits(build) ? `<span class="tag store">${icon('send')}${storeName(build.platform)}</span>` : `<span class="tag ${store(build) ? 'store' : ''}">${esc(build.profile)}</span>`);
const platformTag = (build) => (build.platform === 'android' ? '<span class="tag">Android</span>' : build.platform === 'all' ? '<span class="tag">iOS + Android</span>' : build.simulator ? '<span class="tag">Simulator</span>' : '');

// Project avatars: the app icon when the server found one in app.json, else a monogram on a gradient from the name.
const PALETTE = [['#8b8af5', '#5b5bd6'], ['#62b4ff', '#2f6fe0'], ['#48d6ac', '#0f9d79'], ['#ffbd59', '#f07c1d'], ['#ff86ad', '#dd4579'], ['#bf97ff', '#7d4fe0'], ['#6fd6ec', '#1a93b8'], ['#a3abbd', '#5d6577']];
function avatar(name, size = '') {
  const [a, b] = PALETTE[[...name].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 9973, 7) % PALETTE.length];
  const img = shell.projects.find((project) => project.name === name)?.icon ? `<img src="/api/projects/${encodeURIComponent(name)}/icon" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="av ${size}" style="--a:${a};--b:${b}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}${img}</span>`;
}

// Server
const shell = { projects: [], system: null };
const routing = { token: 0, controller: new AbortController(), timers: [], cleanups: [], first: true };
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
const ASK_CHOICES = [
  { provider: 'grok', model: 'grok-4.6', label: 'Grok 4.6' },
  { provider: 'grok', model: 'grok-4.7', label: 'Grok 4.7' },
  { provider: 'grok', model: 'grok-4.5', label: 'Grok 4.5' },
  { provider: 'codex', model: 'gpt-6.1-sol', label: 'Codex' },
];
const askChoices = () => (shell.system?.settings?.askChoices?.length ? shell.system.settings.askChoices : ASK_CHOICES);
const askValue = (item) => `${item.provider}:${item.model}`;
const parseAskValue = (value) => {
  const [provider, ...rest] = String(value || '').split(':');
  return { provider, model: rest.join(':') };
};
function askOptions(selected = '') {
  const items = askChoices();
  const groups = [];
  for (const item of items) {
    const name = item.group || '';
    if (!groups.length || groups[groups.length - 1].name !== name) groups.push({ name, items: [] });
    groups[groups.length - 1].items.push(item);
  }
  return groups.map((group) => {
    const options = group.items.map((item) => {
      const value = askValue(item);
      return `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(item.label)}</option>`;
    }).join('');
    return group.name ? `<optgroup label="${esc(group.name)}">${options}</optgroup>` : options;
  }).join('');
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
  overview: ['Overview', 'home'], builds: ['Builds', 'layers'], dev: ['Dev server', 'terminal'], branches: ['Branches', 'branch'], submissions: ['Submissions', 'send'],
  updates: ['OTA updates', 'radio'], channels: ['Channels', 'radio'], signing: ['Signing', 'shield'], environment: ['Environment', 'braces'], automation: ['Automation', 'bolt'],
};
const ALIASES = { activity: 'builds', insights: 'overview', devices: 'signing', metro: 'dev', 'dev-server': 'dev' };
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
      const mark = last && (active(last) || last.status === 'failed') ? statusIcon(last.status)
        : project.dev ? `<span class="led ${project.dev.prompt ? 'ask' : project.dev.status === 'running' ? 'idle' : 'busy'}" title="Dev server on port ${esc(project.dev.port)}"></span>` : '';
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
    ${(system.dev ?? []).map((item) => `<a class="now dev-now" href="#/p/${esc(item.project)}/dev"><span class="led ${item.prompt ? 'ask' : item.status === 'running' ? 'idle' : 'busy'}"></span><span><b>${esc(item.project)}</b> dev server · :${esc(item.port)}${item.external ? ' · terminal' : ''}${item.prompt ? ' · <span class="warn">asking</span>' : ''}</span></a>`).join('')}
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
    <span class="end">${build.status === 'failed' && build.buildCompleted ? buildBadge(build) : ''}${platformTag(build)}${profileTag(build)}<span class="dur num">${esc(took(build))}</span><span class="when">${ago(build.createdAt)}</span></span>
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
  const running = builds.filter((build) => ['running', 'cancelling'].includes(build.status));
  const queued = builds.filter((build) => build.status === 'queued').reverse();
  if (!running.length && !queued.length) return '';
  const kind = (build) => `${build.platform === 'android' ? 'Android · ' : ''}${kindOf(build)}`;
  return `<section class="card live">
    <div class="live-head"><span class="led busy"></span><b>${running.some((build) => build.action === 'update') ? running.length > 1 ? 'Building and publishing OTA' : 'Publishing OTA' : running.length > 1 ? 'Building and submitting' : running[0]?.submissionOnly ? 'Submitting now' : running.length ? 'Building now' : 'Up next'}</b></div>
    ${running.map((build) => `<a class="live-main" data-live-job="${esc(build.id)}" href="#/build/${esc(build.id)}">
      <span class="who">${avatar(build.project, 'lg')}<div><span class="title">${esc(subject(build))}</span><span class="meta">${esc(build.project)}<span class="sep"></span>${esc(refOf(build))}<span class="sep"></span><span class="mono">${esc(short(build))}</span><span class="sep"></span>${build.submissionOnly ? 'Upload · ' : ''}${esc(kind(build))}</span></div></span>
      <span class="live-progress">${progress(build)}</span></a>`).join('')}
    ${queued.map((build) => `<a class="next" href="#/build/${esc(build.id)}">${icon('clock', 'sm')}<span class="title">${esc(subject(build))}</span><span class="sep"></span><span>${esc(build.project)} · ${esc(refOf(build))} · ${esc(kind(build))}</span></a>`).join('')}
  </section>`;
}
function updateLive(box, builds) {
  if (!box) return;
  const key = builds.filter(active).map((build) => `${build.id}:${build.status}`).join(',');
  if (box.dataset.key === key) {
    for (const row of box.querySelectorAll('[data-live-job]')) {
      const running = builds.find((build) => build.id === row.dataset.liveJob && build.status === 'running');
      const label = row.querySelector('.phase-name');
      if (running && label && running.phases?.length) label.textContent = phaseName(running.phases.at(-1).name);
    }
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
    const key = `${build.status}|${build.phases?.length ?? 0}|${build.finishedAt ?? ''}|${build.ipaBytes ?? ''}|${build.ask?.threadId ?? ''}|${build.ask?.link ?? ''}`;
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
function askOpen(build, cls) {
  if (build.ask?.link) return `<a class="${cls}" href="${esc(build.ask.link)}" target="_blank" rel="noreferrer">${cls.includes('sm') ? '' : icon('braces')}Open in T3 Code</a>`;
  if (build.ask?.threadId) return `<span class="faint">Sent to agent</span>`;
  return `<button class="${cls}" data-ask="${esc(build.id)}" data-project="${esc(build.project)}">${cls.includes('sm') ? '' : icon('braces')}Send to agent</button>`;
}
function closeAskModal() { $('#ask-modal')?.remove(); }
async function sendAsk(id, { provider, model, remember = false }) {
  if (remember && provider) {
    const saved = await post('/api/settings', { askProvider: provider, askModel: model });
    if (shell.system) shell.system.settings = { ...(shell.system.settings || {}), ...saved };
  }
  const result = await post(`/api/builds/${id}/ask`, { provider, model });
  if (result.error && !result.threadId) flash(result.error, true);
  else { flash(result.link ? 'Opened in T3 Code' : 'Sent to agent'); route(); }
  return result;
}
function showAskModal({ id, project }) {
  closeAskModal();
  const settings = shell.system?.settings || {};
  const selected = settings.askModel ? `${settings.askProvider}:${settings.askModel}` : askValue(askChoices()[0]);
  const box = document.createElement('div');
  box.id = 'ask-modal';
  box.className = 'overlay';
  box.innerHTML = `<form class="sheet" id="ask-form">
    <h2>Send to agent</h2>
    <label class="field"><span>App</span><input class="input" value="${esc(project)}" readonly></label>
    <label class="field"><span>Model</span><select class="select" name="model">${askOptions(selected)}</select></label>
    <label class="toggle"><span>Remember as default</span><input class="switch" type="checkbox" name="remember" checked></label>
    <div class="sheet-actions"><button type="button" class="btn" id="ask-cancel">Cancel</button><button class="btn primary">Send</button></div>
  </form>`;
  document.body.append(box);
  const onKey = (event) => { if (event.key === 'Escape') finish(); };
  const finish = () => { window.removeEventListener('keydown', onKey); closeAskModal(); };
  window.addEventListener('keydown', onKey);
  box.addEventListener('click', (event) => { if (event.target === box) finish(); });
  $('#ask-cancel', box).onclick = finish;
  $('#ask-form', box).onsubmit = async (event) => {
    event.preventDefault();
    const send = box.querySelector('.btn.primary');
    send.disabled = true;
    const { provider, model } = parseAskValue(event.target.model.value);
    await sendAsk(id, { provider, model, remember: event.target.remember.checked });
    finish();
  };
}
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
    file && (build.status === 'success' || (build.status === 'failed' && build.buildCompleted)) && build.distribution === 'store' && (!submits(build) || build.status === 'failed') && !build.devClient && !build.simulator && !build.installable && !build.submissionOnly && !build.submission && (build.artifact ?? 'app.ipa') === (build.platform === 'android' ? 'app.aab' : 'app.ipa') ? `<button class="btn primary" data-submit="${esc(build.id)}" data-store="${storeName(build.platform)}">${icon('send')}Submit to ${storeName(build.platform)}</button>` : '',
    build.submissionOf ? `<a class="btn" href="#/build/${esc(build.submissionOf)}">Original build</a>` : '',
    build.action === 'update' ? `<a class="btn" href="#/p/${esc(build.project)}/updates">${icon('radio')}OTA updates</a>` : '',
    active(build) ? `<button class="btn danger" data-cancel="${esc(build.id)}" ${build.submissionOnly || build.action === 'update' ? 'data-upload="true"' : ''} ${build.status === 'cancelling' ? 'disabled' : ''}>${icon('ban')}${build.submissionOnly || build.action === 'update' ? 'Stop waiting' : 'Cancel'}</button>` : build.submissionOnly || build.action === 'update' ? '' : `<button class="btn" data-rebuild="${esc(build.id)}">${icon('rebuild')}Rebuild</button>`,
    build.status === 'failed' ? askOpen(build, 'btn') : '',
  ].join('');
  const person = build.by?.name ?? build.commit?.author;
  return `<header class="head"><div class="bhead">${avatar(build.project, 'lg')}<div><h1>${esc(subject(build))}</h1>
    <div class="facts">${buildBadge(build)}${platformTag(build)}${profileTag(build)}${took(build) ? `<span>${icon('timer', 'sm')}${esc(took(build))}</span>` : ''}<span>${icon('clock', 'sm')}${ago(build.createdAt)}</span>${person ? `<span>${icon('user', 'sm')}${esc(person)}</span>` : ''}</div></div></div>
    <div class="actions">${actions}</div></header>`;
}
function buildAlert(build) {
  if (['running', 'cancelling'].includes(build.status)) {
    return `<section class="card live" style="margin-bottom:20px"><div class="live-head"><span class="led busy"></span><b>${build.status === 'cancelling' ? 'Cancelling' : build.action === 'update' ? 'Publishing OTA' : build.submissionOnly ? 'Submitting existing build' : 'Building'}</b></div>
      <div class="live-main"><div class="live-progress">${progress(build)}</div></div></section>`;
  }
  if (build.status === 'queued') return `<div class="callout info" style="margin-bottom:20px">${icon('clock')}<div><b>${build.action === 'update' ? 'Waiting to publish OTA' : build.submissionOnly ? 'Waiting for another submission' : 'Waiting'}</b>${build.submissionOnly || build.action === 'update' ? '<p>Submissions and OTA publishes share an upload queue, independent of local builds.</p>' : ''}</div></div>`;
  if (build.status === 'failed') {
    const phase = build.phases?.at(-1)?.name;
    return `<div class="callout" style="margin-bottom:20px">${icon('alert')}<div><b>${build.buildCompleted ? 'Build succeeded; post-build step did not complete' : `Failed${phase ? ` during ${esc(phaseName(phase).toLowerCase())}` : ''}`}</b>
      ${build.hint ? `<p class="fix"><strong>Likely cause: ${esc(build.hint.title)}.</strong> ${fixHtml(build.hint.fix)}</p>` : ''}
      ${build.reason ? `<code>${esc(build.reason)}</code>` : ''}
      <div class="inline">${askOpen(build, 'btn sm')}<button class="btn sm" data-show-failure>Show the log</button></div></div></div>`;
  }
  if (build.status === 'skipped') {
    return `<div class="callout info" style="margin-bottom:20px">${icon('skip')}<div><b>Reused an earlier build</b>${build.reusedFrom ? `<span class="muted"><a class="link" href="#/build/${esc(build.reusedFrom)}">Open it</a></span>` : ''}</div></div>`;
  }
  if (build.action === 'update' && build.status === 'success') return `<div class="callout info" style="margin-bottom:20px">${icon('radio')}<div><b>OTA published to ${esc(build.channel)}</b><p>Only installed apps on this channel with a compatible runtime can receive this update. No store build was created.</p>${build.updateUrl ? `<a class="link" href="${esc(build.updateUrl)}">View update on Expo</a>` : ''}</div></div>`;
  if (build.submission || (build.submissionOnly && build.status === 'success')) return `<div class="callout info" style="margin-bottom:20px">${icon('send')}<div><b>Uploaded to ${build.platform === 'android' ? 'Google Play' : 'App Store Connect'}</b> ${build.submission ? `<a class="link" href="${esc(build.submission)}">View</a>` : ''}<p>The store may still be processing this build.</p></div></div>`;
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
    ['Platform', platformName(build)], ['Profile', esc(build.profile)], ['Distribution', build.action === 'update' ? 'OTA update' : build.distribution === 'store' ? 'Store' : 'Internal'],
    ['Version', build.app ? `${esc(build.app.version)} <span class="faint">(${esc(build.app.number)})</span>` : ''],
    ['Branch', `${esc(refOf(build))}${build.source === 'working' ? ' <span class="tag">local</span>' : ''}`],
    ['Commit', commit?.url ? `<a class="link mono" href="${esc(commit.url)}">${esc(commit.short)}</a>` : `<span class="mono">${esc(short(build) || '—')}</span>`],
    ['Pull request', build.pr ? `<a class="link" href="${esc(build.pr.url)}">#${esc(build.pr.number)}</a> <span class="faint">${esc(build.pr.title ?? '')}</span>` : ''],
    ['Checks', build.repo && commit?.hash ? '<span id="checks" class="faint">Loading…</span>' : ''],
    ['Started by', triggerOf(build)], ['Created', when(build.createdAt)],
    ['Waited', build.startedAt ? span(build.startedAt - build.createdAt) : ''], ['Took', active(build) && build.startedAt ? `<span class="num" data-since="${build.startedAt}"></span>` : esc(took(build))],
    ['Size', build.ipaBytes && !build.expired ? `${mb(build.ipaBytes)}${sizeChange(build)}` : build.expired ? '<span class="faint">Removed to save space</span>' : ''],
    ['Channel', esc(build.channel)], ['Environment', esc(build.environment)], ['OTA message', esc(build.updateMessage)], ['Runtime', build.runtime && !build.runtime.startsWith('file:') ? `<span class="mono">${esc(build.runtime.slice(0, 12))}</span>` : ''],
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
        <div class="pcard-top">${avatar(project.name, 'lg')}<div><b>${esc(project.name)}</b><small>${esc(project.repo || 'Local repository')}</small></div>${last ? buildBadge(last) : ''}</div>
        <div>${strip(mine)}<div class="strip-label"><span>${mine.length ? `Last ${Math.min(16, mine.length)} builds` : 'No builds yet'}</span><span>${last ? `Built ${ago(last.createdAt)}` : ''}</span></div></div>
        ${kv([['Version', release ? `${esc(release.version)} <span class="faint">(${esc(release.number)})</span>` : '<span class="faint">—</span>'], ['Working copy', `${esc(project.branch || 'detached')}${project.dirty ? ` <span class="warn">· ${project.dirty} changed</span>` : ''}`], ['Dev server', devSummary(project.dev)]])}
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
        <div class="actions">${latestDev ? `<a class="btn" href="#/build/${esc(latestDev.id)}">${icon('phone')}Install latest</a>` : ''}<a class="btn" href="#/p/${esc(name)}/updates">${icon('radio')}Push OTA</a><a class="btn primary" href="#/p/${esc(name)}/new">${icon('plus')}New build</a></div></header>`
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

// The OTA composer. Self-contained (esc and icon only): test/ui.test.mjs renders it on its own.
function updateForm(data) {
  const profiles = data.profiles.filter((profile) => profile.channel && !profile.developmentClient);
  if (!profiles.length) return '<p class="hint">Add a channel to a preview or production build profile in eas.json, and configure expo-updates before publishing OTA.</p>';
  const envOf = (profile) => profile.environment || (['production', 'preview', 'development'].includes(profile.channel) ? profile.channel : '');
  const main = (data.branches ?? []).find((branch) => ['main', 'master'].includes(branch.name))?.name ?? '';
  return `<form class="ota" id="ota-form" novalidate>
    <div class="ota-intro">${icon('radio')}<p>Ships JavaScript and assets to apps people already have. It can’t change native code: a new package with native code, a config plugin or an SDK upgrade needs a new build. Only installs with a compatible runtime receive it.</p></div>
    <fieldset class="ota-step"><legend><i>1</i>Channel</legend>
      <div class="ota-channels">${profiles.map((profile) => `<label class="ota-choice">
        <input type="radio" name="profile" value="${esc(profile.name)}" data-channel="${esc(profile.channel)}" data-environment="${esc(envOf(profile))}" required>
        <span class="ota-choice-body"><span class="ota-choice-name"><b>${esc(profile.channel)}</b>${profile.channel === 'production' ? `<span class="ota-live">${icon('user', 'xs')}Users</span>` : ''}</span><small data-last="${esc(profile.channel)}">${profile.name === profile.channel ? `${esc(profile.name)} profile` : `profile ${esc(profile.name)}`}</small></span>
      </label>`).join('')}</div>
      <input type="hidden" name="channel" required>
    </fieldset>
    <fieldset class="ota-step"><legend><i>2</i>Source</legend>
      <label class="ota-row"><span>Pushed branch</span><select class="select" name="ref" required><option value="">Choose a pushed branch</option>${(data.branches ?? []).map((branch) => `<option value="${esc(branch.name)}"${branch.name === main ? ' selected' : ''}>${esc(branch.name)} · ${esc(branch.short)}</option>`).join('')}</select></label>
      <div class="ota-commit" id="ota-commit" aria-live="polite"></div>
      <p class="hint">Publishes the commit on GitHub, not uncommitted files on this Mac.</p>
    </fieldset>
    <fieldset class="ota-step"><legend><i>3</i>Platforms and environment</legend>
      <div class="ota-pair">
        <div class="seg ota-platforms" role="radiogroup" aria-label="Platforms">${[['ios', 'iOS'], ['android', 'Android'], ['all', 'Both']].map(([value, label]) => `<label><input type="radio" name="platform" value="${value}"${value === 'ios' ? ' checked' : ''}><span>${label}</span></label>`).join('')}</div>
        <label class="ota-row compact"><span>Expo environment</span><select class="select" name="environment" required><option value="">Choose</option><option value="production">production</option><option value="preview">preview</option><option value="development">development</option></select></label>
      </div>
      <p class="hint">The build profile sets the app variant; the environment supplies EXPO_PUBLIC variables from Expo.</p>
    </fieldset>
    <fieldset class="ota-step"><legend><i>4</i>Message</legend>
      <textarea class="input ota-message" name="message" required maxlength="1000" rows="2" placeholder="Fix keyboard suggestions"></textarea>
      <p class="hint">Shown on Expo next to the update. Filled in from the commit; change it to say what users get.</p>
    </fieldset>
    <div class="ota-foot">
      <p class="ota-summary" id="ota-summary">Choose a channel to publish to.</p>
      <button class="btn primary" type="submit" id="ota-review">Review</button>
    </div>
    <div class="ota-confirm" id="ota-confirm" hidden></div>
    <p class="hint bad" id="ota-error" role="alert"></p>
  </form>`;
}
// Dev server: `npx expo start` for this project, run by the dashboard on the Mac. The terminal is Expo's own, streamed
// from the Mac; keys, prompt answers and typed text go back to it. Agents read the same log through macbuild dev / MCP.
const DEV_LIVE = ['starting', 'running', 'stopping'];
const devLive = (session) => Boolean(session && DEV_LIVE.includes(session.status));
const DEV_PLATFORMS = { ios: 'iOS', android: 'Android', web: 'Web' };
const devPrefs = (() => { try { return JSON.parse(localStorage.getItem('macbuild.dev') || '{}'); } catch { return {}; } })();
const saveDevPrefs = () => { try { localStorage.setItem('macbuild.dev', JSON.stringify(devPrefs)); } catch {} };
const devDot = (session) => (session?.prompt ? 'ask' : session?.status === 'running' ? 'idle' : devLive(session) ? 'busy' : session?.status === 'failed' ? 'bad' : '');
function devSummary(dev) {
  if (!dev) return '<span class="faint">—</span>';
  if (DEV_LIVE.includes(dev.status)) return `<span class="dev-inline"><span class="led ${dev.prompt ? 'ask' : dev.status === 'running' ? 'idle' : 'busy'}"></span>${dev.prompt ? 'Asking a question' : dev.status === 'running' ? (dev.external ? 'In a terminal' : 'Running') : 'Starting'} · :${esc(dev.port)}</span>`;
  return dev.readiness.ok ? `<span>Can run <span class="faint">(${dev.readiness.passed}/${dev.readiness.total})</span></span>` : `<span class="warn">${esc(dev.readiness.summary)}</span>`;
}
// The phone link's host: the Mac's tailnet name, or the Wi-Fi address Expo put in the link.
function devLinkHost(session) {
  if (session?.host) return session.host;
  const link = session?.urls?.app ?? '';
  try {
    const inner = new URL(link).searchParams.get('url');
    return new URL(inner || link.replace(/^exp:/, 'http:')).hostname;
  } catch { return ''; }
}
// Expo prints the web app on localhost. Opened from a phone or another computer, the same port on the Mac's name.
function devWebLink(session) {
  if (!session?.urls?.web) return '';
  try {
    const url = new URL(session.urls.web);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) { const host = devLinkHost(session); if (host && host !== 'localhost') url.hostname = host; }
    return url.href;
  } catch { return session.urls.web; }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const area = document.createElement('textarea'); area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  const done = document.execCommand('copy'); area.remove();
  return done;
}
let xtermLoading = null;
function loadXterm() {
  xtermLoading ??= new Promise((resolve, reject) => {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/vendor/xterm.css'; document.head.append(link);
    const script = (src) => new Promise((done, fail) => { const tag = document.createElement('script'); tag.src = src; tag.onload = done; tag.onerror = fail; document.head.append(tag); });
    script('/vendor/xterm.js').then(() => script('/vendor/addon-fit.js')).then(() => resolve(window.Terminal), (error) => { xtermLoading = null; reject(error); });
  });
  return xtermLoading;
}
function devTitle(session) {
  if (!session) return ['Not running', 'Start it to run Metro for this app on this Mac.'];
  const by = session.by?.name ? ` by ${esc(session.by.name)}` : '';
  const how = `${session.target === 'Expo Go' ? 'Opens in Expo Go' : 'Opens in your development build'} · ${esc(({ tailnet: 'Tailscale', lan: 'same Wi-Fi', localhost: 'this Mac only', tunnel: 'tunnel' })[session.connection] ?? session.connection)}`;
  const devices = session.devices?.length ? ` · ${esc(session.devices.join(', '))} connected` : '';
  if (session.external && devLive(session)) {
    const where = `Started in a terminal · process ${esc(session.pid ?? '')}${devices}`;
    if (session.status === 'starting') return ['Starting in a terminal…', where];
    if (session.status === 'stopping') return ['Stopping…', 'Asked it to stop, as Ctrl-C in its terminal would.'];
    return [`Running in a terminal on port ${esc(session.port)}`, `${where} · started <span data-since="${session.startedAt}">${ago(session.startedAt)}</span>`];
  }
  if (session.prompt && devLive(session)) return ['Waiting for your answer', `Expo is asking something below. ${how}`];
  if (session.status === 'running') return [`Running on port ${esc(session.port)}`, `${how} · started <span data-since="${session.startedAt}">${ago(session.startedAt)}</span>${by}${devices}`];
  if (session.status === 'starting') return ['Starting Metro…', `${how} · port ${esc(session.port)}${by}`];
  if (session.status === 'stopping') return ['Stopping…', 'Expo is closing its watchers.'];
  const ran = session.stoppedAt && session.startedAt ? ` for ${span(session.stoppedAt - session.startedAt)}` : '';
  if (session.status === 'failed') return ['Stopped with an error', `Last ran ${ago(session.startedAt)}${ran}${by}`];
  if (session.external) return ['Not running', `Last ran in a terminal ${ago(session.startedAt)}${ran}`];
  return ['Not running', `Last ran ${ago(session.startedAt)}${ran}${by}`];
}
function devBundles(session) {
  const items = Object.entries(session?.bundles ?? {});
  if (!items.length || !devLive(session)) return '';
  return `<div class="dev-bundles">${items.map(([platform, bundle]) => `<div class="dev-bundle ${bundle.failed ? 'bad' : bundle.done ? 'ok' : 'busy'}">
    <b>${DEV_PLATFORMS[platform] ?? esc(platform)}</b>
    ${bundle.failed ? '<span>Bundling failed</span>' : bundle.done ? `<span>Bundled in ${bundle.ms >= 1000 ? `${(bundle.ms / 1000).toFixed(1)} s` : `${bundle.ms} ms`}${bundle.modules ? ` <span class="faint">· ${plural(bundle.modules, 'module')}</span>` : ''}</span>`
      : `<span class="dev-bar" role="progressbar" aria-valuenow="${Math.round(bundle.percent)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${bundle.percent}%"></i></span><span class="num">${Math.round(bundle.percent)}%</span>`}
    <span class="faint" data-since="${bundle.at}">${ago(bundle.at)}</span></div>`).join('')}</div>`;
}
function devHero(view) {
  const { session, readiness } = view;
  const live = devLive(session);
  const [title, sub] = devTitle(session);
  const web = live ? devWebLink(session) : '';
  const blocked = readiness.checks.find((check) => check.level === 'bad');
  const chosen = devPrefs.connection && view.connections.some((item) => item.id === devPrefs.connection && item.available) ? devPrefs.connection : view.options.connection;
  const stopping = session?.status === 'stopping' ? 'disabled' : '';
  const actions = live && session.external
    ? `${web ? `<a class="btn" href="${esc(web)}" target="_blank" rel="noopener">${icon('globe')}Open web</a>` : ''}<button class="btn primary" type="button" data-dev="takeover" ${stopping}>${icon('terminal')}Run it here</button><button class="btn danger" type="button" data-dev="stop" ${stopping}>${icon('stop')}Stop</button>`
    : live
    ? `${web ? `<a class="btn" href="${esc(web)}" target="_blank" rel="noopener">${icon('globe')}Open web</a>` : ''}<button class="btn" type="button" data-dev="restart" ${stopping}>${icon('rebuild')}Restart</button><button class="btn danger" type="button" data-dev="stop" ${stopping}>${icon('stop')}Stop</button>`
    : `<button class="btn primary lg" type="button" data-dev="start" ${readiness.ok ? '' : 'disabled'}>${icon('play')}Start dev server</button>`;
  return `<section class="card dev-hero ${devDot(session)}">
    <div class="dev-hero-top">
      <div class="dev-state"><span class="led ${devDot(session)}"></span><div><h2>${title}</h2><p class="muted">${sub}</p></div></div>
      <div class="actions">${actions}</div>
    </div>
    ${devBundles(session)}
    ${live && session.external ? `<div class="dev-alert info">${icon('terminal')}<div><b>Found in a terminal</b><p>Someone ran <code>expo start</code> in this app’s folder. macbuild follows it: Metro’s bundles and your app’s logs show below, and you can reload the app or open its dev menu. Expo’s own output and other keys stay in that terminal. <b>Run it here</b> restarts it in macbuild on the same port, with the whole terminal here and on your phone.</p></div></div>` : ''}
    ${!live && session?.status === 'failed' && session.reason ? `<div class="dev-alert bad">${icon('alert')}<div><b>Expo stopped</b><p class="mono">${esc(session.reason)}</p></div></div>` : ''}
    ${live && session.lastError ? `<div class="dev-alert bad">${icon('alert')}<div><b>Last error <span class="faint" data-since="${session.lastError.at}">${ago(session.lastError.at)}</span></b><p class="mono">${esc(session.lastError.text)}</p></div></div>` : ''}
    ${!live && blocked ? `<div class="dev-alert">${icon('alert')}<div><b>${esc(readiness.summary)}</b><p>${esc(blocked.detail)}</p>${blocked.fix ? `<div class="dev-cmd"><code>${esc(blocked.fix)}</code><button class="btn sm ghost" type="button" data-copy="${esc(blocked.fix)}">${icon('copy')}Copy</button></div>` : ''}</div></div>` : ''}
    ${!live && readiness.ok ? `<div class="dev-start">
      <div class="field"><span>How your phone reaches it</span><div class="seg" role="radiogroup" aria-label="Connection">${view.connections.map((item) => `<button type="button" role="radio" aria-checked="${item.id === chosen}" data-conn="${item.id}" data-note="${esc(item.note)}" class="${item.id === chosen ? 'on' : ''}" ${item.available ? '' : 'disabled title="Tailscale isn’t running on this Mac"'}>${esc(item.label)}</button>`).join('')}</div>
        <small id="dev-conn-note">${esc(view.connections.find((item) => item.id === chosen)?.note ?? '')}</small></div>
      <div class="dev-checks">
        <label class="dev-check"><input type="checkbox" class="switch" id="dev-clear"><span>Clear Metro’s cache</span></label>
        ${readiness.web ? `<label class="dev-check"><input type="checkbox" class="switch" id="dev-open" ${devPrefs.open === false ? '' : 'checked'}><span>Open the web app when it’s ready</span></label>` : ''}
      </div>
    </div>` : ''}
    <div class="dev-cmd main"><span class="faint">$</span><code id="dev-command">${esc(live ? session.command : view.command)}</code><button class="btn sm ghost" type="button" data-copy="${esc(live ? session.command : view.command)}" aria-label="Copy the command">${icon('copy')}Copy</button></div>
  </section>`;
}
function devPrompt(session) {
  const prompt = devLive(session) ? session.prompt : null;
  if (!prompt) return '';
  const actions = prompt.kind === 'confirm'
    ? `<button class="btn ${prompt.default === 'yes' ? 'primary' : ''} sm" type="button" data-answer="y">Yes</button><button class="btn ${prompt.default === 'no' ? 'primary' : ''} sm" type="button" data-answer="n">No</button><span class="faint">Enter picks ${prompt.default === 'yes' ? 'Yes' : 'No'}</span>`
    : prompt.kind === 'select'
      ? prompt.options.map((option, index) => `<button class="btn sm ${option.selected ? 'on' : ''}" type="button" data-choose="${index}">${option.selected ? icon('right', 'xs') : ''}${esc(option.label)}</button>`).join('')
      : `<form class="dev-send inline" id="dev-answer"><input name="answer" value="${esc(prompt.value ?? '')}" autocomplete="off" aria-label="Answer"><button class="btn primary sm">Answer</button></form>`;
  return `<div class="dev-prompt" role="alert">${icon('alert')}<div class="dev-prompt-body"><b>Expo is asking</b><p>${esc(prompt.text)}</p><div class="dev-prompt-actions">${actions}</div></div></div>`;
}
function devPhone(view) {
  const session = view.session;
  if (!devLive(session) || !session.urls?.app) return '';
  const local = session.connection === 'localhost';
  return card(session.target === 'Expo Go' ? 'Open in Expo Go' : 'Open on your phone', 'phone', `<div class="card-body dev-phone">
    ${view.qr && !local ? `<div class="dev-qr">${view.qr}</div>` : ''}
    <p class="muted">${local ? 'This Mac only: a phone can’t reach it. Restart with Tailscale or Same Wi-Fi.' : `Scan with the iPhone’s camera, or tap below on the phone, to open it in ${session.target === 'Expo Go' ? 'Expo Go' : 'your development build'}.${session.connection === 'tailnet' ? ' The phone needs Tailscale on.' : session.connection === 'lan' ? ' The phone needs to be on the same Wi-Fi.' : ''}`}</p>
    <div class="dev-link mono">${esc(session.urls.app)}</div>
    <div class="dev-phone-actions"><a class="btn sm" href="${esc(session.urls.app)}">${icon('out')}Open link</a><button class="btn sm ghost" type="button" data-copy="${esc(session.urls.app)}">${icon('copy')}Copy</button></div>
  </div>`);
}
function devReadiness(view) {
  const ready = view.readiness;
  const mark = { ok: icon('check', 'sm ok'), bad: icon('cross', 'sm bad'), warn: icon('alert', 'sm warn'), info: icon('dot', 'sm faint') };
  return card('Can run a dev server', 'check', `<ul class="dev-ready">${ready.checks.map((check) => `<li data-level="${check.level}">${mark[check.level] ?? ''}<div><b>${esc(check.label)}</b><span>${fixHtml(check.detail)}</span>${check.fix ? `<code>${esc(check.fix)}</code>` : ''}</div></li>`).join('')}</ul>`,
    `<span class="dev-score ${ready.level}">${ready.ok ? 'Yes' : 'Not yet'} · ${ready.passed}/${ready.total}</span>`);
}
function devAgents(name, session) {
  const external = devLive(session) && session.external;
  const lines = [[`macbuild dev log ${name} --follow`, 'stream the log'], [`macbuild dev wait ${name}`, 'wait for the next bundle'], [`macbuild dev key ${name} r`, 'reload the app'],
    external ? [`macbuild dev takeover ${name}`, 'run it here instead'] : [`macbuild dev answer ${name} yes`, 'answer Expo']];
  return card('From a terminal or an agent', 'terminal', `<div class="card-body dev-agents">${lines.map(([command, note]) => `<div><code>${esc(command)}</code><span class="faint">${note}</span></div>`).join('')}
    <p class="muted">MCP: <code>macbuild mcp</code> has <code>dev_log</code>, <code>dev_wait</code> and <code>dev_send</code>. Log lines are numbered, so an agent reads on from the last one it saw.</p></div>`);
}
function devHistory(view) {
  const past = view.history.filter((item) => !devLive(item) || item.id !== view.session?.id);
  if (!past.length) return '';
  return card('Earlier sessions', 'clock', `<div class="rows">${past.slice(0, 6).map((item) => `<a class="row compact" href="/api/dev/${esc(view.project)}/log.txt?session=${esc(item.id)}" download title="Download this session’s log">
    <span class="led ${item.status === 'failed' ? 'bad' : ''}"></span><span class="main"><span class="title">${item.status === 'failed' ? 'Stopped with an error' : `Port ${esc(item.port)}`}</span><span class="meta">${ago(item.startedAt)}${item.stoppedAt ? `<span class="sep"></span>${span(item.stoppedAt - item.startedAt)}` : ''}${item.by?.name ? `<span class="sep"></span><span class="trunc">${esc(item.by.name)}</span>` : ''}</span></span>${icon('download', 'sm faint')}</a>`).join('')}</div>`);
}
function devOverview(view) {
  const { session, readiness } = view;
  const live = devLive(session);
  const [title] = devTitle(session);
  return `${kv([
    ['Status', `<span class="dev-inline"><span class="led ${devDot(session)}"></span>${live ? title.replace(/ on port.*/, '') : 'Not running'}</span>`],
    live ? ['Port', `<span class="mono">${esc(session.port)}</span>`] : ['Can run', readiness.ok ? `Yes <span class="faint">(${readiness.passed}/${readiness.total})</span>` : `<span class="warn">${esc(readiness.summary)}</span>`],
    ['Opens in', readiness.devClient ? 'Development build' : 'Expo Go'],
  ], 'list-kv')}<div class="card-body dev-mini">${live ? `<a class="btn sm" href="#/p/${esc(view.project)}/dev">${icon('terminal')}Terminal</a>${devWebLink(session) ? `<a class="btn sm" href="${esc(devWebLink(session))}" target="_blank" rel="noopener">${icon('globe')}Web</a>` : ''}`
    : `<a class="btn sm ${readiness.ok ? 'primary' : ''}" href="#/p/${esc(view.project)}/dev">${icon('play')}${readiness.ok ? 'Start' : 'See what’s missing'}</a>`}</div>`;
}
let devPending = null; // a tab opened on Start, pointed at the web app once Metro is ready (a later window.open would be blocked)
async function devSection(data, box) {
  const name = data.name;
  const token = routing.token;
  let view = await get(`/api/dev/${encodeURIComponent(name)}`);
  const live = devLive(view.session);
  const mode = () => (live && devPrefs.view !== 'text' ? 'term' : 'text');
  box.innerHTML = `<div id="dev-hero">${devHero(view)}</div>
    <div class="cols main-side dev-cols">
      <div class="stack">
        <section class="card dev-term-card">
          <div class="card-head"><h2>${icon('terminal')}${live ? (view.session.external ? 'Metro: bundles and app logs' : 'Terminal') : view.session ? 'Last session’s log' : 'Terminal'}</h2>
            <div class="dev-tools">${live ? `<div class="seg sm" role="tablist"><button type="button" data-view="term" class="${mode() === 'term' ? 'on' : ''}">Terminal</button><button type="button" data-view="text" class="${mode() === 'text' ? 'on' : ''}">Text</button></div>` : ''}
              ${view.session ? `<button class="btn sm ghost" type="button" data-copylog>${icon('copy')}Copy log</button><a class="btn sm ghost" href="/api/dev/${esc(name)}/log.txt" download aria-label="Download the log">${icon('download')}</a>` : ''}</div></div>
          <div id="dev-prompt">${devPrompt(view.session)}</div>
          <div class="dev-term" id="dev-term" ${mode() === 'term' ? '' : 'hidden'}></div>
          <pre class="log dev-text" id="dev-text" ${mode() === 'text' ? '' : 'hidden'}>${view.session ? '' : `<div class="dev-empty">${icon('terminal')}<b>Expo’s terminal shows here</b><span>Start the dev server to run <code>npx expo start</code> on ${esc(machineName())}.</span></div>`}</pre>
          ${live && view.session.external ? `<div class="dev-keys" role="toolbar" aria-label="Metro">${view.keys.filter((key) => ['reload', 'menu'].includes(key.id)).map((key) => `<button class="btn sm" type="button" data-key="${key.id}" title="Press ${esc(key.key)}"><kbd>${esc(key.key)}</kbd>${esc(key.label)}</button>`).join('')}<span class="faint dev-keys-note">Other keys work in its terminal.</span></div>` : ''}
          ${live && !view.session.external ? `<div class="dev-keys" role="toolbar" aria-label="Expo keys">${view.keys.map((key) => `<button class="btn sm" type="button" data-key="${key.id}" title="Press ${esc(key.key)}"><kbd>${esc(key.key)}</kbd>${esc(key.label)}</button>`).join('')}</div>
          <form class="dev-send" id="dev-send"><input id="dev-input" placeholder="Type to Expo and press Enter" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Type to Expo"><button class="btn sm" type="submit">Send</button>
            <button class="btn sm ghost" type="button" data-key="enter" title="Enter">↵</button><button class="btn sm ghost" type="button" data-key="up" aria-label="Up">↑</button><button class="btn sm ghost" type="button" data-key="down" aria-label="Down">↓</button><button class="btn sm ghost" type="button" data-key="ctrl-c" title="Ctrl-C stops Expo">⌃C</button></form>` : ''}
        </section>
      </div>
      <div class="stack" id="dev-side">${devPhone(view)}${devReadiness(view)}${devAgents(name, view.session)}${devHistory(view)}</div>
    </div>`;
  const redraw = async (session, fresh = false) => {
    if (token !== routing.token) return;
    const before = view.session;
    view = fresh ? await get(`/api/dev/${encodeURIComponent(name)}`) : { ...view, session };
    $('#dev-hero').innerHTML = devHero(view);
    $('#dev-prompt').innerHTML = devPrompt(view.session);
    if (fresh || before?.urls?.app !== view.session?.urls?.app) $('#dev-side').innerHTML = `${devPhone(view)}${devReadiness(view)}${devAgents(name, view.session)}${devHistory(view)}`;
    const web = devWebLink(view.session);
    if (devPending && view.session?.status === 'running' && web) { try { devPending.location.href = web; } catch {} devPending = null; }
    if (devPending && !devLive(view.session)) { try { devPending.close(); } catch {} devPending = null; }
  };
  const send = async (body) => {
    const result = await post(`/api/dev/${encodeURIComponent(name)}/input`, body);
    if (result.error) flash(result.error, true);
    else if (result.session) redraw(result.session);
    return result;
  };
  // The plain text view: numbered lines, held open on the server until there are new ones.
  let cursor = 0;
  const text = $('#dev-text');
  const addLines = (lines) => {
    if (!lines.length) return;
    const stick = text.scrollHeight - text.scrollTop - text.clientHeight < 40;
    text.querySelector('.dev-empty')?.remove();
    text.insertAdjacentHTML('beforeend', lines.map((line) => `<span data-n="${line.n}">${esc(line.text)}</span>`).join(''));
    while (text.childElementCount > 3000) text.firstElementChild.remove();
    if (stick) text.scrollTop = text.scrollHeight;
  };
  if (view.session) {
    get(`/api/dev/${encodeURIComponent(name)}/log?tail=1500`).then((log) => {
      addLines(log.lines); cursor = log.next;
      if (!log.lines.length && !live) text.innerHTML = '<div class="dev-empty"><b>No output was saved for this session.</b></div>';
      text.scrollTop = text.scrollHeight;
      if (!live) return;
      (async function follow() {
        while (token === routing.token) {
          const next = await get(`/api/dev/${encodeURIComponent(name)}/log?since=${cursor}&wait=20`).catch(() => null);
          if (!next) { await new Promise((done) => { setTimeout(done, 2000); }); continue; }
          addLines(next.lines); cursor = next.next;
          if (!DEV_LIVE.includes(next.status)) break;
          if (next.prompt && !next.lines.length) await new Promise((done) => { setTimeout(done, 1000); });
        }
      }());
    }).catch(() => {});
  }
  // The terminal view: xterm.js on Expo's raw output, streamed from the Mac; what you type goes back to Expo.
  let term = null;
  if (live) {
    const source = new EventSource(`/api/dev/${encodeURIComponent(name)}/stream`);
    const pending = [];
    source.onmessage = (event) => { const bytes = Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0)); if (term) term.write(bytes); else pending.push(bytes); };
    source.addEventListener('state', (event) => { const session = JSON.parse(event.data); if (session) redraw(session); });
    source.addEventListener('exit', () => { source.close(); setTimeout(() => { if (token === routing.token) route(); }, 600); });
    routing.cleanups.push(() => source.close());
    loadXterm().then((Terminal) => {
      if (token !== routing.token) return;
      term = new Terminal({ fontFamily: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace', fontSize: innerWidth < 600 ? 11 : 12.5, lineHeight: 1, scrollback: 5000, cursorBlink: false, convertEol: false,
        theme: { background: '#111114', foreground: '#d6d6dc', cursor: '#7d7cf3', selectionBackground: '#3a3a5a', black: '#111114', brightBlack: '#5f606c', green: '#3ccb84', red: '#ff6a6d', yellow: '#f0a83a', blue: '#7d7cf3', cyan: '#6fd6ec', magenta: '#bf97ff' } });
      const fit = new window.FitAddon.FitAddon();
      term.loadAddon(fit);
      term.open($('#dev-term'));
      for (const bytes of pending.splice(0)) term.write(bytes);
      if (!view.session.external) term.onData((data) => send({ text: data, enter: false })); // one in a terminal takes keys there
      let sized = '';
      const resize = () => {
        if ($('#dev-term').hidden) return;
        try { fit.fit(); } catch { return; }
        const size = `${term.cols}x${term.rows}`;
        if (size !== sized) { sized = size; post(`/api/dev/${encodeURIComponent(name)}/resize`, { cols: term.cols, rows: term.rows }); }
      };
      const observer = new ResizeObserver(() => { clearTimeout(observer.timer); observer.timer = setTimeout(resize, 120); });
      observer.observe($('#dev-term'));
      resize();
      routing.cleanups.push(() => { observer.disconnect(); term.dispose(); });
    }).catch(() => {
      // No xterm (the dashboard's dependencies weren't installed): the text view does the job.
      if (token !== routing.token) return;
      $('#dev-term').hidden = true; text.hidden = false;
      $('.dev-tools .seg')?.remove();
    });
  }
  // Not running here: it may be started elsewhere (a terminal, another device, an agent). Pick it up when it is.
  if (!live) every(5000, async () => { const fresh = await get(`/api/dev/${encodeURIComponent(name)}`); if (devLive(fresh.session)) { route(); return 'stop'; } return undefined; });
  app.onclick = async (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    const conn = target.closest('[data-conn]');
    if (conn && !conn.disabled) {
      $$('[data-conn]').forEach((button) => { button.classList.toggle('on', button === conn); button.setAttribute('aria-checked', String(button === conn)); });
      $('#dev-conn-note').textContent = conn.dataset.note;
      devPrefs.connection = conn.dataset.conn; saveDevPrefs();
      return;
    }
    if (target.dataset.copy !== undefined) { flash(await copyText(target.dataset.copy) ? 'Copied' : 'Couldn’t copy', false); return; }
    if (target.dataset.copylog !== undefined) {
      const log = await get(`/api/dev/${encodeURIComponent(name)}/log?tail=2000`);
      flash(await copyText(log.lines.map((line) => line.text).join('\n')) ? `Copied ${plural(log.lines.length, 'line')}` : 'Couldn’t copy', false);
      return;
    }
    if (target.dataset.view) {
      devPrefs.view = target.dataset.view; saveDevPrefs();
      $$('[data-view]').forEach((button) => button.classList.toggle('on', button === target));
      $('#dev-term').hidden = target.dataset.view !== 'term'; text.hidden = target.dataset.view !== 'text';
      if (target.dataset.view === 'text') text.scrollTop = text.scrollHeight; else term?.focus();
      return;
    }
    if (target.dataset.key) { await send({ key: target.dataset.key }); if (!$('#dev-term').hidden) term?.focus(); return; }
    if (target.dataset.answer) { await send({ key: target.dataset.answer }); return; }
    if (target.dataset.choose !== undefined) { await send({ choose: Number(target.dataset.choose) }); return; }
    const action = target.dataset.dev;
    if (!action) return;
    if (view.session?.external && action === 'stop' && !confirm('Stop the dev server running in its terminal? It stops as if you pressed Ctrl-C there.')) return;
    if (action === 'takeover' && !confirm(`Stop it in its terminal and run it here on port ${view.session?.port}? Phones reconnect when it’s back.`)) return;
    target.disabled = true;
    if (action === 'start') {
      const open = $('#dev-open')?.checked;
      if (view.readiness.web) { devPrefs.open = Boolean(open); saveDevPrefs(); }
      if (open) {
        devPending = window.open('', '_blank');
        try { devPending?.document.write(`<title>Starting ${esc(name)}…</title><meta name="color-scheme" content="light dark"><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#888">Starting Metro for ${esc(name)}…</body>`); } catch {}
      }
      const box = $('.dev-term-card');
      const cols = Math.max(60, Math.min(160, Math.floor(((box?.clientWidth ?? 800) - 24) / 7.6)));
      const result = await post(`/api/dev/${encodeURIComponent(name)}/start`, { connection: $('[data-conn].on')?.dataset.conn, clear: Boolean($('#dev-clear')?.checked), cols, rows: innerWidth < 600 ? 26 : 30 });
      if (result.error) { flash(result.error, true); target.disabled = false; try { devPending?.close(); } catch {} devPending = null; return; }
      route();
      return;
    }
    const result = await post(`/api/dev/${encodeURIComponent(name)}/${action}`, {});
    if (result.error) { flash(result.error, true); target.disabled = false; return; }
    if (action === 'restart' || action === 'takeover') route(); else redraw(result);
  };
  app.onsubmit = async (event) => {
    event.preventDefault();
    if (event.target.id === 'dev-send') {
      const input = $('#dev-input');
      const value = input.value;
      const result = await send({ text: value });
      if (!result.error) input.value = '';
    }
    if (event.target.id === 'dev-answer') await send({ text: new FormData(event.target).get('answer') ?? '' });
  };
}
const PROJECT_SECTIONS = {
  dev: (data, box) => devSection(data, box),
  async updates(data, box) {
    const updates = data.builds.filter((build) => build.action === 'update');
    const profiles = data.profiles.filter((profile) => profile.channel && !profile.developmentClient);
    const channels = [...new Set(profiles.map((profile) => profile.channel))];
    // What each channel holds: the newest update from this Mac, and the newest build that listens to it.
    const channelCard = (name, expo) => {
      const last = updates.find((build) => build.channel === name);
      const installed = data.builds.find((build) => build.action !== 'update' && build.status === 'success' && build.channel === name);
      const remote = expo?.channels.find((item) => item.name === name);
      const count = remote ? remote.branches.reduce((sum, branch) => sum + branch.updates, 0) : null;
      return `<button type="button" class="ota-chan" data-pick="${esc(name)}">
        <span class="ota-chan-head"><b>${esc(name)}</b>${remote?.paused ? '<span class="tag warn">paused</span>' : last && last.status === 'success' ? '<span class="tag store">live</span>' : ''}${count !== null ? `<span class="faint">${plural(count, 'update')} on Expo</span>` : ''}</span>
        <span class="ota-chan-line">${icon('radio', 'xs')}${last ? `<span class="trunc">${esc(subject(last))}</span><span class="faint">${ago(last.createdAt)}</span>` : '<span class="faint">No update from this Mac yet</span>'}</span>
        <span class="ota-chan-line">${icon('phone', 'xs')}${installed ? `<span class="trunc">${esc(installed.app?.version ? `${installed.app.version} (${installed.app.number})` : installed.profile)} build${installed.runtime && !installed.runtime.startsWith('file:') ? ` · runtime <span class="mono">${esc(installed.runtime.slice(0, 10))}</span>` : ''}</span><span class="faint">${ago(installed.createdAt)}</span>` : '<span class="faint">No build here listens to it yet</span>'}</span>
      </button>`;
    };
    const filter = prefs.otaChannel && channels.includes(prefs.otaChannel) ? prefs.otaChannel : 'all';
    const shown = updates.filter((build) => filter === 'all' || build.channel === filter);
    box.innerHTML = `<div class="cols main-side ota-page">
      <section class="card"><div class="card-head"><h2>${icon('radio')}Publish an update</h2></div><div class="card-body">${updateForm(data)}</div></section>
      <div class="ota-side">
        <section class="card"><div class="card-head"><h2>${icon('layers')}Channels</h2></div><div class="ota-chans" id="ota-chans">${channels.map((name) => channelCard(name, null)).join('') || '<p class="hint" style="padding:16px">No channels in eas.json yet.</p>'}</div></section>
      </div>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>${icon('clock')}History</h2>${channels.length > 1 ? `<div class="seg" role="tablist">${['all', ...channels].map((name) => `<button type="button" data-ota-filter="${esc(name)}" class="${filter === name ? 'on' : ''}">${name === 'all' ? 'All' : esc(name)}<span class="count">${(name === 'all' ? updates : updates.filter((build) => build.channel === name)).length}</span></button>`).join('')}</div>` : ''}</div>
      ${shown.length ? `<div class="rows">${shown.map((build) => buildRow(build, { project: false })).join('')}</div>` : empty('radio', filter === 'all' ? 'No OTA updates yet' : `No updates on ${esc(filter)} yet`, 'Updates you publish from here show up with their commit, channel and status.')}
    </section>`;
    const chans = $('#ota-chans');
    expoOf(data.name).then((expo) => { if (chans?.isConnected) chans.innerHTML = channels.map((name) => channelCard(name, expo)).join(''); }).catch(() => {});
    const form = $('#ota-form');
    app.onclick = (event) => {
      const pick = event.target.closest('[data-pick]');
      const filterButton = event.target.closest('[data-ota-filter]');
      if (filterButton) { prefs.otaChannel = filterButton.dataset.otaFilter; PROJECT_SECTIONS.updates(data, box); return; }
      if (pick && form) {
        const input = [...form.elements.profile].find((item) => item.dataset.channel === pick.dataset.pick);
        if (input) { input.checked = true; input.dispatchEvent(new Event('change', { bubbles: true })); form.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
    };
    if (!form) return;
    const confirmBox = $('#ota-confirm');
    form.querySelectorAll('[data-last]').forEach((line) => {
      const last = updates.find((build) => build.channel === line.dataset.last && build.status === 'success');
      if (last) line.textContent = `Now: ${subject(last)} · ${ago(last.createdAt)}`;
    });
    let autoMessage = '';
    const branchOf = () => data.branches.find((branch) => branch.name === form.elements.ref.value);
    const chosen = () => form.querySelector('input[name="profile"]:checked');
    const platformName = (value) => ({ ios: 'iOS', android: 'Android', all: 'iOS and Android' })[value] ?? value;
    const sync = () => {
      const profile = chosen();
      const branch = branchOf();
      form.elements.channel.value = profile?.dataset.channel ?? '';
      $('#ota-commit').innerHTML = branch
        ? `<span class="mono">${esc(branch.short)}</span><span class="trunc"><b>${esc(branch.subject ?? '')}</b></span><span class="faint">${esc(branch.author ?? '')}${branch.date ? ` · ${ago(branch.date)}` : ''}</span>${branch.pr ? `<span class="tag">${icon('pr', 'xs')}#${branch.pr.number}</span>` : ''}`
        : '';
      // The commit's subject is a good first message; once someone edits it, it stays theirs.
      const message = form.elements.message;
      if (branch && (!message.value || message.value === autoMessage)) { autoMessage = branch.subject ?? ''; message.value = autoMessage; }
      const platform = form.elements.platform.value;
      $('#ota-summary').innerHTML = profile
        ? `To <b>${esc(profile.dataset.channel)}</b> · ${esc(platformName(platform))}${branch ? ` · <span class="mono">${esc(branch.name)}@${esc(branch.short)}</span>` : ''}`
        : 'Choose a channel to publish to.';
      $('#ota-review').textContent = profile ? `Review update to ${profile.dataset.channel}` : 'Review';
      const steps = form.querySelectorAll('.ota-step');
      [Boolean(profile), Boolean(branch), Boolean(form.elements.environment.value), Boolean(message.value.trim())].forEach((done, index) => { steps[index]?.toggleAttribute('data-done', done); });
      confirmBox.hidden = true;
      $('#ota-review').hidden = false;
      $('#ota-error').textContent = '';
    };
    form.addEventListener('change', (event) => {
      if (event.target.name === 'profile') form.elements.environment.value = event.target.dataset.environment || form.elements.environment.value;
      sync();
    });
    form.elements.message.addEventListener('input', () => { confirmBox.hidden = true; $('#ota-review').hidden = false; form.querySelectorAll('.ota-step')[3]?.toggleAttribute('data-done', Boolean(form.elements.message.value.trim())); });
    sync();
    form.onsubmit = (event) => {
      event.preventDefault();
      const profile = chosen();
      if (!profile) { $('#ota-error').textContent = 'Choose a channel.'; return; }
      if (!form.reportValidity()) return;
      const values = Object.fromEntries(new FormData(form));
      const branch = branchOf();
      const production = values.channel === 'production';
      // Publishing reaches people's phones, so it takes a second, deliberate click.
      confirmBox.innerHTML = `<div class="ota-confirm-head">${icon(production ? 'alert' : 'radio')}<b>Publish to ${esc(values.channel)}?</b></div>
        <dl class="ota-confirm-list">
          <div><dt>Ships</dt><dd><span class="mono">${esc(values.ref)}@${esc(branch?.short ?? '')}</span> ${esc(branch?.subject ?? '')}</dd></div>
          <div><dt>To</dt><dd>${esc(platformName(values.platform))} installs on <b>${esc(values.channel)}</b>, profile ${esc(values.profile)}, environment ${esc(values.environment)}</dd></div>
          <div><dt>Message</dt><dd>${esc(values.message)}</dd></div>
        </dl>
        <p class="hint">${production ? 'People using the app get it the next time they open it. ' : ''}Only installs with a compatible runtime receive it. A later update can replace it, but it can’t be taken back from phones that already have it.</p>
        <div class="ota-confirm-do"><button type="button" class="btn ghost" data-ota-back>Back</button><button type="button" class="btn ${production ? 'danger-fill' : 'primary'}" data-ota-publish>${icon('radio')}Publish to ${esc(values.channel)}</button></div>`;
      confirmBox.hidden = false;
      $('#ota-review').hidden = true; // one way to publish at a time: the confirmation's own button
      confirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      confirmBox.querySelector('[data-ota-back]').onclick = () => { confirmBox.hidden = true; $('#ota-review').hidden = false; };
      confirmBox.querySelector('[data-ota-publish]').onclick = async (click) => {
        const button = click.currentTarget;
        button.disabled = true;
        try {
          const result = await post(`/api/projects/${encodeURIComponent(data.name)}/updates`, values);
          if (result.error) { $('#ota-error').textContent = result.error; confirmBox.hidden = true; }
          else location.hash = `#/build/${result.id}`;
        } catch (error) { $('#ota-error').textContent = error.message; }
        finally { button.disabled = false; }
      };
    };
    if (updates.some(active)) every(3000, async () => { const fresh = await get(`/api/projects/${encodeURIComponent(data.name)}`); if (!fresh.builds.filter((build) => build.action === 'update').some(active)) { route(); return 'stop'; } return undefined; });
  },
  async overview(data, box) {
    const name = data.name;
    const week = data.builds.filter((build) => Date.now() - build.createdAt < 7 * DAY).length;
    const dev = data.builds.find((build) => build.action !== 'update' && !store(build) && !active(build)); const prod = data.builds.find((build) => store(build) && !active(build));
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
          ${card('Dev server', 'terminal', `<div id="pdev">${skeleton(2)}</div>`, more(`#/p/${esc(name)}/dev`, 'Open'))}
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
    get(`/api/dev/${encodeURIComponent(name)}`).then((dev) => { if ($('#pdev')) $('#pdev').innerHTML = devOverview(dev); }).catch(() => {});
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
  const unfinished = setup.flow && !setup.flow.done;
  if (!unfinished && !miss) return;
  const text = unfinished ? (setup.flow.started ? 'Finish setting up macbuild' : 'Set up macbuild: find your apps, set up signing and try a build') : `${plural(miss, 'setup item')} to fix`;
  box.innerHTML = `<div class="banner">${icon(unfinished ? 'cube' : 'mac')}<span>${text}</span><a class="btn sm" href="#/setup" style="margin-left:auto">${unfinished ? (setup.flow.started ? 'Continue' : 'Start') : 'Guide'}</a><button class="btn ghost sm" data-hide-setup aria-label="Dismiss">${icon('x')}</button></div>`;
  box.querySelector('[data-hide-setup]').onclick = async () => { await post('/api/setup', { setupComplete: true }); box.innerHTML = ''; };
}
function doctorRows(items) {
  return `<div class="rows">${(items ?? []).map((item) => `<div class="row compact">
    <span class="st ${item.status === 'ok' ? 'success' : item.status === 'miss' ? 'failed' : ''}">${icon(item.status === 'ok' ? 'check' : item.status === 'miss' ? 'cross' : 'skip')}</span>
    <span class="main"><span class="title">${esc(item.label)}</span><span class="meta wrap">${esc(item.detail)}</span></span>
  </div>`).join('')}</div>`;
}

// Setup: lib/setup.mjs sends a screen (title, the agent's words, fields, commands, buttons) and this draws it. The
// same screens are the terminal's `macbuild setup`; whatever the agent asks becomes a choice, a checklist or a text box.
const NOTE_ICON = { ok: 'check', bad: 'cross', warn: 'alert', info: 'dot' };
ICONS.dot = '<circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/>';
ICONS.sparkle = '<path d="M12 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z"/><path d="M19 15.5c.3 1.8.9 2.4 2.5 2.7-1.6.3-2.2.9-2.5 2.7-.3-1.8-.9-2.4-2.5-2.7 1.6-.3 2.2-.9 2.5-2.7z"/>';
ICONS.terminal = '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>';
ICONS.copy = '<rect x="8.5" y="8.5" width="12" height="12" rx="2.2"/><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>';
function setupNotes(notes) {
  if (!notes?.length) return '';
  const plain = notes.filter((note) => !note.code);
  const code = notes.filter((note) => note.code);
  return `${plain.length ? `<ul class="wz-notes">${plain.map((note) => `<li class="${esc(note.tone)}">${icon(NOTE_ICON[note.tone] ?? 'dot')}<span>${esc(note.text)}</span></li>`).join('')}</ul>` : ''}
    ${code.length ? `<div class="wz-next">${code.map((note) => `<div class="wz-cmd"><code>${esc(note.code)}</code><span>${esc(note.text)}</span><button type="button" class="btn ghost sm" data-copy="${esc(note.code)}" aria-label="Copy">${icon('copy')}</button></div>`).join('')}</div>` : ''}`.trim();
}
function setupField(field, attached = []) {
  const name = esc(field.id);
  const help = field.help ? `<small>${esc(field.help)}</small>` : '';
  if (field.kind === 'select' || field.kind === 'multi') {
    const multi = field.kind === 'multi';
    const chosen = new Set(multi ? field.value ?? [] : [field.value]);
    // An answer a fix needs (a bundle identifier) sits inside that fix's card.
    const inner = (option) => attached.filter((item) => item.attach.option === option.value);
    return `<fieldset class="wz-field" data-field="${name}" data-kind="${field.kind}"><legend>${esc(field.label)}</legend>${help}
      <div class="wz-options">${field.options.map((option) => `<div class="wz-option${option.disabled ? ' off' : ''}"><label class="wz-row">
        <input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${esc(option.value)}" ${chosen.has(option.value) || (multi && option.disabled && option.badge) ? 'checked' : ''} ${option.disabled ? 'disabled' : ''}>
        <span class="wz-box" aria-hidden="true"></span>
        <span class="wz-text"><span class="wz-label">${option.tag ? `<span class="wz-tag">${esc(option.tag)}</span>` : ''}${esc(option.label)}${option.badge ? `<span class="wz-badge">${esc(option.badge)}</span>` : ''}</span>${option.detail ? `<span class="wz-detail">${esc(option.detail)}</span>` : ''}</span>
      </label>${inner(option).map((item) => `<div class="wz-inline" data-field="${esc(item.id)}" data-kind="text"><input class="input mono" name="${esc(item.id)}" value="${esc(item.value ?? '')}" placeholder="${esc(item.placeholder ?? '')}" aria-label="${esc(item.label)}" autocomplete="off" autocapitalize="off" spellcheck="false">${item.help ? `<small>${esc(item.help)}</small>` : ''}</div>`).join('')}</div>`).join('')}</div></fieldset>`;
  }
  if (field.kind === 'confirm') {
    return `<label class="wz-field wz-switch toggle" data-field="${name}" data-kind="confirm"><span><b>${esc(field.label)}</b>${field.help ? `<small>${esc(field.help)}</small>` : ''}</span><input class="switch" type="checkbox" name="${name}" ${field.value !== false ? 'checked' : ''}></label>`;
  }
  return `<label class="wz-field" data-field="${name}" data-kind="text"><span class="wz-legend">${esc(field.label)}</span>${help}
    <input class="input" name="${name}" value="${esc(field.value ?? '')}" placeholder="${esc(field.placeholder ?? '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
}
function setupCommands(commands) {
  if (!commands?.length) return '';
  const needed = commands.filter((command) => !command.optional || command.status === 'done');
  const extra = commands.filter((command) => command.optional && command.status !== 'done');
  const rows = (items) => `<div class="wz-commands">${items.map(setupCommand).join('')}</div>`;
  const what = extra.some((command) => command.id.startsWith('signing:')) ? 'For TestFlight, Google Play and Android builds' : 'Optional';
  return `${needed.length ? rows(needed) : ''}${extra.length ? `<details class="wz-more"${needed.length ? '' : ' open'}><summary>${icon('right', 'sm')}${what}<span class="faint">${extra.length}</span></summary>${rows(extra)}</details>` : ''}`;
}
function setupCommand(command) {
  return `<div class="wz-command ${esc(command.status)}" data-command="${esc(command.id)}">
    <span class="st ${command.status === 'done' ? 'success' : command.status === 'failed' ? 'failed' : ''}">${icon(command.status === 'done' ? 'check' : command.status === 'failed' ? 'cross' : 'clock')}</span>
    <div class="wz-command-main"><b>${esc(command.label)}</b>${command.status === 'failed' ? '<span class="wz-badge bad">Didn’t finish</span>' : ''}${command.detail ? `<p>${esc(command.detail)}</p>` : ''}</div>
    ${command.status === 'done' ? '' : `<code>${esc(command.display)}</code>`}
    ${command.status === 'done' ? '' : `<div class="wz-command-do">
      <button type="button" class="btn sm" data-terminal="${esc(command.id)}">${icon('terminal')}Open Terminal</button>
      <button type="button" class="btn ghost sm" data-copy="${esc(command.line)}" aria-label="Copy the command">${icon('copy')}</button>
    </div>`}
  </div>`;
}
function setupBusy(busy) {
  const lines = busy.activity ?? [];
  return `<div class="wz-busy" aria-live="polite">
    <div class="wz-busy-head"><span class="wz-orbit${busy.agent ? ' agent' : ''}">${icon(busy.agent ? 'sparkle' : 'cube')}</span>
      <div><b>${esc(busy.label)}</b><span class="faint num" data-since="${busy.startedAt}">${span(Date.now() - busy.startedAt)}</span></div></div>
    <ol class="wz-feed">${lines.map((line, index) => `<li class="${index === lines.length - 1 ? 'now' : ''}">${esc(line)}</li>`).join('') || '<li class="now">Starting…</li>'}</ol>
  </div>`;
}
function setupStepper(view) {
  return `<ol class="wz-steps">${view.steps.map((step, index) => `<li class="${step.state}">${step.state === 'done' && view.step !== 'done' ? `<button type="button" data-goto="${esc(step.id)}">` : '<span>'}<i>${step.state === 'done' ? icon('check') : index + 1}</i><em>${esc(step.label)}</em>${step.state === 'done' && view.step !== 'done' ? '</button>' : '</span>'}</li>`).join('')}</ol>`;
}
function setupCard(view) {
  const buttons = view.buttons ?? [];
  const main = view.fields.filter((field) => !field.for && !field.attach);
  const attached = (field) => view.fields.filter((item) => item.attach?.field === field.id);
  const tucked = (id) => view.fields.filter((field) => field.for === id);
  const primary = buttons.find((button) => button.primary) ?? buttons[0];
  const others = buttons.filter((button) => button !== primary);
  const button = (item, cls) => (item.href ? `<a class="btn ${cls}" href="${esc(item.href)}">${esc(item.label)}</a>`
    : `<button type="${item === primary ? 'submit' : 'button'}" class="btn ${cls}" data-button="${esc(item.id)}" ${tucked(item.id).length ? 'data-reveal' : ''}>${esc(item.label)}</button>`);
  const done = view.step === 'done';
  return `<form class="wz-card" id="wz-form" novalidate>
    ${done ? `<div class="wz-done">${icon('check')}</div>` : ''}
    <h1>${esc(view.title)}</h1>
    ${view.lead ? (view.by
      ? `<figure class="wz-agent"><figcaption>${icon('sparkle')}${esc(view.by)}</figcaption><blockquote>${esc(view.lead)}</blockquote></figure>`
      : `<p class="wz-lead">${esc(view.lead)}</p>`) : ''}
    ${view.busy ? setupBusy(view.busy) : ''}
    ${view.qr ? `<div class="wz-qr">${view.qrSvg ? `<div class="wz-qr-code" role="img" aria-label="QR code for ${esc(view.qr.url)}">${view.qrSvg}</div>` : ''}<div class="wz-qr-text"><b>Scan with your iPhone’s camera</b><p>or open this link in Safari:</p><div class="wz-cmd"><code>${esc(view.qr.url)}</code><button type="button" class="btn ghost sm" data-copy="${esc(view.qr.url)}" aria-label="Copy the link">${icon('copy')}</button></div></div></div>` : ''}
    <div class="wz-live">${setupNotes(view.notes)}</div>
    ${main.map((field) => setupField(field, attached(field))).join('')}
    <div class="wz-live-commands">${setupCommands(view.commands)}</div>
    ${others.filter((item) => tucked(item.id).length).map((item) => `<div class="wz-tucked" data-for="${esc(item.id)}" hidden>${tucked(item.id).map(setupField).join('')}<button type="button" class="btn" data-button="${esc(item.id)}" data-go>${esc(item.label)}</button></div>`).join('')}
    ${buttons.length || view.back ? `<div class="wz-actions">
      ${view.back && !view.busy ? `<button type="button" class="btn ghost" data-back="${esc(view.back)}">${icon('left')}Back</button>` : '<span></span>'}
      <div class="wz-buttons">${others.map((item) => button(item, view.busy ? '' : 'ghost')).join('')}${primary ? button(primary, view.busy ? '' : 'primary') : ''}</div>
    </div>` : ''}
  </form>`;
}
function setupValues(form) {
  const values = {};
  form.querySelectorAll('[data-field]').forEach((box) => {
    const name = box.dataset.field; const kind = box.dataset.kind;
    if (kind === 'multi') values[name] = [...box.querySelectorAll('input:checked:not(:disabled)')].map((input) => input.value);
    else if (kind === 'select') values[name] = box.querySelector('input:checked')?.value ?? '';
    else if (kind === 'confirm') values[name] = box.querySelector('input').checked;
    else values[name] = box.querySelector('input').value;
  });
  return values;
}
async function setupPage() {
  let view = await get('/api/setup/flow');
  let shape = '';
  const draw = (next) => {
    view = next;
    // Same step and nothing to type into changed: refresh only what moves, so half-filled answers stay.
    const key = JSON.stringify([view.step, Boolean(view.busy), view.title, view.fields.map((field) => [field.id, field.options?.length]), view.buttons.map((item) => item.id), view.commands.map((item) => item.id)]);
    if (key === shape && !view.busy && $('#wz-form')) {
      $('.wz-live').innerHTML = setupNotes(view.notes);
      const open = $('.wz-more')?.open;
      $('.wz-live-commands').innerHTML = setupCommands(view.commands);
      if (open && $('.wz-more')) $('.wz-more').open = true;
      return;
    }
    if (key === shape && view.busy && $('.wz-busy')) { $('.wz-busy').outerHTML = setupBusy(view.busy); tick(); return; }
    shape = key;
    app.innerHTML = `<div class="wizard">
      <header class="wz-top"><a class="brand" href="#/"><span class="mark">${icon('cube')}</span>macbuild<span class="tag">setup</span></a><a class="btn ghost sm" href="#/">${view.step === 'done' ? 'Close' : 'Finish later'}</a></header>
      ${setupStepper(view)}
      ${setupCard(view)}
    </div>`;
    tick();
    const first = $('#wz-form input.input');
    if (first && matchMedia('(min-width: 720px)').matches) first.focus();
  };
  const send = async (button, values = {}, from) => {
    const form = $('#wz-form');
    form?.querySelectorAll('button').forEach((item) => { item.disabled = true; });
    from?.classList.add('working');
    const response = await fetch('/api/setup/flow', { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify({ step: view.step, button, values }) });
    const result = await response.json().catch(() => ({}));
    if (result.error) flash(result.error, true);
    draw(result.view ?? (result.step ? result : await get('/api/setup/flow')));
    if (view.step !== 'done') loadShell();
  };
  draw(view);
  every(() => (view.busy ? 900 : view.commands.some((item) => item.status !== 'done') ? 2500 : 0) || 5000, async () => {
    if (!view.busy && !view.commands.some((item) => item.status !== 'done')) return;
    draw(await get('/api/setup/flow'));
  });
  app.onsubmit = (event) => {
    event.preventDefault();
    const primary = view.buttons.find((item) => item.primary) ?? view.buttons[0];
    if (primary && !primary.href) send(primary.id, setupValues(event.target), event.submitter);
  };
  app.onclick = async (event) => {
    const target = event.target.closest('button, a');
    if (!target) return;
    if (target.dataset.copy !== undefined) {
      try { await navigator.clipboard.writeText(target.dataset.copy); flash('Copied'); } catch { flash(target.dataset.copy); }
      return;
    }
    if (target.dataset.terminal) {
      target.disabled = true;
      const result = await post('/api/setup/terminal', { id: target.dataset.terminal });
      target.disabled = false;
      if (result.error) {
        try { if (result.line) await navigator.clipboard.writeText(result.line); } catch {}
        flash(result.line ? `${result.error} It’s copied.` : result.error, true);
      } else flash(`Opened Terminal on ${machineName()}`);
      return;
    }
    if (target.dataset.back || target.dataset.goto) { send('back', { to: target.dataset.back || target.dataset.goto }, target); return; }
    if (target.dataset.button && target.type !== 'submit') {
      const tucked = target.hasAttribute('data-reveal') && $(`.wz-tucked[data-for="${target.dataset.button}"]`);
      if (tucked && tucked.hidden) { tucked.hidden = false; tucked.querySelector('input')?.focus(); target.hidden = true; return; }
      send(target.dataset.button, setupValues($('#wz-form')), target);
    }
  };
  app.onkeydown = (event) => {
    // Enter in a tucked-away field (the folder to search) runs its own button, not the step's.
    const tucked = event.target.closest?.('.wz-tucked');
    if (event.key === 'Enter' && tucked) { event.preventDefault(); tucked.querySelector('[data-go]').click(); }
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
      ${card('Agent', 'braces', `<div class="setting"><div><b>Default model</b><small>T3 agents signed in on this Mac. Send opens T3 Code in that app’s folder.</small></div>
        <select class="select" id="ask-model" aria-label="Default agent model">
          <option value="">Ask each time</option>
          ${askOptions(settings.askModel ? `${settings.askProvider}:${settings.askModel}` : '')}
        </select>
        <p class="hint" id="ask-note"></p></div>`)}
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
  const askModel = $('#ask-model');
  if (askModel) askModel.onchange = async () => {
    const { provider, model } = parseAskValue(askModel.value);
    const note = $('#ask-note');
    if (await saveSetting({ askProvider: provider, askModel: model }, note)) {
      if (shell.system) shell.system.settings = { ...(shell.system.settings || {}), askProvider: provider, askModel: model };
      note.className = 'hint ok';
      note.textContent = provider ? 'Saved.' : 'Ask each time.';
    }
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
  routing.cleanups.splice(0).forEach((cleanup) => { try { cleanup(); } catch {} });
  hideTip(); toast('');
  app.onclick = null; app.onchange = null; app.onsubmit = null; app.onkeydown = null;
  const where = parseRoute();
  if (routing.first) {
    // A new install with no apps yet opens on setup.
    routing.first = false;
    if (where.page === 'builds' && !shell.projects.length) {
      const flow = await get('/api/setup').then((data) => data.flow).catch(() => null);
      if (flow && !flow.done) { location.replace('#/setup'); return; } // hashchange routes again
    }
  }
  app.dataset.page = where.page;
  document.body.classList.toggle('focus', where.page === 'setup');
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
  const submit = event.target.closest('[data-submit]');
  const ask = event.target.closest('[data-ask]');
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
  if (cancel && confirm(cancel.dataset.upload ? 'Stop waiting? An upload or OTA publish already sent to Expo may continue; this does not retract it.' : 'Cancel this build?')) { await post(`/api/builds/${cancel.dataset.cancel}/cancel`); route(); }
  if (submit && confirm(`Upload this existing build to ${submit.dataset.store}? This will not rebuild the app.`)) {
    submit.disabled = true;
    const created = await post(`/api/builds/${submit.dataset.submit}/submit`);
    if (created.id) location.hash = `#/build/${created.id}`;
    else { submit.disabled = false; flash(created.error ?? 'Could not start submission', true); }
  }
  if (rebuild && confirm('Build this again?')) {
    const created = await post(`/api/builds/${rebuild.dataset.rebuild}/rebuild`);
    if (created.id) location.hash = `#/build/${created.id}`;
  }
  if (ask) {
    const settings = shell.system?.settings ?? {};
    if (settings.askProvider && settings.askModel) {
      ask.disabled = true;
      await sendAsk(ask.dataset.ask, { provider: settings.askProvider, model: settings.askModel });
      ask.disabled = false;
    } else showAskModal({ id: ask.dataset.ask, project: ask.dataset.project || '' });
  }
  if (remove) { await post('/api/triggers', { project: remove.dataset.project, on: remove.dataset.on, branch: remove.dataset.branch, enabled: false }); route(); }
});
addEventListener('hashchange', () => { scrollTo(0, 0); route(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !['new', 'settings', 'setup'].includes(parseRoute().page)) { loadShell(); route(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
loadShell().finally(route);
