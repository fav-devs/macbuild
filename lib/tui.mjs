// A small terminal UI: pick one, tick several, type, yes or no, a spinner, and handing the terminal to a command.
// No dependencies. Each prompt redraws in place while it's open, then folds into one line with the answer.
import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';

const ESC = '\x1b[';
const strip = (text) => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
export const width = (text) => [...strip(text)].length;

export function theme(output = process.stdout) {
  const on = Boolean(output.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
  const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM ?? '');
  const wrap = (open, close = '\x1b[39m') => (text) => (on ? `${open}${text}${close}` : String(text));
  return {
    on,
    bold: wrap('\x1b[1m', '\x1b[22m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    accent: wrap(truecolor ? '\x1b[38;2;125;124;243m' : '\x1b[38;5;105m'),
    ok: wrap(truecolor ? '\x1b[38;2;60;203;132m' : '\x1b[32m'),
    bad: wrap(truecolor ? '\x1b[38;2;255;106;109m' : '\x1b[31m'),
    warn: wrap(truecolor ? '\x1b[38;2;240;168;58m' : '\x1b[33m'),
    inverse: wrap('\x1b[7m', '\x1b[27m'),
  };
}

export function wrapText(text, size) {
  const lines = [];
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && width(line) + 1 + width(word) > size) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

// Cuts a styled line to n visible characters, keeping its escape codes.
function cut(text, n) {
  if (width(text) <= n) return text;
  let out = ''; let seen = 0;
  for (const part of String(text).split(/(\x1b\[[0-9;?]*[A-Za-z])/)) {
    if (part.startsWith('\x1b[')) { out += part; continue; }
    for (const char of part) {
      if (seen >= n - 1) return `${out}…\x1b[0m`;
      out += char; seen += 1;
    }
  }
  return out;
}

export function createTui({ input = process.stdin, output = process.stdout } = {}) {
  const t = theme(output);
  const cols = () => Math.max(40, Math.min(output.columns || 80, 100));
  const rowsAvailable = () => Math.max(8, (output.rows || 30) - 6);
  let drawn = 0; // rows of the open prompt, to redraw it in place
  let keyHandler = null;
  let raw = false;
  emitKeypressEvents(input);
  const onKey = (str, key = {}) => {
    if (key.ctrl && key.name === 'c') { tui.onInterrupt(); return; }
    keyHandler?.(str, key);
  };
  const listen = (handler) => {
    keyHandler = handler;
    if (input.isTTY && !raw) { input.setRawMode(true); raw = true; }
    input.on('keypress', onKey);
    input.resume();
  };
  // The terminal stays raw between prompts, so keys typed ahead wait, in order, for the next one. Line mode would
  // hold them until a newline and hand them over in the wrong order. Only a handed-off command or the end restores it.
  const unlisten = () => {
    keyHandler = null;
    input.off('keypress', onKey);
    input.pause();
  };
  const cooked = () => { if (input.isTTY && raw) { input.setRawMode(false); raw = false; } };
  const draw = (lines) => {
    let out = drawn ? `${ESC}${drawn}A\r${ESC}J` : '';
    out += lines.map((line) => cut(line, cols() - 1)).join('\n') + '\n';
    drawn = lines.length;
    output.write(out);
  };
  const settle = (lines) => { draw(lines); drawn = 0; };
  const hideCursor = () => t.on && output.write(`${ESC}?25l`);
  const showCursor = () => t.on && output.write(`${ESC}?25h`);

  const pad = '  ';
  const tui = {
    t, cols, pad,
    onInterrupt: () => { tui.restore(); process.exit(130); },
    restore() { showCursor(); cooked(); },
    write(text = '') { output.write(text); },
    line(text = '') { output.write(`${text}\n`); },
    clear() { if (t.on) output.write(`${ESC}2J${ESC}H`); },
    paragraph(text, style = (line) => line, indent = pad) {
      for (const line of wrapText(text, cols() - indent.length - 2)) tui.line(`${indent}${style(line)}`);
    },

    // Pick one. options: [{ value, label, detail, disabled }]
    select({ label, help, options, value }) {
      let at = Math.max(0, options.findIndex((option) => option.value === value && !option.disabled));
      if (options[at]?.disabled) at = options.findIndex((option) => !option.disabled);
      const labelWidth = Math.min(28, Math.max(...options.map((option) => width(option.label)))) + 2;
      return new Promise((resolve) => {
        const render = () => {
          const lines = [`${pad}${t.accent('?')} ${t.bold(label)}`];
          for (const line of help ? wrapText(help, cols() - 8) : []) lines.push(`${pad}  ${t.dim(line)}`);
          for (const [index, option] of window(options, at).items) {
            const here = index === at;
            const name = option.disabled ? t.dim(option.label) : here ? t.accent(t.bold(option.label)) : option.label;
            const gap = ' '.repeat(Math.max(1, labelWidth - width(option.label)));
            lines.push(`${pad}${here ? t.accent('❯') : ' '} ${name}${option.detail ? `${gap}${t.dim(option.detail)}` : ''}`);
          }
          lines.push(`${pad}  ${t.dim('↑↓ choose · enter select')}`);
          draw(lines);
        };
        const move = (step) => {
          for (let next = at + step; next >= 0 && next < options.length; next += step) {
            if (!options[next].disabled) { at = next; return; }
          }
        };
        hideCursor(); render();
        listen((str, key) => {
          if (key.name === 'up' || str === 'k') move(-1);
          else if (key.name === 'down' || str === 'j' || key.name === 'tab') move(1);
          else if (/^[1-9]$/.test(str ?? '') && options[Number(str) - 1] && !options[Number(str) - 1].disabled) at = Number(str) - 1;
          else if ((key.name === 'return' || key.name === 'enter')) {
            unlisten(); showCursor();
            settle([`${pad}${t.ok('✓')} ${label}  ${t.accent(options[at].label)}`]);
            resolve(options[at].value);
            return;
          }
          render();
        });
      });
    },

    // Tick any. options: [{ value, label, detail, tag, badge, disabled }]; value: the ticked values.
    multi({ label, help, options, value = [] }) {
      const ticked = new Set(value);
      let at = Math.max(0, options.findIndex((option) => !option.disabled));
      return new Promise((resolve) => {
        const render = () => {
          const lines = [`${pad}${t.accent('?')} ${t.bold(label)}`];
          for (const line of help ? wrapText(help, cols() - 8) : []) lines.push(`${pad}  ${t.dim(line)}`);
          const view = window(options, at, 2);
          if (view.before) lines.push(`${pad}  ${t.dim(`↑ ${view.before} more`)}`);
          for (const [index, option] of view.items) {
            const here = index === at;
            const box = option.disabled ? t.dim('◉') : ticked.has(option.value) ? t.accent('◉') : t.dim('◯');
            const tag = option.tag ? `${t.accent(option.tag)} ${t.dim('›')} ` : '';
            const badge = option.badge ? ` ${t.dim(`(${option.badge.toLowerCase()})`)}` : '';
            const name = option.disabled ? t.dim(option.label) : here ? t.bold(option.label) : option.label;
            lines.push(`${pad}${here ? t.accent('❯') : ' '} ${box} ${tag}${name}${badge}`);
            if (option.detail) lines.push(`${pad}      ${t.dim(option.detail)}`);
          }
          if (view.after) lines.push(`${pad}  ${t.dim(`↓ ${view.after} more`)}`);
          lines.push(`${pad}  ${t.dim('↑↓ move · space tick · a all · enter continue')}`);
          draw(lines);
        };
        const move = (step) => {
          for (let next = at + step; next >= 0 && next < options.length; next += step) {
            if (!options[next].disabled) { at = next; return; }
          }
        };
        hideCursor(); render();
        listen((str, key) => {
          const option = options[at];
          if (key.name === 'up' || str === 'k') move(-1);
          else if (key.name === 'down' || str === 'j' || key.name === 'tab') move(1);
          else if (key.name === 'space' && option && !option.disabled) { if (ticked.has(option.value)) ticked.delete(option.value); else ticked.add(option.value); }
          else if (str === 'a') {
            const free = options.filter((item) => !item.disabled);
            const all = free.every((item) => ticked.has(item.value));
            for (const item of free) { if (all) ticked.delete(item.value); else ticked.add(item.value); }
          } else if ((key.name === 'return' || key.name === 'enter')) {
            unlisten(); showCursor();
            const picked = options.filter((item) => ticked.has(item.value) || item.disabled);
            const names = picked.map((item) => (item.tag ? `${item.tag}: ${item.label}` : item.label));
            settle([`${pad}${t.ok('✓')} ${label}  ${t.accent(names.length ? clipList(names) : 'none')}`]);
            resolve(options.filter((item) => ticked.has(item.value)).map((item) => item.value));
            return;
          }
          render();
        });
      });
    },

    // Type something. The default is filled in, ready to keep or edit.
    text({ label, help, value = '', placeholder = '', validate = () => '' }) {
      let textValue = String(value ?? ''); let cursor = textValue.length; let error = '';
      return new Promise((resolve) => {
        const render = () => {
          const shown = textValue ? `${textValue.slice(0, cursor)}${t.inverse(textValue[cursor] ?? ' ')}${textValue.slice(cursor + 1)}` : `${t.inverse(' ')}${t.dim(placeholder)}`;
          const lines = [`${pad}${t.accent('?')} ${t.bold(label)}`];
          for (const line of help ? wrapText(help, cols() - 8) : []) lines.push(`${pad}  ${t.dim(line)}`);
          lines.push(`${pad}  ${t.accent('›')} ${shown}`);
          lines.push(error ? `${pad}  ${t.bad(error)}` : `${pad}  ${t.dim('enter to continue')}`);
          draw(lines);
        };
        hideCursor(); render();
        listen((str, key) => {
          if ((key.name === 'return' || key.name === 'enter')) {
            error = validate(textValue) || '';
            if (!error) {
              unlisten(); showCursor();
              settle([`${pad}${t.ok('✓')} ${label}  ${t.accent(textValue || t.dim('none'))}`]);
              resolve(textValue);
              return;
            }
          } else if (key.name === 'backspace') { if (cursor > 0) { textValue = textValue.slice(0, cursor - 1) + textValue.slice(cursor); cursor -= 1; } }
          else if (key.name === 'delete') textValue = textValue.slice(0, cursor) + textValue.slice(cursor + 1);
          else if (key.name === 'left') cursor = Math.max(0, cursor - 1);
          else if (key.name === 'right') cursor = Math.min(textValue.length, cursor + 1);
          else if (key.name === 'home' || (key.ctrl && key.name === 'a')) cursor = 0;
          else if (key.name === 'end' || (key.ctrl && key.name === 'e')) cursor = textValue.length;
          else if (key.ctrl && key.name === 'u') { textValue = textValue.slice(cursor); cursor = 0; }
          else if (str && !key.ctrl && !key.meta && str >= ' ' && str !== '\x7f') { textValue = textValue.slice(0, cursor) + str + textValue.slice(cursor); cursor += str.length; error = ''; }
          render();
        });
      });
    },

    // Yes or no.
    confirm({ label, help, value = true }) {
      let yes = Boolean(value);
      return new Promise((resolve) => {
        const render = () => {
          const choice = (on, text) => (on ? t.accent(t.bold(`● ${text}`)) : t.dim(`○ ${text}`));
          const lines = [`${pad}${t.accent('?')} ${t.bold(label)}  ${choice(yes, 'Yes')}  ${choice(!yes, 'No')}`];
          for (const line of help ? wrapText(help, cols() - 8) : []) lines.push(`${pad}  ${t.dim(line)}`);
          draw(lines);
        };
        hideCursor(); render();
        listen((str, key) => {
          if (['left', 'right', 'tab', 'space', 'up', 'down'].includes(key.name)) yes = !yes;
          else if (str === 'y' || str === 'Y') yes = true;
          else if (str === 'n' || str === 'N') yes = false;
          else if ((key.name === 'return' || key.name === 'enter')) {
            unlisten(); showCursor();
            settle([`${pad}${t.ok('✓')} ${label}  ${t.accent(yes ? 'Yes' : 'No')}`]);
            resolve(yes);
            return;
          }
          render();
        });
      });
    },

    // A spinner over a few lines of what's happening. lines() is read on every frame.
    spinner({ label, lines = () => [], hint = '', onKey = null }) {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      const started = Date.now(); let frame = 0;
      const clock = () => { const s = Math.floor((Date.now() - started) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      const render = () => {
        const body = lines().slice(-4);
        const out = [`${pad}${t.accent(frames[frame++ % frames.length])} ${t.bold(typeof label === 'function' ? label() : label)}  ${t.dim(clock())}`];
        body.forEach((line, index) => out.push(`${pad}  ${index === body.length - 1 ? line : t.dim(line)}`));
        if (hint) out.push(`${pad}  ${t.dim(hint)}`);
        draw(out);
      };
      hideCursor(); render();
      const timer = setInterval(render, 90);
      listen(onKey ?? (() => {})); // even without keys of its own: in raw mode Ctrl-C only arrives as a key
      return {
        render,
        stop(text, tone = 'ok') {
          clearInterval(timer);
          unlisten();
          showCursor();
          settle([`${pad}${tone === 'ok' ? t.ok('✓') : tone === 'bad' ? t.bad('✗') : t.dim('·')} ${text}  ${t.dim(clock())}`]);
        },
      };
    },

    // Gives the terminal to a command (eas credentials, brew install, ...) and takes it back when it ends.
    handoff({ argv, cwd, display }) {
      const rule = (text) => t.dim(`${'─'.repeat(2)} ${text} ${'─'.repeat(Math.max(2, cols() - width(text) - 8))}`);
      tui.line();
      tui.line(`${pad}${rule(display ?? argv.join(' '))}`);
      tui.line();
      cooked();
      return new Promise((resolve) => {
        const child = spawn(argv[0], argv.slice(1), { cwd, stdio: 'inherit' });
        const ignore = () => {}; // Ctrl-C belongs to the command while it runs
        process.on('SIGINT', ignore);
        child.on('error', (error) => { process.off('SIGINT', ignore); tui.line(`${pad}${t.bad(error.code === 'ENOENT' ? `${argv[0]} isn’t installed` : error.message)}`); resolve(127); });
        child.on('close', (code) => {
          process.off('SIGINT', ignore);
          tui.line();
          tui.line(`${pad}${rule(code === 0 ? 'done' : `exited with ${code}`)}`);
          tui.line();
          resolve(code ?? 1);
        });
      });
    },
  };

  // Long lists scroll: the options around the cursor that fit on screen.
  function window(options, at, rowsEach = 1) {
    const max = Math.max(3, Math.floor(rowsAvailable() / rowsEach));
    if (options.length <= max) return { items: options.map((option, index) => [index, option]), before: 0, after: 0 };
    const start = Math.min(Math.max(0, at - Math.floor(max / 2)), options.length - max);
    return { items: options.slice(start, start + max).map((option, index) => [start + index, option]), before: start, after: options.length - start - max };
  }
  return tui;
}

function clipList(names) {
  const text = names.join(', ');
  return text.length > 60 ? `${names.length} picked` : text;
}
