#!/usr/bin/env node
// A stand-in for `npx expo start`, for the demo and the tests: Expo's start screen and keys, a prompt for tunnels and
// a list for shift+M, a bundle when a file in the project changes, and a small web page on its port, so the dashboard's
// dev server page can be tried without Expo or a phone. Metro's endpoints too, for one started in a terminal:
// /status, /events (bundles and console logs), /message (reload, devMenu) and /json/list (the connected phone).
//   fake-expo.mjs start --port 8081 [--localhost|--tunnel] [--clear]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { basename, join } from 'node:path';

const args = process.argv.slice(2).filter((arg) => arg !== 'expo');
const port = Number(args[args.indexOf('--port') + 1]) || 8081;
const pkg = (() => { try { return JSON.parse(readFileSync('package.json', 'utf8')); } catch { return {}; } })();
const app = (() => { try { return JSON.parse(readFileSync('app.json', 'utf8')).expo; } catch { return {}; } })();
const slug = app?.slug ?? pkg.name ?? basename(process.cwd());
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const devClient = Boolean(deps['expo-dev-client']);
const web = Boolean(deps['react-native-web']);
const host = args.includes('--localhost') ? 'localhost' : process.env.REACT_NATIVE_PACKAGER_HOSTNAME || '192.168.1.42';
const fast = Number(process.env.FAKE_EXPO_SPEED ?? 1) || 1;
const out = (text = '') => process.stdout.write(`${text}\n`);
const dim = (text) => `\x1b[2m${text}\x1b[22m`;
const bold = (text) => `\x1b[1m${text}\x1b[22m`;
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms / fast); });
const metro = `http://${host}:${port}`;
const link = devClient ? `exp+${slug}://expo-development-client/?url=${encodeURIComponent(metro)}` : `exp://${host}:${port}`;

let waiting = null; // what a key press answers right now
const keys = (handler) => { waiting = handler; };
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  for (const key of String(data).match(/\x1b\[[A-D]|[\s\S]/g) ?? []) {
    if (key === '\x03') { out(); out('› Stopping Metro'); server?.close(); process.exit(0); }
    waiting?.(key);
  }
});

