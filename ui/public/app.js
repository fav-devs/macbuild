const app = document.querySelector('#app');
const tabs = document.querySelector('#tabs');
const tip = document.querySelector('#tip');
const ICONS = {
  hammer: '<path d="m15 12-8.4 8.4a2.1 2.1 0 0 1-3-3L12 9"/><path d="M17.6 15 22 10.6l-5.6-5.6-1.7 1.7-2.7-2.7L9.9 6.1l2.7 2.7-.7.7 5.7 5.5z"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8L9.7 3.9A2 2 0 0 0 8.3 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-4M13 17V6M18 17V10"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  branch: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  commit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12"/>',
  check: '<circle cx="12" cy="12" r="10"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  cross: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  spin: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  rebuild: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  disk: '<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M5.5 13 8 4h8l2.5 9M7 17h.01"/>',
  battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>',
  cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  cloudoff: '<path d="M2 2l20 20M5.8 5.8A7 7 0 0 0 9 19h9a5 5 0 0 0 1.7-.3M21.5 15.5A5 5 0 0 0 18 10h-1.3A7 7 0 0 0 9.3 5.1"/>',
  sub: '<path d="M4 7h16M4 12h16M4 17h10"/>',
};
const icon = (name, extra = '') => `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const PHASES = {
  START_BUILD: 'Start', PREPARE_PROJECT: 'Prepare project', READ_EAS_JSON: 'Read eas.json', READ_PACKAGE_JSON: 'Read package.json',
  INSTALL_DEPENDENCIES: 'Install dependencies', READ_APP_CONFIG: 'Read app config', RUN_EXPO_DOCTOR: 'Expo doctor',
  PREPARE_CREDENTIALS: 'Prepare credentials', PREBUILD: 'Prebuild', RESTORE_CACHE: 'Restore cache', INSTALL_PODS: 'Install pods',
  CALCULATE_EXPO_UPDATES_RUNTIME_VERSION: 'Runtime version', CONFIGURE_XCODE_PROJECT: 'Configure Xcode', CONFIGURE_EXPO_UPDATES: 'Configure updates',
  RUN_FASTLANE: 'Compile', PREPARE_ARTIFACTS: 'Prepare artifacts', SAVE_CACHE: 'Save cache', UPLOAD_APPLICATION_ARCHIVE: 'Package', SUBMIT: 'Upload to TestFlight', SETUP: 'Setup',
};
const STATUS = {
  queued: ['Queued', 'clock'], running: ['Building', 'spin'], cancelling: ['Cancelling', 'spin'],
  success: ['Finished', 'check'], failed: ['Failed', 'cross'], cancelled: ['Cancelled', 'ban'],
};
const FILTERS = { all: 'All', active: 'Active', failed: 'Failed', testflight: 'TestFlight', dev: 'Dev' };
const active = (build) => ['queued', 'running', 'cancelling'].includes(build.status);
const kind = (build) => (build.action === 'testflight' ? 'TestFlight' : build.profile ?? 'Dev build');
const short = (build) => (typeof build.commit === 'string' ? build.commit : build.commit?.short ?? '');
const refOf = (build) => build.ref ?? build.branch ?? '';
let timer = null; let filter = 'all'; let query = ''; let scope = 'all'; let logFrom = 0; let shownId = null; let groups = []; let ghId = null;
let routeController = new AbortController();
let homeBuilds = null;
let projectView = 'overview';
let projectViewName = null;
const projectExpoCache = new Map();
const PROJECT_SECTIONS = {
  overview: { label: 'Overview', icon: 'folder', group: 'Project' },
  activity: { label: 'Activity', icon: 'clock', group: 'Project' },
  insights: { label: 'Insights', icon: 'chart', group: 'Project', target: 'project-insights' },
  builds: { label: 'Builds', icon: 'hammer', group: 'Develop', target: 'project-builds', view: 'activity' },
  branches: { label: 'Branches', icon: 'branch', group: 'Develop', target: 'project-branches', view: 'activity' },
  automation: { label: 'Build automation', icon: 'rebuild', group: 'Develop', target: 'project-automation' },
  submissions: { label: 'Submissions', icon: 'send', group: 'Deploy', target: 'project-submissions-card' },
  channels: { label: 'Update channels', icon: 'bolt', group: 'Deploy', target: 'project-channels-card' },
  signing: { label: 'Signing', icon: 'shield', group: 'Manage', target: 'project-signing' },
  environment: { label: 'Environment variables', icon: 'sub', group: 'Manage', target: 'project-environment' },
  devices: { label: 'Devices', icon: 'phone', group: 'Manage', target: 'project-devices' },
};
let projectSectionHash = null;
// Project names: letters, digits, '.', '_' and '-' (macbuild add checks).
const projectLocation = () => location.hash.match(/^#\/p\/([\w.-]+)(?:\/([\w-]+))?(?:\?.*)?$/);
const projectSectionOptions = (name, selected) => Object.entries(PROJECT_SECTIONS).map(([key, section]) => `<option value="#/p/${esc(name)}${key === 'overview' ? '' : `/${key}`}" ${selected === key ? 'selected' : ''}>${esc(section.label)}</option>`).join('');

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-macbuild': '1' }, body: JSON.stringify(body ?? {}) });
const get = async (path) => {
  const { signal } = routeController;
  const hash = location.hash;
  const response = await fetch(path, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  const data = await response.json();
  if (signal.aborted || hash !== location.hash) throw new DOMException('Navigation changed', 'AbortError');
  return data;
};
function ago(time) {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 43200) return `${Math.round(minutes / 1440)}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function span(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
const took = (build) => (build.startedAt ? span((build.finishedAt ?? Date.now()) - build.startedAt) : '');
const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes > 1e10 ? 0 : 1)} GB`;
const size = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MB` : '');
const day = (time) => new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fact = (name, value, ic) => (value ? `<div><dt>${ic ? `${icon(ic, 'sm')} ` : ''}${esc(name)}</dt><dd>${value}</dd></div>` : '');
const status = (build) => `<span class="status">${icon(STATUS[build.status][1], `sm ${build.status}`)}${STATUS[build.status][0]}</span>`;
const buildRow = (build, showProject = true) => `
  <a class="item row" href="#/build/${esc(build.id)}">
    <span class="lead ${esc(build.status)}" role="img" aria-label="${STATUS[build.status][0]}">${icon(STATUS[build.status][1])}</span>
    <span class="main"><div class="title">${esc(build.commit?.subject ?? build.project)}</div>
    <div class="sub line">${icon(build.action === 'testflight' ? 'send' : 'phone', 'sm')}<span>${showProject ? `${esc(build.project)} · ` : ''}${esc(refOf(build))} · ${esc(short(build))}</span></div></span>
    <span class="build-kind">${esc(kind(build))}</span><span class="when">${ago(build.createdAt)}</span>
  </a>`;
