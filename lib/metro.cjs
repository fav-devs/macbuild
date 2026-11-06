'use strict';
// macbuild's hook for an app's metro.config.js:
//
//   try { require('@fav-devs/macbuild/metro').attach(); } catch {}
//
// Expo loads metro.config.js inside the `expo start` process, so from here macbuild can show that whole terminal on
// the dashboard: everything Expo writes goes there too, and keys from the dashboard (r, i, a, w, answers to prompts)
// reach Expo as if typed. The terminal itself is unchanged. It connects to the dashboard over a socket in your home
// folder (only you can open it) and does nothing unless this is `expo start` (or run:ios, run:android) on a Mac where
// the macbuild dashboard is running: not in CI, not in EAS builds or `expo export`, not for teammates without macbuild
// (the require above fails there and the catch ignores it), and not inside macbuild's own dev servers.
// MACBUILD_ATTACH=0 turns it off. No dependencies, and nothing here can make Expo fail.
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const KEY = Symbol.for('macbuild.devHook');
const SERVES = ['start', 'run:ios', 'run:android'];
const KEEP = 512 * 1024; // the screen so far, for a dashboard that connects (or reconnects) later

const socketPath = () => process.env.MACBUILD_DEV_SOCKET || path.join(os.homedir(), '.local', 'share', 'macbuild', 'dev.sock');
const isSocket = (file) => { try { return fs.statSync(file).isSocket(); } catch { return false; } };

function wanted() {
  if (process[KEY] || process.env.MACBUILD_ATTACH === '0' || process.env.MACBUILD_DEV_SESSION) return false;
  if (process.env.CI && !['0', 'false'].includes(process.env.CI)) return false;
  if (!/expo|react-native/.test(process.argv[1] || '')) return false;
  if (!process.argv.slice(2).some((arg) => SERVES.includes(arg))) return false;
  return isSocket(socketPath());
}

function attach() {
  try { if (!wanted()) return false; } catch { return false; }
  process[KEY] = true;
  const file = socketPath();
  const recent = [];
  let recentBytes = 0;
  let socket = null;
  let ready = false;
  let done = false;
  const send = (message) => {
    if (!ready || !socket || socket.writableLength > 8 * 1024 * 1024) return;
    try { socket.write(`${JSON.stringify(message)}\n`); } catch {}
  };
  const keep = (buffer) => {
    recent.push(buffer); recentBytes += buffer.length;
    while (recentBytes > KEEP && recent.length > 1) recentBytes -= recent.shift().length;
  };
  // Everything Expo and Metro write, as written: the terminal gets it unchanged, the dashboard gets a copy.
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write;
    stream.write = function macbuildMirror(chunk, encoding) {
      try {
        if (chunk !== undefined && chunk !== null) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8');
          keep(buffer);
          send({ type: 'out', data: buffer.toString('base64') });
        }
      } catch {}
      return write.apply(this, arguments);
    };
  }
  // Keys from the dashboard, delivered the way the terminal delivers them: Expo's key handler and its prompts both
  // read stdin's data events.
  const inject = (data) => {
    try {
      const stdin = process.stdin;
      stdin.emit('data', stdin.readableEncoding ? data.toString(stdin.readableEncoding) : data);
    } catch {}
  };
  const hello = () => ({
    type: 'hello', version: 1, pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(1, 16),
    cols: process.stdout.columns || 0, rows: process.stdout.rows || 0, tty: Boolean(process.stdout.isTTY), startedAt: Math.round(Date.now() - process.uptime() * 1000),
  });
  const later = (ms) => { const timer = setTimeout(connect, ms); timer.unref(); };
  function connect() {
    if (done) return;
    if (!isSocket(file)) { later(3000); return; }
    let buffer = '';
    const conn = net.createConnection(file);
    socket = conn;
    conn.unref(); // never keeps Expo running
    conn.setEncoding('utf8');
    conn.on('connect', () => {
      ready = true;
      send(hello());
      for (const chunk of recent) send({ type: 'out', data: chunk.toString('base64') });
    });
    conn.on('data', (text) => {
      buffer += text;
      if (buffer.length > 4 * 1024 * 1024) { conn.destroy(); return; }
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message && message.type === 'in' && typeof message.data === 'string') inject(Buffer.from(message.data, 'base64'));
        if (message && message.type === 'bye') { done = true; conn.end(); } // not one of macbuild's projects, or one is already running here
      }
    });
    conn.on('error', () => {});
    conn.on('close', () => {
      if (socket === conn) { socket = null; ready = false; }
      later(3000); // the dashboard restarted: show up again when it's back
    });
  }
  if (process.stdout.isTTY) process.stdout.on('resize', () => send({ type: 'size', cols: process.stdout.columns || 0, rows: process.stdout.rows || 0 }));
  process.once('exit', () => { done = true; });
  connect();
  return true;
}

// For a config that prefers wrapping: module.exports = withMacbuild(getDefaultConfig(__dirname)).
function withMacbuild(config) { attach(); return config; }

module.exports = { attach, withMacbuild };
