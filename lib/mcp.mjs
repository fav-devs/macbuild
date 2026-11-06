// Stdio MCP server so agents can wait on a build without polling.
//   macbuild mcp
import { stdin, stdout } from 'node:process';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { loadJobs, pickJob, summarize, waitFor } from './wait.mjs';
import { DEV_TOOLS, devTool, localTransport } from './dev-cli.mjs';

const TOOLS = [
  {
    name: 'wait',
    description: 'Block until a macbuild dashboard job finishes. Pass an id or project name, or omit for the latest. Do not poll show in a loop.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Build id or project name' },
        timeout: { type: 'number', description: 'Seconds to wait; 0 waits until it finishes' },
      },
    },
  },
  {
    name: 'show',
    description: 'JSON for one dashboard job: latest, or an id / project name.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'builds',
    description: 'List recent dashboard jobs. Optional project name or id prefix.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'log',
    description: 'The last lines of a job’s build log.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        tail: { type: 'number', description: 'Line count, default 80' },
      },
    },
  },
  ...DEV_TOOLS,
];

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text: String(text) }], ...(isError ? { isError: true } : {}) };
}

async function callTool(name, args = {}) {
  if (String(name).startsWith('dev_')) return textResult(JSON.stringify(await devTool(localTransport({ client: 'mcp' }), name, args), null, 2));
  const query = args.query ?? '';
  if (name === 'wait') {
    const { code, summary } = await waitFor({
      query, timeout: Number(args.timeout) || 0, silent: true, poll: 400,
    });
    return textResult(JSON.stringify(summary, null, 2), code !== 0);
  }
  const items = loadJobs();
  if (name === 'builds') {
    const list = query
      ? items.filter((item) => item.project === query || (item.id || '').startsWith(query))
      : items;
    return textResult(JSON.stringify(list.slice(0, 50).map((item) => summarize(item)), null, 2));
  }
  const item = pickJob(items, query);
  if (!item) return textResult(`no build matching ${query || 'latest'}`, true);
  if (name === 'show') return textResult(JSON.stringify(summarize(item), null, 2));
  if (name === 'log') {
    const path = summarize(item).log;
    if (!path || !existsSync(path)) return textResult(`no log for ${item.id}`, true);
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    const tail = Math.max(1, Number(args.tail) || 80);
    return textResult(lines.slice(-tail).join('\n'));
  }
  return textResult(`unknown tool ${name}`, true);
}

function handle(message) {
  const { id, method, params } = message;
  const reply = (result, error) => {
    if (id === undefined || id === null) return null;
    return error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result };
  };
  if (method === 'initialize') {
    return reply({
      protocolVersion: params?.protocolVersion || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'macbuild', version: '1.0.0' },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: TOOLS });
  if (method === 'resources/list') return reply({ resources: [] });
  if (method === 'prompts/list') return reply({ prompts: [] });
  if (method === 'tools/call') {
    return callTool(params?.name, params?.arguments ?? {}).then(
      (result) => reply(result),
      (error) => reply(textResult(error.message, true)),
    );
  }
  return reply(null, { code: -32601, message: `unknown method ${method}` });
}

function send(message) {
  const json = JSON.stringify(message);
  const buf = Buffer.from(json, 'utf8');
  stdout.write(`Content-Length: ${buf.length}\r\n\r\n`);
  stdout.write(buf);
}

function takeMessage(state) {
  const headerEnd = state.buffer.indexOf('\r\n\r\n');
  if (headerEnd >= 0) {
    const header = state.buffer.subarray(0, headerEnd).toString('utf8');
    const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
    if (!length || state.buffer.length < headerEnd + 4 + length) return null;
    const json = state.buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8');
    state.buffer = state.buffer.subarray(headerEnd + 4 + length);
    return JSON.parse(json);
  }
  const nl = state.buffer.indexOf('\n');
  if (nl < 0) return null;
  const line = state.buffer.subarray(0, nl).toString('utf8').trim();
  state.buffer = state.buffer.subarray(nl + 1);
  if (!line || !line.startsWith('{')) return takeMessage(state);
  return JSON.parse(line);
}

function serve() {
  const state = { buffer: Buffer.alloc(0) };
  let busy = Promise.resolve();
  const drain = async () => {
    for (;;) {
      let message;
      try {
        message = takeMessage(state);
      } catch (error) {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } });
        continue;
      }
      if (!message) break;
      const response = await handle(message);
      if (response) send(response);
    }
  };
  stdin.on('data', (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    busy = busy.then(drain);
  });
  stdin.on('end', () => { busy.then(() => process.exit(0)); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve();

export { handle, TOOLS, callTool };