function renderTabs() {
  const hash = location.hash || '#/';
  const project = projectLocation();
  if (project) tabs.dataset.project = project[1]; else delete tabs.dataset.project;
  tabs.setAttribute('aria-label', project ? 'Project and main navigation' : 'Main navigation');
  const selected = project?.[2] ?? 'overview';
  const on = (test) => (test ? 'class="on" aria-current="page"' : '');
  tabs.innerHTML = `
    <a class="brand" href="#/">${icon('hammer')}<span>macbuild</span></a>
    ${project ? `<div class="project-sidebar"><a class="sidebar-project" href="#/p/${esc(project[1])}"><span class="sidebar-project-mark">${esc(project[1].slice(0, 2).toUpperCase())}</span><span>${esc(project[1])}<small>Local iOS project</small></span></a>
      <a class="sidebar-back" href="#/projects">${icon('left', 'sm')}All projects</a>
      ${[...new Set(Object.values(PROJECT_SECTIONS).map((section) => section.group))].map((group) => `<div class="sidebar-group"><div class="sidebar-group-label">${esc(group)}</div>${Object.entries(PROJECT_SECTIONS).filter(([, section]) => section.group === group).map(([key, section]) => `<a ${on(selected === key)} href="#/p/${esc(project[1])}${key === 'overview' ? '' : `/${key}`}">${icon(section.icon, 'sm')}<span>${esc(section.label)}</span></a>`).join('')}</div>`).join('')}
      <a class="sidebar-new ${selected === 'new' ? 'on' : ''}" href="#/p/${esc(project[1])}/new" ${selected === 'new' ? 'aria-current="page"' : ''}>${icon('plus', 'sm')}New build</a>
    </div>` : ''}
    <div class="nav-links">
      <a ${on(hash === '#/' || hash.startsWith('#/build'))} href="#/">${icon('hammer')}Builds</a>
      <a ${on(hash.startsWith('#/p'))} href="#/projects">${icon('folder')}Projects</a>
      <a ${on(hash === '#/insights')} href="#/insights">${icon('chart')}Insights</a>
      <a ${on(hash === '#/settings')} href="#/settings">${icon('gear')}Settings</a>
    </div>
    <div class="nav-footer">${icon('shield')}<span>Local builds only<small>Built on your Mac. No cloud queue.</small></span></div>`;
}