function qr() {
  const size = 25; let seed = [...link].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  const random = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >> 16) & 1; };
  const finder = (x, y) => [[0, 0], [size - 7, 0], [0, size - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const dark = (x, y) => {
    if (finder(x, y)) { const [fx, fy] = [x < 7 ? 0 : size - 7, y < 7 ? 0 : size - 7]; const dx = x - fx; const dy = y - fy; return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5); }
    return random() === 1;
  };
  const grid = Array.from({ length: size + 2 }, (_, y) => Array.from({ length: size + 2 }, (_, x) => x > 0 && y > 0 && x <= size && y <= size && dark(x - 1, y - 1)));
  for (let y = 0; y < grid.length; y += 2) out(grid[y].map((top, x) => { const bottom = grid[y + 1]?.[x]; return top && bottom ? ' ' : top ? '▄' : bottom ? '▀' : '█'; }).join(''));
}
function menu() {
  out(`› Metro waiting on ${bold(link)}`);
  out(`› Scan the QR code above to open the project in ${devClient ? 'a development build' : 'Expo Go'}. ${dim('Learn more: https://expo.fyi/start')}`);
  out();
  if (web) { out(`› Web is waiting on ${bold(`http://localhost:${port}`)}`); out(); }
  out(`› Using ${devClient ? 'development build' : 'Expo Go'}`);
  out(`› Press ${bold('s')} │ switch to ${devClient ? 'Expo Go' : 'development build'}`);
  out();
  out(`› Press ${bold('a')} │ open Android`);
  out(`› Press ${bold('i')} │ open iOS simulator`);
  if (web) out(`› Press ${bold('w')} │ open web`);
  out();
  out(`› Press ${bold('j')} │ open debugger`);
  out(`› Press ${bold('r')} │ reload app`);
  out(`› Press ${bold('m')} │ toggle menu`);
  out(`› shift+m │ more tools`);
  out(`› Press ${bold('o')} │ open project code in your editor`);
  out();
  out(`› Press ${bold('?')} │ show all commands`);
  out();
  out('Logs for your project will appear below. Press Ctrl+C to exit.');
}
// Metro's WebSocket endpoints, just enough of the protocol for the dashboard: text frames each way, close, no ping.
const sockets = { events: new Set(), message: new Set() };
const frame = (text) => {
  const data = Buffer.from(text);
  const head = data.length < 126 ? Buffer.from([0x81, data.length]) : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255]) : Buffer.concat([Buffer.from([0x81, 127]), Buffer.from(BigInt(data.length).toString(16).padStart(16, '0'), 'hex')]);
  return Buffer.concat([head, data]);
};
const emit = (event) => { for (const socket of sockets.events) socket.write(frame(JSON.stringify(event))); };
const consoleLog = (text, level = 'log') => { out(` ${bold(level === 'error' ? 'ERROR' : 'LOG')}  ${text}`); emit({ type: 'client_log', level, data: [text] }); };
let connected = false;
function upgrade(req, socket) {
  const path = new URL(req.url, 'http://metro').pathname.slice(1);
  if (!sockets[path]) { socket.destroy(); return; }
  const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sockets[path].add(socket);
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15; let length = buffer[1] & 127; let at = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); at = 4; }
      const mask = buffer[1] & 128 ? buffer.subarray(at, at + 4) : null;
      if (mask) at += 4;
      if (buffer.length < at + length) return;
      const payload = Buffer.from(buffer.subarray(at, at + length));
      if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      buffer = buffer.subarray(at + length);
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (opcode === 1 && path === 'message') {
        let message = {};
        try { message = JSON.parse(payload.toString()); } catch {}
        if (message.method === 'reload') { out('› Reloading apps'); bundle('iOS', 1203); }
        if (message.method === 'devMenu') out('› Toggling dev menu');
      }
    }
  });
  socket.on('close', () => sockets[path].delete(socket));
  socket.on('error', () => sockets[path].delete(socket));
}
let bundling = Promise.resolve();
let builds = 0;
const bundle = (platform = 'iOS', modules = 1203, entry = 'node_modules/expo-router/entry.js') => {
  bundling = bundling.then(async () => {
    const buildID = String((builds += 1));
    emit({ type: 'bundle_build_started', buildID, bundleDetails: { platform: platform.toLowerCase(), entryFile: entry, bundleType: 'bundle', dev: true } });
    const steps = modules > 50 ? 14 : 3;
    for (let step = 0; step <= steps; step += 1) {
      const percent = (step / steps) * 100;
      const done = Math.round((percent / 100) * modules);
      const bar = '▓'.repeat(Math.round(percent / 6.25)).padEnd(16, '░');
      process.stdout.write(`\x1b[2K\x1b[1G${platform} Bundling ${bar} ${percent.toFixed(1).padStart(5)}% (${done}/${modules})`);
      emit({ type: 'bundle_transform_progressed', buildID, transformedFileCount: done, totalFileCount: modules });
      await sleep(modules > 50 ? 140 : 60);
    }
    process.stdout.write(`\x1b[2K\x1b[1G${platform} Bundled ${modules > 50 ? 1834 : 118}ms ${entry} (${modules} modules)\n`);
    emit({ type: 'bundle_build_done', buildID });
  });
  return bundling;
};
function select(question, options, done) {
  let at = 0;
  const draw = (first) => {
    if (!first) process.stdout.write(`\x1b[${options.length + 1}A`);
    process.stdout.write(`\x1b[2K\x1b[1G${bold('?')} ${question} › ${dim('- Use arrow-keys. Return to submit.')}\n`);
    options.forEach((option, index) => process.stdout.write(`\x1b[2K\x1b[1G${index === at ? '❯ ' : '  '}  ${option}${index < options.length - 1 ? '\n' : ''}`));
  };
  draw(true);
  keys((key) => {
    if (key === '\x1b[A') { at = (at + options.length - 1) % options.length; draw(); }
    else if (key === '\x1b[B') { at = (at + 1) % options.length; draw(); }
    else if (key === '\r') {
      process.stdout.write(`\x1b[${options.length}A\x1b[1G\x1b[J`);
      out(`\x1b[32m✔\x1b[39m ${question} › ${options[at]}`);
      done(options[at]);
    }
  });
}
function running() {
  keys((key) => {
    const actions = {
      r: () => { out('› Reloading apps'); bundle('iOS', 1203); },
      m: () => out('› Toggling dev menu'),
      j: () => out('› Opening the JavaScript debugger (Chrome DevTools)'),
      i: () => { out('› Opening on iOS...'); out(`› Opening ${link} on iPhone 16 Pro`); bundle('iOS', 1203); },
      a: () => { out('› Opening on Android...'); out('\x1b[31mCommandError: No Android connected device found, and no emulators could be started automatically.\x1b[39m'); out('Connect a device or create an emulator (https://docs.expo.dev/workflow/android-studio-emulator).'); },
      w: () => { if (!web) { out('› Web support isn’t installed: npx expo install react-native-web react-dom @expo/metro-runtime'); return; } out(`› Opening http://localhost:${port} in the browser`); bundle('Web', 842, 'index.ts'); },
      s: () => out(`› Switching to ${devClient ? 'Expo Go' : 'development build'}`),
      o: () => out('› Opening the project in your editor (code)'),
      '?': () => { menu(); },
      M: () => select('Dev tools', ['Open React devtools', 'Open Redux devtools', 'Open TanStack Query devtools'], (choice) => { out(`› ${choice.replace(/^Open /, 'Opening ')}`); running(); }),
    };
    actions[key]?.();
  });
}

