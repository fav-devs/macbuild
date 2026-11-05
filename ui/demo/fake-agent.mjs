#!/usr/bin/env node
// A stand-in for Claude Code (`claude -p`) and Codex (`codex exec`) for the setup demo and tests. It reads macbuild's
// prompt, pretends to look around (the same events the real ones print), and answers from the context it was given.
//   FAKE_AGENT_DELAY  ms between steps (default 250)    FAKE_AGENT_FAIL=1  fail like a signed-out agent
//   FAKE_AGENT_EXTRA  an app folder to "find" outside the usual folders    FAKE_AGENT_LOG  a file to log each call to
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const codex = args[0] === 'exec' || basename(process.argv[1]) === 'codex';
if (args[0] === '--version') { console.log(codex ? 'codex-cli 0.166.0' : '2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === '--help') { console.log('Usage: claude [options]\n  --json-schema <schema>\n  --tools <tools...>\n  --no-session-persistence\n  --strict-mcp-config'); process.exit(0); }

const delay = Number(process.env.FAKE_AGENT_DELAY ?? 250);
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });
let input = '';
for await (const chunk of process.stdin) input += chunk;
const task = input.match(/TASK: (\w+)/)?.[1] ?? 'find';
const context = JSON.parse(input.slice(input.indexOf('{', input.indexOf('CONTEXT')), input.lastIndexOf('\n\nFollow')));
if (process.env.FAKE_AGENT_LOG) appendFileSync(process.env.FAKE_AGENT_LOG, `${JSON.stringify({ args, task })}\n`);
const home = process.env.HOME;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (process.env.FAKE_AGENT_FAIL) {
  if (codex) emit({ type: 'turn.failed', error: { message: 'unexpected status 401 Unauthorized' } });
  else emit({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login' });
  process.exit(1);
}

let n = 0;
async function look(tool, input) {
  await sleep(delay);
  if (codex) emit({ type: 'item.started', item: { id: `item_${n++}`, type: 'command_execution', command: `/bin/zsh -lc ${tool === 'Glob' ? `"find ${input.path} -maxdepth 4 -name ${input.pattern}"` : `"cat ${input.file_path}"`}` } });
  else emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: tool, input }] } });
}

const and = (items) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const pretty = (name) => name.replace(/(^|-)(\w)/g, (_, dash, char) => `${dash ? ' ' : ''}${char.toUpperCase()}`);
let answer;
if (codex) emit({ type: 'thread.started', thread_id: 'fake-thread' }); else emit({ type: 'system', subtype: 'init' });

if (task === 'find') {
  for (const root of context.roots.slice(0, 3)) await look('Glob', { pattern: '**/app.json', path: root });
  const apps = [];
  const paths = [...context.candidates.map((app) => app.path), ...context.alreadyAdded.map((app) => app.path), ...(process.env.FAKE_AGENT_EXTRA ? [process.env.FAKE_AGENT_EXTRA] : [])];
  for (const path of [...new Set(paths)]) {
    await look('Read', { file_path: join(path, 'package.json') });
    await look('Read', { file_path: join(path, 'app.json') });
    const known = context.alreadyAdded.find((app) => app.path === path);
    const candidate = context.candidates.find((app) => app.path === path);
    const name = known?.name ?? basename(path);
    apps.push({
      path, name, title: candidate?.title ?? pretty(name), framework: 'expo', sdk: candidate?.sdk ?? null, platforms: ['ios', 'android'],
      bundleId: null, androidPackage: null, repo: candidate?.repo ?? null,
      note: candidate && !candidate.easJson ? 'no eas.json yet' : path === process.env.FAKE_AGENT_EXTRA ? 'outside your usual code folders' : null,
      suggested: true,
    });
  }
  const fresh = apps.filter((app) => !context.alreadyAdded.some((known) => known.path === app.path));
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
  const count = (k) => words[k] ?? String(k);
  const missing = apps.filter((app) => app.note === 'no eas.json yet').map((app) => app.title);
  answer = {
    say: `I found ${count(apps.length)} Expo app${apps.length === 1 ? '' : 's'}${fresh.length && fresh.length < apps.length ? `, ${count(fresh.length)} of them not in macbuild yet` : ''}.${missing.length ? ` ${and(missing)} ${missing.length === 1 ? 'has' : 'have'} no eas.json yet; macbuild can add one.` : ''}${process.env.FAKE_AGENT_EXTRA ? ` ${pretty(basename(process.env.FAKE_AGENT_EXTRA))} was outside your usual code folders.` : ''}`,
    apps, questions: [], actions: [], done: true,
  };
} else {
  for (const app of context.apps) {
    await look('Read', { file_path: join(app.path, 'app.json') });
    await look('Read', { file_path: join(app.path, 'eas.json') });
    if (existsSync(join(app.path, 'app.config.ts'))) await look('Read', { file_path: join(app.path, 'app.config.ts') });
  }
  const TYPES = { easjson: ['create_eas_json'], profile: ['add_profile', null, 'development'], devclient: ['install_dev_client'], link: ['link_eas'], bundle: ['set_config', 'ios.bundleIdentifier'], package: ['set_config', 'android.package'] };
  const questions = []; const actions = [];
  for (const issue of context.issues) {
    const [kind] = issue.id.split('-');
    const type = TYPES[kind];
    if (!type) continue;
    if (issue.question) questions.push({ ...issue.question, help: issue.question.help ?? null });
    actions.push({ type: type[0], app: issue.app, key: type[1] ?? null, value: type[2] ?? null, answer: issue.question ? issue.question.id : null, why: issue.detail.replace(/\.$/, '') });
  }
  const needs = [...new Set(actions.filter((action) => action.key !== 'android.package').map((action) => action.app))]; // Android-only fixes are optional
  const ready = context.apps.map((app) => app.name).filter((name) => !needs.includes(name));
  const title = (name) => context.apps.find((app) => app.name === name)?.title ?? name;
  answer = {
    say: [ready.length ? `${and(ready.map(title))} ${ready.length === 1 ? 'is' : 'are'} ready to build.` : '', needs.length ? `${and(needs.map(title))} ${needs.length === 1 ? 'needs' : 'need'} ${actions.length === 1 ? 'one change' : 'a few changes'} so EAS doesn’t stop to ask; I filled in identifiers from your Expo username.` : ''].filter(Boolean).join(' ') || 'Everything looks ready.',
    apps: [], questions, actions, done: true,
  };
}
await sleep(delay);
const text = JSON.stringify(answer);
if (codex) {
  emit({ type: 'item.completed', item: { id: `item_${n++}`, type: 'agent_message', text } });
  const out = args[args.indexOf('-o') + 1];
  if (out) writeFileSync(out, text);
  emit({ type: 'turn.completed', usage: { input_tokens: 1000, output_tokens: 200 } });
} else emit({ type: 'result', subtype: 'success', is_error: false, result: text, structured_output: answer });
