import { sourceState } from './remote-client.mjs';

const tool = (name, description, properties = {}, required = [], readOnly = true) => ({ name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false }, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } });
const string = { type: 'string' };
const sourceProperties = { project: string, ref: string, profile: string, platform: { type: 'string', enum: ['ios', 'android', 'all'] }, allowDirty: { type: 'boolean' }, requestId: string };
export const REMOTE_TOOLS = [
  tool('projects', 'List permitted projects and build profiles on the Mac.'),
  tool('commits', 'Review the last 20 pushed commits on a project branch (default main).', { project: string, ref: string }, ['project']),
  tool('builds', 'List remote jobs, optionally filtered by project.', { query: string }),
  tool('show', 'Read one job. Query can be an id or project name.', { query: string }),
  tool('log', 'Read the latest job log lines.', { query: string, tail: { type: 'number' } }),
  tool('wait', 'Wait for a remote job to finish instead of polling show.', { query: string, timeout: { type: 'number', minimum: 0 } }),
  tool('source', 'Inspect pushed source in the client working directory. Reject dirty files and unpushed commits.', { ref: string, allowDirty: { type: 'boolean' } }),
  tool('build', 'Queue a local build on the Mac from an exact pushed commit. Never commits or pushes. Use wait for completion.', sourceProperties, ['project'], false),
  tool('update', 'Publish OTA ONLY when the user requests a release. Requires release confirmation and an authorized token.', { ...sourceProperties, channel: string, message: string, environment: string, confirmRelease: { type: 'boolean' } }, ['project', 'ref', 'channel', 'message', 'confirmRelease'], false),
  tool('submit', 'Submit an existing pushed-source artifact ONLY when the user requests a store release.', { query: string, confirmRelease: { type: 'boolean' }, allowDirty: { type: 'boolean' }, requestId: string }, ['query', 'confirmRelease'], false),
  tool('cancel', 'Cancel a queued or running remote job. Cannot retract an accepted release.', { query: string, requestId: string }, ['query'], false),
];
export async function remoteTool(client, name, args = {}, signal) {
  const spec = REMOTE_TOOLS.find((item) => item.name === name);
  if (!spec) throw new Error('Unknown tool.');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some((key) => !Object.hasOwn(spec.inputSchema.properties, key))) throw new Error('Invalid tool arguments.');
  for (const key of spec.inputSchema.required) if (args[key] === undefined) throw new Error(`Missing ${key}.`);
  for (const [key, value] of Object.entries(args)) {
    const property = spec.inputSchema.properties[key];
    if (typeof value !== property.type || (property.enum && !property.enum.includes(value)) || (property.type === 'number' && (!Number.isFinite(value) || value < (property.minimum ?? 0)))) throw new Error(`Invalid ${key}.`);
  }
  if (name === 'projects') return client.request('/projects');
  if (name === 'commits') return client.request(`/projects/${encodeURIComponent(args.project)}/commits?ref=${encodeURIComponent(args.ref || 'main')}`);
  if (name === 'builds') return (await client.request('/jobs')).filter((job) => !args.query || job.project === args.query || job.id.startsWith(args.query));
  if (name === 'source') return sourceState({ ref: args.ref, allowDirty: args.allowDirty });
  if (['build', 'update'].includes(name)) {
    if (name === 'build' && args.platform === 'all') throw new Error('Native builds need ios or android.');
    if (name === 'update' && args.confirmRelease !== true) throw new Error('OTA requires explicit release confirmation.');
    const state = await sourceState({ ref: args.ref, allowDirty: args.allowDirty });
    return client.request('/jobs', { method: 'POST', key: args.requestId, body: { action: name, project: args.project, profile: args.profile || (name === 'build' ? 'development' : 'production'), platform: args.platform || (name === 'build' ? 'ios' : 'all'), ref: state.ref, commit: state.commit, repository: state.repository,
      ...(name === 'update' ? { channel: args.channel, message: args.message, environment: args.environment, confirmRelease: true } : {}) } });
  }
  const job = await client.pick(args.query);
  const path = `/jobs/${encodeURIComponent(job.id)}`;
  if (name === 'show') return job;
  if (name === 'log') return client.request(`${path}/log?tail=${args.tail || 80}`);
  if (name === 'wait') {
    const result = await client.wait(job.id, { timeout: args.timeout || 0, signal });
    return { ...result.job, exitCode: result.code };
  }
  if (name === 'cancel') return client.request(`${path}/cancel`, { method: 'POST', body: {}, key: args.requestId });
  if (name === 'submit') {
    if (args.confirmRelease !== true) throw new Error('Submission requires explicit release confirmation.');
    const state = await sourceState({ ref: job.commit?.hash, allowDirty: args.allowDirty });
    return client.request(`${path}/submit`, { method: 'POST', key: args.requestId, body: { confirmRelease: true, repository: state.repository } });
  }
}
export function serveRemoteMcp(client, input = process.stdin, output = process.stdout) {
  let buffer = '';
  const running = new Map();
  const send = (value) => output.write(`${JSON.stringify(value)}\n`);
  const handle = async (message) => {
    const { id, method, params } = message;
    const reply = (result) => { if (id !== undefined) send({ jsonrpc: '2.0', id, result }); };
    if (method === 'notifications/cancelled') { running.get(params?.requestId)?.abort(); return; }
    if (id === undefined) return;
    if (method === 'initialize') return reply({ protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'macbuild-remote', version: '0.2.0' } });
    if (method === 'ping') return reply({});
    if (method === 'tools/list') return reply({ tools: REMOTE_TOOLS });
    if (method === 'resources/list') return reply({ resources: [] });
    if (method === 'prompts/list') return reply({ prompts: [] });
    if (method !== 'tools/call') return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Unknown method.' } });
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const result = await remoteTool(client, params?.name, params?.arguments ?? {}, controller.signal);
      reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
    } catch (error) { reply({ isError: true, content: [{ type: 'text', text: error.message }] }); }
    finally { running.delete(id); }
  };
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1048576) { input.destroy(); return; }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try { const message = JSON.parse(line); if (!message || typeof message !== 'object') throw new Error('Invalid JSON-RPC'); handle(message).catch(() => {}); }
      catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }); }
    }
  });
  input.on('end', () => { for (const controller of running.values()) controller.abort(); });
}