let server;
async function start() {
  out(`Starting project at ${process.cwd()}`);
  if (args.includes('--tunnel')) {
    process.stdout.write(`${bold('?')} The package @expo/ngrok@^4.1.0 is required to use tunnels, would you like to install it globally? › (Y/n)`);
    const yes = await new Promise((done) => keys((key) => { if (/[yn\r]/i.test(key)) done(!/n/i.test(key)); }));
    out();
    if (!yes) { out('\x1b[31mCommandError: Install @expo/ngrok@^4.1.0 and try again\x1b[39m'); process.exit(1); }
    out('› Installing @expo/ngrok@^4.1.0'); await sleep(900); out('Tunnel connected.'); out('Tunnel ready.');
  }
  if (args.includes('--clear')) out('› Clearing the Metro bundler cache');
  out('Starting Metro Bundler');
  // Where Expo loads the app's metro.config.js: in this process, so macbuild's hook in it runs here too.
  const config = ['metro.config.js', 'metro.config.cjs'].map((name) => join(process.cwd(), name)).find((file) => existsSync(file));
  if (config) {
    try { createRequire(config)(config); } catch (error) { if (!/expo\/metro-config/.test(error.message)) out(`\x1b[31mError loading ${config}: ${error.message}\x1b[39m`); }
  }
  await sleep(700);
  server = createServer((req, res) => {
    if (req.url === '/status') { res.end('packager-status:running'); return; }
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(connected ? [{ id: '1-1', title: app?.name ?? slug, description: `com.acme.${slug}`, appId: `com.acme.${slug}`, deviceName: 'iPhone 16 Pro', type: 'node' }] : []));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name="viewport" content="width=device-width"><title>${app?.name ?? slug}</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0;background:#0f0f12;color:#ececf0"><div style="text-align:center"><h1 style="margin:0 0 6px">${app?.name ?? slug}</h1><p style="color:#a3a4ae;margin:0">Served by Metro on port ${port} (demo)</p></div>`);
  });
  server.on('error', (error) => { out(`\x1b[31mError: listen ${error.code}: address already in use :::${port}\x1b[39m`); process.exit(1); });
  server.on('upgrade', upgrade);
  server.listen(port);
  qr();
  out();
  menu();
  running();
  await sleep(1600);
  out(`${dim('iOS')} Connected to iPhone 16 Pro`);
  connected = true;
  await bundle('iOS', 1203);
  consoleLog(`[${slug}] App mounted in 412 ms`);
  try {
    // A changed file in the project rebundles, the way Fast Refresh does: what an agent watches for after an edit.
    let last = 0;
    watch(process.cwd(), { recursive: true }, (_, file) => {
      if (!file || /node_modules|\.git|\.log$/.test(file) || Date.now() - last < 400) return;
      last = Date.now();
      bundle('iOS', 1, file).then(() => consoleLog(`[${slug}] Fast Refresh: ${file}`));
    });
  } catch {}
}
start();
process.on('SIGTERM', () => { server?.close(); process.exit(143); });
process.on('SIGINT', () => { out(); out('› Stopping Metro'); server?.close(); process.exit(0); });
process.on('SIGHUP', () => process.exit(129));