// Single-series column chart. Every value is also in the build list, so the tooltip never gates data.
function columns(items, { format, axis }) {
  const width = 340; const height = 150; const left = 34; const bottom = 20; const plot = height - bottom - 6;
  const max = Math.max(...items.map((item) => item.value), 0);
  const step = axis(max); const top = Math.max(2 * step * Math.ceil(max / (2 * step)), 2 * step);
  const y = (value) => 6 + plot - (value / top) * plot;
  const band = (width - left) / Math.max(items.length, 1);
  const bar = Math.min(24, band - 2);
  const grid = [0, top / 2, top].map((tick) => `<line class="grid" x1="${left}" x2="${width}" y1="${y(tick)}" y2="${y(tick)}"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end">${esc(format(tick, true))}</text>`).join('');
  const marks = items.map((item, index) => {
    const x = left + index * band + (band - bar) / 2; const h = Math.max(item.value ? 2 : 0, y(0) - y(item.value)); const top_ = y(0) - h; const r = Math.min(4, h, bar / 2);
    const shape = h ? `<path class="bar" d="M${x} ${y(0)}V${top_ + r}Q${x} ${top_} ${x + r} ${top_}H${x + bar - r}Q${x + bar} ${top_} ${x + bar} ${top_ + r}V${y(0)}Z"/>` : '';
    return `<g class="c">${shape}<rect class="hit" tabindex="0" x="${left + index * band}" y="0" width="${band}" height="${height - bottom}" data-tip="${esc(format(item.value))}" data-sub="${esc(item.label)}" aria-label="${esc(item.label)}: ${esc(format(item.value))}"/></g>`;
  }).join('');
  const every = Math.ceil(items.length / 5);
  const ticks = items.map((item, index) => (index % every === 0 ? `<text x="${left + index * band + band / 2}" y="${height - 5}" text-anchor="middle">${esc(item.tick ?? '')}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${grid}${marks}${ticks}</svg>`;
}
const chart = (title, subtitle, svg) => `<div class="chart"><div class="h">${esc(title)}</div><div class="s">${esc(subtitle)}</div>${svg}</div>`;
const tile = (ic, name, value, note) => `<div class="tile"><div class="k">${icon(ic, 'sm')}${esc(name)}</div><div class="v">${esc(value)}</div><div class="n">${esc(note ?? '')}</div></div>`;
function metrics(builds) {
  const week = builds.filter((build) => Date.now() - build.createdAt < 7 * 86400000);
  const done = builds.filter((build) => ['success', 'failed'].includes(build.status));
  const good = builds.filter((build) => build.status === 'success' && build.startedAt);
  const times = good.map((build) => build.finishedAt - build.startedAt).sort((a, b) => a - b);
  return {
    week: week.length, rate: done.length ? `${Math.round((done.filter((build) => build.status === 'success').length / done.length) * 100)}%` : '—',
    done: done.length, median: times.length ? span(times[Math.floor(times.length / 2)]) : '—', total: times.reduce((sum, ms) => sum + ms, 0), good,
  };
}
const perDay = (builds) => Array.from({ length: 14 }, (_, index) => {
  const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (13 - index));
  const value = builds.filter((build) => build.createdAt >= date.getTime() && build.createdAt < date.getTime() + 86400000).length;
  return { value, label: day(date), tick: day(date) };
});
const durations = (builds) => builds.slice(0, 20).reverse().map((build) => ({
  value: (build.finishedAt - build.startedAt) / 60000, label: `${build.project} · ${short(build)} · ${day(build.createdAt)}`, tick: day(build.createdAt),
}));
const minutes = (value, axis) => (axis ? `${Math.round(value)}m` : span(value * 60000));
const count = (value, axis) => (axis ? String(Math.round(value)) : `${value} build${value === 1 ? '' : 's'}`);
const stepFor = (max) => [1, 2, 5, 10, 20, 50].find((step) => max / step <= 3) ?? 100;

async function home(localOnly = false) {
  const builds = localOnly && homeBuilds ? homeBuilds : (await get('/api/builds')).builds;
  homeBuilds = builds;
  const words = query.toLowerCase();
  const shown = builds.filter((build) => filter === 'all' || (filter === 'active' && active(build)) || (filter === 'failed' && build.status === 'failed')
    || (filter === 'testflight' && build.action === 'testflight') || (filter === 'dev' && build.action !== 'testflight'))
    .filter((build) => !words || `${build.project} ${refOf(build)} ${short(build)} ${build.commit?.subject ?? ''} ${build.commit?.author ?? ''}`.toLowerCase().includes(words));
  const running = builds.find((build) => build.status === 'running');
  const list = document.querySelector('#builds');
  const body = shown.length ? shown.map((build) => buildRow(build)).join('') : `<div class="empty">${builds.length ? 'No matching builds' : 'No builds yet. Start one from Projects.'}</div>`;
  if (list) { list.innerHTML = body; document.querySelector('#now').innerHTML = running ? `${icon('spin', 'sm running')}Building ${esc(running.project)}` : `${icon('check', 'sm success')}Ready`; } else {
    app.innerHTML = `
      <header><h1>Builds</h1><span class="status" id="now">${running ? `${icon('spin', 'sm running')}Building ${esc(running.project)}` : `${icon('check', 'sm success')}Ready`}</span></header>
      <div id="install"></div>
      <div class="build-toolbar"><label class="search">${icon('search')}<input id="q" type="search" aria-label="Search builds" placeholder="Search commits, branches, people" value="${esc(query)}"></label>
      <div class="chips">${Object.entries(FILTERS).map(([key, name]) => `<button class="chip ${filter === key ? 'on' : ''}" data-filter="${key}">${name}</button>`).join('')}</div></div>
      <div class="list" id="builds">${body}</div>`;
    document.querySelector('#q').oninput = (event) => { query = event.target.value; home(true); };
    installHint();
  }
  clearTimeout(timer);
  timer = setTimeout(route, builds.some(active) ? 3000 : 15000);
}
async function projectsPage() {
  const { projects } = await get('/api/state');
  app.innerHTML = `<header><div><h1>Projects <span class="project-count">${projects.length}</span></h1><p class="page-description">Your apps, built on this Mac.</p></div></header>
    <div class="list project-grid">${projects.length ? projects.map((project) => `
    <a class="item project-card" href="#/p/${esc(project.name)}">
      <span class="project-identity"><span class="lead project-mark">${esc(project.name.slice(0, 1).toUpperCase())}</span><span class="main"><span class="title">${esc(project.name)}</span>
      <span class="sub line">${icon('branch', 'sm')}<span>${esc(project.branch || 'Detached HEAD')}${project.dirty ? ` · ${project.dirty} changed` : ''}</span></span></span>${icon('right', 'sm')}</span>
      <span class="project-footer">${project.lastBuild ? `${status(project.lastBuild)}<span>${ago(project.lastBuild.createdAt)}</span>` : `<span>${icon('hammer', 'sm')} No builds yet</span><span>Open project ${icon('right', 'sm')}</span>`}</span>
    </a>`).join('') : '<div class="empty">No projects yet. Run macbuild add &lt;name&gt; &lt;path&gt; on your Mac to add one.</div>'}</div>`;
}
async function insights() {
  const { builds, projects } = await get('/api/state');
  const picked = builds.filter((build) => scope === 'all' || build.project === scope);
  const data = metrics(picked);
  app.innerHTML = `<header><h1>Insights</h1></header>
    <div class="chips">${['all', ...projects.map((project) => project.name)].map((name) => `<button class="chip ${scope === name ? 'on' : ''}" data-scope="${esc(name)}">${name === 'all' ? 'All projects' : esc(name)}</button>`).join('')}</div>
    <div class="tiles metrics-grid">${tile('hammer', 'Builds', String(data.week), 'last 7 days')}${tile('check', 'Success rate', data.rate, `of ${data.done} finished`)}${tile('clock', 'Typical build', data.median, 'median, successful')}${tile('cpu', 'Time building', data.total ? span(data.total) : '—', 'all kept builds')}</div>
    <div class="section-grid"><section><h2>Activity</h2>${chart('Builds per day', 'Last 14 days', columns(perDay(picked), { format: count, axis: stepFor }))}</section>
    <section><h2>Speed</h2>${data.good.length ? chart('Build time', `Last ${Math.min(20, data.good.length)} successful builds, oldest first`, columns(durations(data.good), { format: minutes, axis: stepFor })) : '<div class="list"><div class="empty">No finished builds yet</div></div>'}</section></div>`;
}
const projectCard = (title, ic, body, action = '', id = '') => `<section class="overview-card"${id ? ` id="${esc(id)}"` : ''}><div class="overview-card-heading"><h3>${icon(ic, 'sm')}${esc(title)}</h3>${action}</div>${body}</section>`;
const projectEmpty = (ic, title, note) => `<div class="project-empty">${icon(ic)}<strong>${esc(title)}</strong><p>${esc(note)}</p></div>`;
function selectProjectView(view) {
  projectView = view;
  document.querySelectorAll('.project-view-nav [data-project-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.projectTab === view)));
  document.querySelectorAll('[data-project-panel]').forEach((panel) => { panel.hidden = panel.dataset.projectPanel !== view; });
}
function focusProjectSection(section) {
  if (projectSectionHash === location.hash) return;
  const target = PROJECT_SECTIONS[section]?.target;
  if (!target) { window.scrollTo(0, 0); projectSectionHash = location.hash; return; }
  const element = document.getElementById(target);
  if (!element) return;
  const details = element.closest('details');
  if (details) details.open = true;
  element.tabIndex = -1;
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: 'start' });
  projectSectionHash = location.hash;
}
function restoreProjectFocus(id) {
  const element = id && document.getElementById(id);
  if (!element) return;
  element.tabIndex = -1;
  element.focus({ preventScroll: true });
}
async function project(name, section = 'overview') {
  const data = await get(`/api/projects/${name}`);
  const focusedId = app.contains(document.activeElement) ? document.activeElement.id : null;
  projectViewName = name;
  projectView = PROJECT_SECTIONS[section].view ?? (section === 'activity' ? 'activity' : 'overview');
  const expanded = document.querySelector('#project-expo-details')?.open;
  const { stats, signing, storeSigning } = data;
  const rate = stats.total ? `${Math.round((stats.passed / stats.total) * 100)}%` : '—';
  const expiry = (item) => {
    if (!item?.expires) return '—';
    const days = Math.round((new Date(item.expires) - Date.now()) / 86400000);
    return `<span class="${days < 30 ? 'warn' : ''}">${day(item.expires)} (${days}d)</span>`;
  };
  const good = data.builds.filter((build) => build.status === 'success' && build.startedAt);
  const production = (build) => (build.distribution ?? data.profiles.find((profile) => profile.name === build.profile)?.distribution) === 'store' || build.action === 'testflight';
  const development = data.builds.filter((build) => !production(build));
  const store = data.builds.filter(production);
  const running = data.builds.find(active);
  const history = '<button class="card-link" data-project-tab="activity">View all</button>';
  const recentBuilds = (builds, label, emptyTitle) => builds.length ? builds.slice(0, 3).map((build) => `<a class="item row compact-build" href="#/build/${esc(build.id)}">
    <span class="lead ${esc(build.status)}" role="img" aria-label="${esc(STATUS[build.status][0])}">${icon(STATUS[build.status][1], 'sm')}</span>
    <span class="main"><div class="title">${esc(label)}</div><div class="sub line"><span>${esc(build.profile ?? 'iOS')} · ${ago(build.createdAt)}${took(build) ? ` · ${esc(took(build))}` : ''}</span></div><div class="sub line">${icon('commit', 'sm')}<span>${esc(short(build) || 'Working copy')}${refOf(build) ? ` · ${esc(refOf(build))}` : ''}</span></div></span>${icon('right', 'sm')}
  </a>`).join('') : projectEmpty('hammer', emptyTitle, 'Start a new local build to see it here.');
  app.innerHTML = `
    <a class="back" href="#/projects">${icon('left', 'sm')} Projects</a>
    <header class="project-header"><div class="project-heading"><span class="project-avatar" aria-hidden="true">${esc(data.name.slice(0, 2).toUpperCase())}</span><div class="project-heading-copy"><h1>${esc(data.name)}</h1><div class="project-badges">${data.repo ? `<a class="repo-badge" href="https://github.com/${esc(data.repo)}">${icon('link', 'sm')}<span>${esc(data.repo)}</span></a>` : ''}<span class="pill">${icon('shield', 'sm')}Local builds only</span></div></div></div><div class="project-actions"><a class="button primary" href="#/p/${esc(name)}/new">${icon('plus')}New build</a></div></header>
    <nav class="project-view-nav" aria-label="Project views"><button data-project-tab="overview" aria-pressed="true">${icon('folder', 'sm')}Overview</button><button data-project-tab="activity" aria-pressed="false">${icon('clock', 'sm')}Activity <span class="tab-count">${data.builds.length}</span></button><span class="project-ready">${running ? status(running) : `${icon('check', 'sm')}Ready to build`}</span></nav>
    <label class="project-mobile-nav"><span>Project section</span><select id="project-section">${projectSectionOptions(name, section)}</select></label>
    ${data.behind ? `<p class="hint warn">Your local ${esc(data.branch)} is ${data.behind} commit${data.behind > 1 ? 's' : ''} behind GitHub. Choose a branch in Activity to build the latest code.</p>` : ''}
    <div class="project-panel" data-project-panel="overview"><div class="project-section-heading"><h2>Develop & deploy</h2><span>Built on your Mac. Never in the cloud.</span></div>
    <div class="project-deploy-grid">
      ${projectCard('Development builds', 'phone', recentBuilds(development, 'iOS internal build', 'No development builds yet'), history)}
      ${projectCard('Production builds', 'hammer', recentBuilds(store, 'iOS App Store build', 'No production builds yet'), history)}
      ${projectCard('TestFlight submissions', 'send', '<div id="project-submissions"><div class="empty">Loading submissions…</div></div>', '', 'project-submissions-card')}
      ${projectCard('Update channels', 'bolt', '<div id="project-channels"><div class="empty">Loading channels…</div></div>', '', 'project-channels-card')}
      ${projectCard('Build automation', 'rebuild', data.triggers.length ? data.triggers.map((rule) => `<a class="item row" href="#/p/${esc(name)}/new?branch=${encodeURIComponent(rule.branch)}"><span class="lead">${icon('bolt', 'sm')}</span><span class="main"><div class="title">Build on push</div><div class="sub">${esc(rule.branch)} · ${esc(rule.profile)}</div>${rule.error ? `<div class="sub warn">${esc(rule.error)}</div>` : ''}</span>${icon('right', 'sm')}</a>`).join('') : `${projectEmpty('rebuild', 'You’re in control', 'Build when you’re ready, or enable build-on-push.')}<a class="card-footer-link" href="#/p/${esc(name)}/new">Configure a build ${icon('right', 'sm')}</a>`, '', 'project-automation')}
      ${projectCard('Signing & local source', 'shield', `<dl class="facts project-signing-facts">
      ${fact('Dev profile', expiry(signing), 'shield')}${fact('Devices', signing ? String(signing.devices) : '—', 'phone')}${storeSigning ? fact('Store profile', expiry(storeSigning), 'shield') : ''}
      ${fact('Branch', esc(data.branch || 'Detached HEAD'), 'branch')}${fact('Commit', esc(data.commit), 'commit')}${data.dirty ? fact('Working copy', `${data.dirty} changed files`) : ''}</dl>`, '', 'project-signing')}
    </div>
    <div class="project-section-heading" id="project-insights"><h2>Build insights</h2><span>Local build history</span></div>
    <div class="project-insight-metrics">${tile('check', 'Success rate', rate, `${stats.passed} of ${stats.total} finished builds`)}${tile('clock', 'Typical build', stats.median ? span(stats.median) : '—', 'Median successful build time')}${tile('hammer', 'Finished builds', stats.total, `${data.profiles.length} build profiles available`)}</div>
    ${good.length > 1 ? `<div class="project-build-chart">${chart('Build duration', 'Recent successful builds, oldest first', columns(durations(good), { format: minutes, axis: stepFor }))}</div>` : ''}
    <details class="project-expo-details" id="project-expo-details" ${expanded ? 'open' : ''}><summary>${icon('sub', 'sm')}More project details<span>Environment, devices & cloud history</span>${icon('right', 'sm')}</summary><div id="expo" class="section-grid"><p class="hint">Loading Expo details…</p></div></details></div>
    <div class="project-panel" data-project-panel="activity" hidden><div class="project-section-heading"><h2>Project activity</h2><span>Recent builds & GitHub branches</span></div><div class="section-grid project-activity"><section id="project-builds"><h2>Builds <span class="tab-count">${data.builds.length}</span></h2><div class="list">${data.builds.length ? data.builds.map((build) => buildRow(build, false)).join('') : '<div class="empty">No builds yet. Start your first local build above.</div>'}</div></section><section id="project-branches"><h2>Branches <span class="tab-count">${data.branches.length}</span></h2><div class="list">${data.branches.map((branch) => {
      const rule = data.triggers.find((item) => item.branch === branch.name);
      return `<a class="item row" href="#/p/${esc(name)}/new?branch=${encodeURIComponent(branch.name)}"><span class="lead">${icon('branch')}</span><span class="main"><div class="title">${esc(branch.name)}${branch.pr ? `<span class="tag">#${branch.pr.number}</span>` : ''}${rule ? '<span class="tag">auto</span>' : ''}</div>
      <div class="sub">${esc(branch.short)} · ${esc(branch.subject)}</div></span><span class="when">${ago(branch.date)}</span></a>`;
    }).join('') || '<div class="empty">No remote branches found.</div>'}</div></section></div></div>`;
  selectProjectView(projectView);
  document.querySelector('#project-section').onchange = (event) => { location.hash = event.target.value; };
  if (projectExpoCache.has(name)) renderProjectExpo(projectExpoCache.get(name));
  focusProjectSection(section);
  restoreProjectFocus(focusedId);
  loadExpo(name).catch((error) => {
    if (error.name === 'AbortError') return;
    for (const selector of ['#project-submissions', '#project-channels', '#expo']) {
      const box = document.querySelector(selector);
      if (box) box.innerHTML = '<div class="empty">Expo is unavailable. Local builds are still ready to use.</div>';
    }
  });
  if (data.refreshing || data.builds.some(active)) timer = setTimeout(route, data.refreshing ? 2000 : 6000);
}
async function loadExpo(name) {
  const box = document.querySelector('#expo');
  if (!box) return;
  const data = await get(`/api/projects/${name}/expo`);
  const here = document.querySelector('#expo');
  if (here !== box) return;
  projectExpoCache.set(name, data);
  renderProjectExpo(data);
}
function renderProjectExpo(data) {
  const here = document.querySelector('#expo');
  if (!here) return;
  const focusedId = here.contains(document.activeElement) ? document.activeElement.id : null;
  const state = { FINISHED: ['check', 'success'], ERRORED: ['cross', 'failed'], CANCELED: ['ban', ''], CANCELLED: ['ban', ''] };
  const mark = (value) => { const [ic, tone] = state[value] ?? ['spin', 'running']; return `<span class="lead ${tone}" role="img" aria-label="${esc(value)}">${icon(ic)}</span>`; };
  const when = (value) => (value ? ago(new Date(value).getTime()) : '');
  const list = (rows, empty) => `<div class="list">${rows.length ? rows.join('') : `<div class="empty">${esc(empty)}</div>`}</div>`;
  const environments = Object.entries(data.env).filter(([, names]) => names);
  document.querySelector('#project-submissions').innerHTML = data.submissions.length ? data.submissions.slice(0, 3).map((item) => `<div class="item row">${mark(item.status)}<span class="main"><div class="title">iOS App Store submission</div><div class="sub">${esc(item.status.toLowerCase())} · ${when(item.createdAt)}</div></span></div>`).join('') : projectEmpty('send', 'No submissions yet', 'Upload a production build to TestFlight when it’s ready.');
  document.querySelector('#project-channels').innerHTML = data.channels.length ? data.channels.slice(0, 3).map((item) => `<div class="item row"><span class="lead">${icon('bolt', 'sm')}</span><span class="main"><div class="title">${esc(item.name)}${item.paused ? '<span class="tag">paused</span>' : ''}</div><div class="sub">${item.branches.map((branch) => `${esc(branch.name)} · ${branch.updates} update${branch.updates === 1 ? '' : 's'}`).join(', ') || 'No branch'}</div></span></div>`).join('') : projectEmpty('bolt', 'No update channels', 'Your Expo update channels will appear here.');
  here.innerHTML = `
    <section><h2>All TestFlight submissions</h2>${list(data.submissions.map((item) => `<div class="item row">${mark(item.status)}<span class="main"><div class="title">${esc(item.status.toLowerCase())}</div><div class="sub">App Store Connect ${esc(item.ascApp ?? '')}</div></span><span class="when">${when(item.createdAt)}</span></div>`), 'No submissions yet')}</section>
    <section><h2>All update channels</h2>${list(data.channels.map((item) => `<div class="item row"><span class="lead">${icon('bolt')}</span><span class="main"><div class="title">${esc(item.name)}${item.paused ? '<span class="tag">paused</span>' : ''}</div><div class="sub">${item.branches.map((branch) => `${esc(branch.name)} · ${branch.updates} update${branch.updates === 1 ? '' : 's'}`).join(', ') || 'No branch'}</div></span></div>`), 'No channels')}</section>
    <section id="project-environment"><h2>Environment variables</h2>${list(environments.map(([name, names]) => `<div class="item"><div class="title">${esc(name)}</div><div class="sub" style="white-space:normal">${names.length ? names.map(esc).join(', ') : 'None set'}</div></div>`), 'Not available')}
    <p class="hint">Names only. Values stay on Expo.</p></section>
    <section id="project-devices"><h2>Registered devices</h2>${list(data.devices.map((item) => `<div class="item row"><span class="lead">${icon('phone')}</span><span class="main"><div class="title">${esc(item.name)}</div><div class="sub">${esc(item.kind ?? '')} · …${esc(item.udid ?? '')}</div></span></div>`), 'No devices listed')}</section>
    <section><h2>Past EAS cloud builds</h2>${list(data.cloud.slice(0, 5).map((item) => `<div class="item row">${mark(item.status)}<span class="main"><div class="title">${esc(item.profile)}</div><div class="sub">${esc(item.version ?? '')} (${esc(item.number ?? '')})</div></span><span class="when">${when(item.createdAt)}</span></div>`), 'None')}
    <p class="hint">History only. New builds run on this Mac.${data.url ? ` <a class="link" href="${esc(data.url)}">Open on Expo</a>` : ''}</p></section>`;
  focusProjectSection(projectLocation()?.[2] ?? 'overview');
  restoreProjectFocus(focusedId);
}
async function start(name, branch) {
  const data = await get(`/api/projects/${name}`);
  const chosen = branch || data.branches.find((item) => item.name === 'main')?.name || data.branches[0]?.name || '';
  const defaultProfile = data.profiles.find((item) => item.name === 'development')?.name ?? data.profiles[0]?.name;
  const rule = data.triggers.find((item) => item.branch === chosen);
  app.innerHTML = `
    <a class="back" href="#/p/${esc(name)}">${icon('left', 'sm')} ${esc(name)}</a>
    <header><h1>New build</h1></header>
    <label class="field"><span>${icon('branch', 'sm')} Source</span><select id="branch">
      ${data.branches.map((item) => `<option value="${esc(item.name)}" ${item.name === chosen ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}
      <option value="" ${chosen ? '' : 'selected'}>This Mac’s working copy${data.dirty ? ` (${data.dirty} uncommitted)` : ''}</option></select></label>
    <label class="field" id="commitField"><span>${icon('commit', 'sm')} Commit</span><select id="commit"></select></label>
    <label class="field"><span>${icon('sub', 'sm')} Profile</span><select id="profile">${data.profiles.map((item) => `<option value="${esc(item.name)}" ${item.name === defaultProfile ? 'selected' : ''}>${esc(item.name)} · ${esc(item.distribution)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" id="submit"> Upload to TestFlight when done</label>
    <div class="buttons" style="margin-top:0"><button class="primary" id="go">${icon('hammer')}Start build</button></div>
    <p class="hint bad" id="error"></p>
    <h2>Automatic builds</h2><div class="list"><label class="setrow">${icon('bolt')}Build on every push<input class="switch" type="checkbox" id="auto" ${rule ? 'checked' : ''}></label></div>
    <p class="hint" id="autoNote">${rule ? `On, using ${esc(rule.profile)}${rule.submit ? ', then TestFlight' : ''}.${rule.error ? ` <span class="warn">Last check: ${esc(rule.error)}.</span>` : ''}` : 'Uses the branch and profile above. Checks GitHub every minute.'}</p>`;
  const pick = (id) => document.querySelector(`#${id}`);
  const loadCommits = async () => {
    const value = pick('branch').value;
    pick('commitField').style.display = value ? '' : 'none';
    pick('commit').innerHTML = '';
    if (!value) return;
    const list = await get(`/api/projects/${name}/commits?branch=${encodeURIComponent(value)}`);
    if (pick('branch').value !== value) return;
    pick('commit').innerHTML = list.map((item, index) => `<option value="${esc(index ? item.hash : '')}">${esc(item.short)} ${esc(item.subject.slice(0, 48))}${index ? '' : ' (latest)'}</option>`).join('');
  };
  const syncProfile = () => {
    const distribution = data.profiles.find((item) => item.name === pick('profile').value)?.distribution;
    pick('submit').disabled = distribution !== 'store';
    if (distribution !== 'store') pick('submit').checked = false;
  };
  pick('branch').onchange = loadCommits;
  pick('profile').onchange = syncProfile;
  syncProfile();
  await loadCommits();
  pick('go').onclick = async () => {
    pick('go').disabled = true;
    const ref = pick('branch').value ? pick('commit').value || pick('branch').value : null;
    const created = await (await post('/api/builds', { project: name, profile: pick('profile').value, ref, label: pick('branch').value || undefined, submit: pick('submit').checked })).json();
    if (created.id) location.hash = `#/build/${created.id}`;
    else { pick('error').textContent = created.error ?? 'Could not start the build'; pick('go').disabled = false; }
  };
  pick('auto').onchange = async () => {
    const value = pick('branch').value;
    if (!value) { pick('auto').checked = false; return; }
    await post('/api/triggers', { project: name, branch: value, profile: pick('profile').value, submit: pick('submit').checked, enabled: pick('auto').checked });
    pick('autoNote').textContent = pick('auto').checked ? `On for ${value}.` : 'Off.';
  };
}
function head(build) {
  const manifest = encodeURIComponent(`${location.origin}/ota/${build.id}/manifest.plist`);
  const hasIpa = build.ipaBytes && !build.expired;
  const commit = build.commit && typeof build.commit === 'object' ? build.commit : null;
  const install = build.installable && hasIpa;
  return `
    <a class="back" href="#/p/${esc(build.project)}">${icon('left', 'sm')} ${esc(build.project)}</a>
    <h1>${esc(commit?.subject ?? kind(build))}</h1>
    <div style="margin-top:8px">${status(build)}<span class="status" style="margin-left:10px">${icon(build.action === 'testflight' ? 'send' : 'phone', 'sm')}${esc(kind(build))}</span>${took(build) ? `<span class="status" style="margin-left:10px">${icon('clock', 'sm')}${took(build)}</span>` : ''}</div>
    ${build.reason ? `<div class="reason">${icon('cross', 'sm')} ${esc(build.reason)}</div>` : ''}
    <div class="buttons wrap">
      ${install ? `<a class="button primary" href="itms-services://?action=download-manifest&url=${manifest}">${icon('phone')}Install on iPhone</a>` : ''}
      ${active(build) ? `<button class="danger" data-cancel="${esc(build.id)}" ${build.status === 'cancelling' ? 'disabled' : ''}>${icon('ban')}Cancel</button>` : `<button data-rebuild="${esc(build.id)}">${icon('rebuild')}Rebuild</button>`}
      ${hasIpa ? `<a class="button" href="/api/builds/${esc(build.id)}/app.ipa">${icon('download')}IPA</a>` : ''}
    </div>
    ${install ? `<p class="hint">Install in Safari, on a device in this build’s profile.</p><div class="qr"><img src="/api/builds/${esc(build.id)}/qr.svg" alt="QR code for this build"><p class="hint">Scan with your iPhone</p></div>` : ''}
    ${build.submission ? `<p class="hint">Uploaded. Apple processes it before it appears in TestFlight. <a class="link" href="${esc(build.submission)}">Submission</a></p>` : ''}
    <h2>Source</h2><div class="card">
      ${commit ? `<div class="sub line" style="margin-bottom:12px">${icon('user', 'sm')}<span>${esc(commit.author)} · ${ago(commit.date)}</span></div>` : ''}
      <dl class="facts">
        ${fact('Branch', build.source === 'working' ? `${esc(refOf(build))} <span class="tag">local</span>` : esc(refOf(build)), 'branch')}
        ${fact('Commit', commit?.url ? `<a class="link" href="${esc(commit.url)}">${esc(commit.short)}</a>` : esc(short(build)), 'commit')}
        ${build.pr ? fact('Pull request', `<a class="link" href="${esc(build.pr.url)}">#${build.pr.number}</a>`, 'pr') : ''}
        <div id="checks"></div>
        ${build.dirty ? fact('Uncommitted', `<span class="warn">${build.dirty} files included</span>`) : ''}
      </dl></div>
    <h2>Details</h2><div class="card"><dl class="facts">
      ${fact('Version', build.app ? `${esc(build.app.version)} (${esc(build.app.number)})` : '')}${fact('Bundle ID', esc(build.app?.id))}
      ${fact('Profile', esc(build.profile))}${fact('Distribution', esc(build.distribution))}
      ${fact('Channel', esc(build.channel))}${fact('Runtime', build.runtime && !build.runtime.startsWith('file:') ? esc(build.runtime.slice(0, 12)) : '')}
      ${fact('Triggered by', esc(build.trigger ?? 'manual'))}${fact('Started', new Date(build.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}
      ${fact('Queued', build.startedAt ? span(build.startedAt - build.createdAt) : '')}${fact('Size', hasIpa ? size(build.ipaBytes) : '')}
      ${fact('Signing expires', build.signing?.expires ? day(build.signing.expires) : '')}
    </dl></div>`;
}
function renderPhases(build) {
  const box = document.querySelector('#phases');
  const times = build.phases ?? [];
  const lengthOf = (group, index) => {
    const position = times.findIndex((item) => item.name === group.name);
    const end = times[position + 1]?.at ?? (index === groups.length - 1 ? build.finishedAt ?? Date.now() : null);
    return position >= 0 && end ? end - times[position].at : 0;
  };
  const longest = Math.max(...groups.map(lengthOf), 1);
  groups.forEach((group, index) => {
    let node = box.children[index];
    if (!node) {
      node = document.createElement('details'); node.className = 'phase';
      node.innerHTML = `<summary><span class="mark"></span><span class="name"></span><span class="time"></span>${icon('right', 'sm chev')}<span class="track"><div class="phasebar"></div></span></summary><pre></pre>`;
      box.append(node);
    }
    const last = index === groups.length - 1;
    const state = last && active(build) ? 'running' : last && build.status === 'failed' ? 'failed' : 'success';
    node.querySelector('.mark').className = `mark status`;
    node.querySelector('.mark').innerHTML = icon(STATUS[state][1], `sm ${state}`);
    node.querySelector('.name').textContent = PHASES[group.name] ?? group.name.replace(/_/g, ' ').toLowerCase();
    const ms = lengthOf(group, index);
    node.querySelector('.time').textContent = ms ? span(ms) : '';
    node.querySelector('.phasebar').style.width = `${(ms / longest) * 100}%`;
    node.querySelector('.phasebar').style.display = ms > 1000 ? '' : 'none';
    const pre = node.querySelector('pre');
    if (pre.dataset.count !== String(group.lines.length)) {
      const stick = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      pre.textContent = group.lines.slice(-800).join('\n'); pre.dataset.count = group.lines.length;
      if (stick) pre.scrollTop = pre.scrollHeight;
    }
    if (state === 'failed' && !node.dataset.opened) { node.open = true; node.dataset.opened = '1'; }
  });
}
async function detail(id) {
  if (shownId !== id) {
    shownId = id; logFrom = 0; groups = []; ghId = null;
    app.innerHTML = `<div class="build-layout"><div id="head"></div><section class="build-logs"><h2>Logs <a class="link" style="float:right;font-weight:400" href="/api/builds/${esc(id)}/log.txt">Download</a></h2><div class="list" id="phases"></div></section></div>`;
  }
  const { build, lines, next } = await get(`/api/builds/${id}/log?from=${logFrom}`);
  if (!build) { location.hash = '#/'; return; }
  const kept = document.querySelector('#checks')?.innerHTML;
  document.querySelector('#head').innerHTML = head(build);
  if (kept) document.querySelector('#checks').innerHTML = kept;
  logFrom = next;
  for (const line of lines) {
    const match = line.match(/^\[([A-Z][A-Z_]{3,})\]\s?(.*)$/);
    const name = match ? match[1] : /Scheduling iOS submission|Submitting your app/.test(line) ? 'SUBMIT' : groups.at(-1)?.name ?? 'SETUP';
    if (groups.at(-1)?.name !== name) {
      const existing = groups.find((group) => group.name === name);
      if (existing) { existing.lines.push(match ? match[2] : line); continue; }
      groups.push({ name, lines: [] });
    }
    groups.at(-1).lines.push(match ? match[2] : line);
  }
  renderPhases(build);
  if (ghId !== id && build.repo && build.commit?.hash) {
    ghId = id;
    get(`/api/builds/${id}/github`).then((data) => {
      const box = document.querySelector('#checks');
      if (!box || !data?.total) return;
      const text = data.failed ? `${icon('cross', 'sm failed')} ${data.failed} failing` : data.pending ? `${icon('clock', 'sm')} ${data.pending} running` : `${icon('check', 'sm success')} ${data.total} passed`;
      box.innerHTML = `<dt>GitHub checks</dt><dd><a class="status link" href="${esc(data.url)}">${text}</a></dd>`;
    }).catch(() => {});
  }
  if (active(build)) timer = setTimeout(route, 1500);
}
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function installHint() {
  const box = document.querySelector('#install');
  if (!box || standalone() || localStorage.hideInstall) return;
  if (/iPhone|iPad/.test(navigator.userAgent)) box.innerHTML = `<div class="banner">${icon('phone')}<span>Add to Home Screen: tap Share, then Add to Home Screen.</span></div>`;
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
      note.textContent = 'Off.'; return;
    }
    if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this app.');
    const { key } = await get('/api/push/key');
    const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) });
    await post('/api/push', { subscription: subscription.toJSON() });
    note.textContent = 'On. You’ll be told when each build finishes.';
  } catch (error) {
    note.textContent = error.message; document.querySelector('#push').checked = false;
  }
}
async function settings() {
  const data = await get('/api/system');
  const canPush = 'PushManager' in window && 'serviceWorker' in navigator;
  const enabled = canPush ? Boolean(await Promise.race([pushState(), new Promise((resolve) => { setTimeout(() => resolve(null), 800); })])) : false;
  const row = (ic, name, value) => `<div class="setrow">${icon(ic)}${esc(name)}<span class="v">${esc(value)}</span></div>`;
  const hours = Math.floor(data.uptime / 3600);
  app.innerHTML = `<header><h1>Settings</h1></header>
    <div class="section-grid settings-grid"><section><h2>Notifications</h2><div class="list"><label class="setrow">${icon('bell')}Build finished<input class="switch" type="checkbox" id="push" ${enabled ? 'checked' : ''} ${canPush ? '' : 'disabled'}></label></div>
    <p class="hint" id="pushNote">${canPush ? (enabled ? 'On for this device.' : 'Tells you when a build finishes.') : 'Add macbuild to your Home Screen first, then open it from there.'}</p></section>
    <section><h2>This Mac</h2><div class="list">
      ${row('disk', 'Free space', `${gb(data.diskFree)} of ${gb(data.diskTotal)}`)}${data.battery ? row('battery', 'Battery', `${data.battery.percent}% · ${data.battery.state}`) : ''}
      ${row('cpu', 'Load', `${data.load.toFixed(1)} on ${data.cores} cores`)}${row('clock', 'Up', hours > 47 ? `${Math.floor(hours / 24)} days` : `${hours} hours`)}
      ${row('hammer', 'Queue', data.running ? `Building, ${data.queued} waiting` : `${data.queued} waiting`)}${row('download', 'Saved IPAs', size(data.ipaBytes) || '0 MB')}</div></section>
    <section><h2>Automatic builds</h2><div class="list">${data.triggers.length ? data.triggers.map((rule) => {
      const text = `${icon('bolt')}${esc(rule.project)}<span class="v">${esc(rule.branch)} · ${esc(rule.profile)}${rule.error ? `<br><span class="warn">${esc(rule.error)}</span>` : ''}</span>`;
      return rule.missing ? `<div class="setrow">${text}<button class="remove-rule" data-project="${esc(rule.project)}" data-branch="${esc(rule.branch)}">Remove</button></div>`
        : `<a class="setrow" href="#/p/${esc(rule.project)}/new?branch=${encodeURIComponent(rule.branch)}">${text}</a>`;
    }).join('') : '<div class="empty">None. Turn it on when starting a build.</div>'}</div></section>
    <section><h2>Tools</h2><div class="list">${row('hammer', 'Xcode', data.tools.xcode || '—')}${row('sub', 'EAS CLI', data.tools.eas || '—')}${row('cpu', 'Node', data.tools.node)}</div></section></div>`;
  const toggle = document.querySelector('#push');
  if (toggle) toggle.onchange = () => togglePush(toggle.checked, document.querySelector('#pushNote'));
}
function offline() {
  app.innerHTML = `<header><h1>macbuild</h1></header><div class="list"><div class="empty">${icon('cloudoff')}<p>Can’t reach the Mac. Check Tailscale is on.</p></div></div>`;
  timer = setTimeout(route, 5000);
}
function route() {
  routeController.abort();
  routeController = new AbortController();
  clearTimeout(timer); hideTip(); renderTabs();
  const hash = location.hash;
  const build = hash.match(/^#\/build\/([0-9a-z-]+)$/);
  const fresh = hash.match(/^#\/p\/([\w.-]+)\/new(?:\?branch=(.+))?$/);
  const page = projectLocation();
  const section = page?.[2] ?? 'overview';
  const projectPage = page && Object.hasOwn(PROJECT_SECTIONS, section);
  app.dataset.view = build ? 'build' : fresh ? 'new' : projectPage ? 'project' : hash === '#/projects' ? 'projects' : hash === '#/insights' ? 'insights' : hash === '#/settings' ? 'settings' : 'builds';
  if (!build) shownId = null;
  if (hash !== '' && hash !== '#/') app.dataset.page = hash; else if (app.dataset.page) { delete app.dataset.page; app.innerHTML = ''; }
  const work = build ? detail(build[1]) : fresh ? start(fresh[1], fresh[2] ? decodeURIComponent(fresh[2]) : '') : projectPage ? project(page[1], section)
    : hash === '#/projects' ? projectsPage() : hash === '#/insights' ? insights() : hash === '#/settings' ? settings() : home();
  return work.catch((error) => { if (error.name !== 'AbortError') offline(); });
}
function hideTip() { tip.style.display = 'none'; }
function showTip(target) {
  tip.replaceChildren();
  const value = document.createElement('b'); value.textContent = target.dataset.tip;
  tip.append(value, document.createTextNode(target.dataset.sub));
  tip.style.display = 'block';
  const box = target.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, box.left + box.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, box.top - tip.offsetHeight + 12)}px`;
}
document.addEventListener('pointerover', (event) => { if (event.target.dataset?.tip !== undefined) showTip(event.target); });
document.addEventListener('focusin', (event) => { if (event.target.dataset?.tip !== undefined) showTip(event.target); });
document.addEventListener('click', async (event) => {
  if (event.target.dataset?.tip !== undefined) { showTip(event.target); return; }
  hideTip();
  const projectTab = event.target.closest('[data-project-tab]');
  if (projectTab) { location.hash = `#/p/${projectViewName}${projectTab.dataset.projectTab === 'overview' ? '' : '/activity'}`; return; }
  const chip = event.target.closest('[data-filter]');
  const area = event.target.closest('[data-scope]');
  const cancel = event.target.closest('[data-cancel]');
  const rebuild = event.target.closest('[data-rebuild]');
  const removeRule = event.target.closest('.remove-rule');
  if (removeRule) { await post('/api/triggers', { project: removeRule.dataset.project, branch: removeRule.dataset.branch, enabled: false }); route(); return; }
  if (chip) { filter = chip.dataset.filter; document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('on', item === chip)); home(true); }
  if (area) { scope = area.dataset.scope; insights(); }
  if (cancel && confirm('Cancel this build?')) { await post(`/api/builds/${cancel.dataset.cancel}/cancel`); route(); }
  if (rebuild && confirm('Build this commit again?')) {
    const created = await (await post(`/api/builds/${rebuild.dataset.rebuild}/rebuild`)).json();
    if (created.id) location.hash = `#/build/${created.id}`;
  }
});
addEventListener('hashchange', () => { app.innerHTML = ''; projectSectionHash = null; route(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !location.hash.includes('/new') && location.hash !== '#/settings') route(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();
