// The demo's web terminal: the real `macbuild setup` running in a pseudo-terminal, shown with xterm.js in the browser,
// so the terminal setup can be tried from any device. It runs against the demo's sample apps and stand-in agent.
// One session at a time; started by demo.mjs on the dashboard's port + 1. Listens on 127.0.0.1 only.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>macbuild setup · terminal</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
<style>
  :root { color-scheme: dark; --bg: #0b0b0d; --win: #0f0f12; --bar: #1b1b20; --line: #26262c; --text: #ececf0; --text-2: #a3a4ae; --accent: #7d7cf3; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    display: flex; flex-direction: column; gap: 12px; padding: max(14px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
  header { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 2px 12px; max-width: 1000px; width: 100%; margin: 0 auto; }
  header b { font-weight: 680; letter-spacing: -.02em; font-size: 15px; }
  header span { grid-column: 1; color: var(--text-2); font-size: 12.5px; }
  header button { grid-column: 2; grid-row: 1 / span 2; }
  button { height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bar); color: var(--text); font: 600 13px inherit; font-family: inherit; cursor: pointer; }
  button:hover { border-color: #3a3a42; }
  .win { flex: 1; min-height: 0; max-width: 1000px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; border-radius: 12px; overflow: hidden; background: var(--win); box-shadow: 0 0 0 1px #000, 0 24px 60px -24px rgb(0 0 0 / .8); }
  .bar { position: relative; flex: none; height: 32px; background: var(--bar); border-bottom: 1px solid var(--line); }
  .dots { position: absolute; left: 13px; top: 10px; display: flex; gap: 8px; }
  .dots i { width: 12px; height: 12px; border-radius: 50%; }
  .bar em { position: absolute; inset: 0; display: grid; place-items: center; color: #8b8c97; font: 600 12px inherit; font-style: normal; }
  #term { flex: 1; min-height: 0; padding: 10px 6px 6px 12px; }
  .keys { display: none; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 6px; flex: none; max-width: 1000px; width: 100%; margin: 0 auto; }
  .keys button { height: 44px; padding: 0; font-size: 15px; }
  @media (pointer: coarse) { .keys { display: grid; } }
  .ended { color: var(--text-2); font-size: 13px; text-align: center; }
</style></head><body>
<header><b>macbuild setup</b><span>The real terminal setup, on the demo’s sample apps</span><button id="restart" type="button">Start over</button></header>
<div class="win"><div class="bar"><div class="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><em>macbuild setup</em></div><div id="term"></div></div>
<div class="keys" aria-label="Keys">
  <button data-key="\\u001b[A" aria-label="Up">↑</button><button data-key="\\u001b[B" aria-label="Down">↓</button><button data-key=" ">Space</button><button data-key="\\r">Enter</button><button data-key="\\u001b">Esc</button><button id="type" type="button" aria-label="Keyboard">⌨︎</button>
</div>
<script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
<script>
  const term = new Terminal({ fontFamily: '"JetBrains Mono", "SF Mono", Menlo, ui-monospace, monospace', fontSize: innerWidth < 600 ? 11.5 : 13.5, lineHeight: 1.15, cursorBlink: false,
    theme: { background: '#0f0f12', foreground: '#d6d6dc', black: '#0f0f12', green: '#3ccb84', red: '#ff6a6d', yellow: '#f0a83a', brightBlack: '#5f606c' } });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit); term.open(document.getElementById('term')); fit.fit();
  let session = 0; let source = null;
  const send = (data) => fetch('/in?session=' + session, { method: 'POST', body: data });
  term.onData((data) => send(data));
  document.querySelectorAll('[data-key]').forEach((button) => button.addEventListener('click', () => { send(JSON.parse('"' + button.dataset.key + '"')); term.focus(); }));
  async function start(reset) {
    source?.close(); term.reset(); fit.fit();
    const res = await fetch('/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cols: term.cols, rows: term.rows, reset }) });
    session = (await res.json()).session;
    source = new EventSource('/out?session=' + session);
    source.onmessage = (event) => term.write(Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0)));
    source.addEventListener('exit', () => { source.close(); term.write('\\r\\n\\x1b[2m  Setup ended. Start over to run it again.\\x1b[0m\\r\\n'); });
    term.focus();
  }
  document.getElementById('restart').onclick = () => start(true);
  document.getElementById('type').onclick = () => term.focus(); // brings up the phone's keyboard, for typing a folder or a bundle id
  start(false);
</script></body></html>`;

export function startTerminal({ port, env }) {
  let current = null; // { id, child, chunks, listeners, code }
  const stop = () => { if (current?.child.exitCode === null) current.child.kill('SIGTERM'); };
  const begin = ({ cols = 90, rows = 32, reset = false }) => {
    stop();
    const size = (value, low, high, fallback) => (Number.isInteger(value) && value >= low && value <= high ? value : fallback);
    const args = [join(HERE, 'pty-bridge.py'), String(size(cols, 40, 240, 90)), String(size(rows, 12, 120, 32)), join(ROOT, 'bin/macbuild'), 'setup', ...(reset ? ['--reset'] : [])];
    const child = spawn('python3', ['-I', ...args], { env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }, stdio: ['pipe', 'pipe', 'inherit'] });
    const session = { id: (current?.id ?? 0) + 1, child, chunks: [], listeners: new Set(), code: null };
    child.stdout.on('data', (chunk) => { session.chunks.push(chunk); for (const listener of session.listeners) listener.write(`data: ${chunk.toString('base64')}\n\n`); });
    child.on('close', (code) => { session.code = code ?? 1; for (const listener of session.listeners) listener.end(`event: exit\ndata: ${session.code}\n\n`); session.listeners.clear(); });
    child.stdin.on('error', () => {});
    current = session;
    return session.id;
  };
  const body = (req) => new Promise((resolve) => { let text = ''; req.on('data', (chunk) => { if (text.length < 65536) text += chunk; }); req.on('end', () => resolve(text)); });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const mine = current && Number(url.searchParams.get('session')) === current.id;
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(PAGE); }
    if (req.method === 'POST' && url.pathname === '/start') {
      let options = {}; try { options = JSON.parse(await body(req)); } catch {}
      const id = begin({ cols: options.cols, rows: options.rows, reset: options.reset === true });
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ session: id }));
    }
    if (req.method === 'GET' && url.pathname === '/out' && mine) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      for (const chunk of current.chunks) res.write(`data: ${chunk.toString('base64')}\n\n`); // a reloaded page sees the screen so far
      if (current.code !== null) return res.end(`event: exit\ndata: ${current.code}\n\n`);
      const session = current;
      session.listeners.add(res);
      req.on('close', () => session.listeners.delete(res));
      return undefined;
    }
    if (req.method === 'POST' && url.pathname === '/in' && mine) { current.child.stdin.write(await body(req)); res.writeHead(204); return res.end(); }
    res.writeHead(404); return res.end();
  });
  server.listen(port, '127.0.0.1');
  return { server, stop };
}
