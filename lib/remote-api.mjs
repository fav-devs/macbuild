import { appendFileSync, mkdirSync, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { dirname } from 'node:path';
import { authenticate, accessFile, repositoryId } from './remote-access.mjs';

function logTail(file, lines) {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    const size = fstatSync(descriptor).size;
    const length = Math.min(size, 500000);
    const buffer = Buffer.alloc(length);
    const count = readSync(descriptor, buffer, 0, length, size - length);
    return buffer.subarray(0, count).toString('utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

// The dev server, for remote clients: the Mac's own working copy, served by Metro there. Reading it needs the read
// scope; starting, stopping and pressing keys need dev. Paths on the Mac and process ids stay on the Mac.
const devSession = (session) => { if (!session) return null; const { pid, ...rest } = session; return rest; };
const devView = ({ dir, history, session, ...view }) => ({ ...view, session: devSession(session), history: (history ?? []).map(devSession) });

export function remoteApi({ projects, profiles, git, run, enqueue, enqueueUpdate, jobs, read, validId, logPath, cancel, download, submit, json, dev }) {
  let mutations = Promise.resolve();
  const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
  const allowed = (token, scope, project) => {
    if (!token.scopes.includes(scope) || (project && !token.projects.includes(project))) fail(403, 'Token does not permit this action or project.');
  };
  const cleanJob = (job) => {
    const { id, project, status, action, profile, platform, commit, ref, source, channel, environment, updateMessage, updateUrl, createdAt, startedAt, finishedAt, reason, buildCompleted, submission, submissionOf, expired } = job;
    return { id, project, status, action, profile, platform, commit, ref, source, channel, environment, updateMessage, updateUrl, createdAt, startedAt, finishedAt, reason, buildCompleted, submission, submissionOf, expired };
  };
  const projectOf = (token, name, scope = 'read') => {
    allowed(token, scope, name);
    const project = projects().find((item) => item.name === name);
    if (!project) fail(404, 'Unknown project.');
    return project;
  };
  const source = async (token, input, scope) => {
    const project = projectOf(token, input.project, scope);
    if (!token.profiles.includes(input.profile) || !profiles(project.dir).some((item) => item.name === input.profile)) fail(403, 'Profile is not allowed for this token.');
    if (typeof input.ref !== 'string' || !/^[\w./-]{1,200}$/.test(input.ref) || input.ref.includes('..') || input.ref.startsWith('-')) fail(400, 'A pushed --ref is required.');
    if (typeof input.commit !== 'string' || !/^[a-f0-9]{40}$/.test(input.commit)) fail(400, 'An exact source commit is required.');
    let origin;
    try { origin = repositoryId(await git(project.dir, 'config', '--get', 'remote.origin.url')); }
    catch { fail(409, 'Server project has no supported origin.'); }
    if (input.repository !== origin) fail(409, 'Local and server repository origins do not match.');
    try { await run('git', ['-C', project.dir, 'fetch', '-q', '--prune', 'origin'], { timeout: 30000 }); }
    catch { fail(409, 'Server could not fetch origin. No job was queued.'); }
    const resolved = await git(project.dir, 'rev-parse', '--verify', '-q', `origin/${input.ref}^{commit}`) || await git(project.dir, 'rev-parse', '--verify', '-q', `${input.ref}^{commit}`);
    if (resolved !== input.commit || !(await git(project.dir, 'for-each-ref', `--contains=${resolved}`, '--format=%(refname)', 'refs/remotes/origin'))) fail(409, 'Source is unpushed or the branch moved. Refresh source and retry.');
    if (token.requiredChecks?.length) {
      if (!origin.startsWith('github.com/')) fail(409, 'Required CI checks currently require GitHub.');
      try {
        const repo = origin.slice('github.com/'.length);
        const checks = JSON.parse((await run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/commits/${resolved}/check-runs?per_page=100`], { timeout: 30000 })).stdout).flatMap((page) => page.check_runs ?? []);
        const statuses = JSON.parse((await run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/commits/${resolved}/statuses?per_page=100`], { timeout: 30000 })).stdout).flat();
        for (const name of token.requiredChecks) {
          const check = checks.filter((item) => item.name === name && item.head_sha === resolved).sort((left, right) => right.id - left.id)[0];
          const status = statuses.filter((item) => item.context === name).sort((left, right) => right.id - left.id)[0];
          if (check ? check.status !== 'completed' || check.conclusion !== 'success' : status?.state !== 'success') fail(409, `Required CI check is not successful: ${name}`);
        }
      } catch (error) { if (error.status) throw error; fail(409, 'Could not verify required CI checks. No job was queued.'); }
    }
    return { project: project.name, ref: input.ref, commit: resolved, repository: origin, profile: input.profile, requiredChecks: token.requiredChecks ?? [] };
  };
  return async (req, res, url) => {
    let token; let audit;
    try {
      if (req.headers.origin) fail(403, 'Remote API does not accept browser-origin requests.');
      token = authenticate(req.headers.authorization);
      if (!token) fail(401, 'Remote access is disabled, expired, revoked, or the token is invalid.');
      const route = url.pathname.slice('/api/remote/v1'.length).split('/').filter(Boolean);
      const method = req.method;
      if (method === 'GET' && route.length === 1 && route[0] === 'info') return json(res, 200, { version: 1, client: token.name, projects: token.projects, profiles: token.profiles, scopes: token.scopes, requiredChecks: token.requiredChecks });
      if (method === 'GET' && route.length === 1 && route[0] === 'projects') {
        allowed(token, 'read');
        return json(res, 200, projects().filter((project) => token.projects.includes(project.name)).map((project) => ({ name: project.name, profiles: profiles(project.dir).filter((profile) => token.profiles.includes(profile.name)) })));
      }
      if (method === 'GET' && route.length === 3 && route[0] === 'projects' && route[2] === 'commits') {
        const project = projectOf(token, route[1]);
        const ref = url.searchParams.get('ref') || 'main';
        if (!/^[\w./-]{1,200}$/.test(ref) || ref.startsWith('-') || ref.includes('..')) fail(400, 'Invalid branch.');
        try { await run('git', ['-C', project.dir, 'fetch', '-q', '--prune', 'origin'], { timeout: 30000 }); }
        catch { fail(409, 'Could not fetch commit history from origin.'); }
        const text = await git(project.dir, 'log', '-20', '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct', `origin/${ref}`);
        return json(res, 200, text.split('\n').filter(Boolean).map((line) => {
          const [hash, short, subject, author, time] = line.split('\x1f');
          return { hash, short, subject, author, date: Number(time) * 1000 };
        }));
      }
      if (method === 'GET' && route.length === 1 && route[0] === 'jobs') {
        allowed(token, 'read');
        return json(res, 200, jobs().filter((job) => token.projects.includes(job.project)).slice(0, 200).map(cleanJob));
      }
      if (route[0] === 'jobs' && route[1] && validId(route[1])) {
        const job = read(route[1]);
        projectOf(token, job.project);
        if (method === 'GET' && route.length === 2) return json(res, 200, cleanJob(job));
        if (method === 'GET' && route.length === 3 && route[2] === 'log') {
          const tail = Math.max(1, Math.min(2000, Number(url.searchParams.get('tail')) || 80));
          const file = logPath(job.id);
          return json(res, 200, { id: job.id, text: logTail(file, tail) });
        }
        if (method === 'GET' && route.length === 3 && route[2] === 'artifact') return download(res, job);
      }
      if (route[0] === 'dev' && dev && method === 'GET') {
        if (route.length === 1) { allowed(token, 'read'); return json(res, 200, { servers: dev.list().filter((item) => token.projects.includes(item.project)) }); }
        projectOf(token, route[1]);
        if (route.length === 2) return json(res, 200, devView(dev.view(route[1])));
        if (route.length === 3 && route[2] === 'log') {
          const number = (key) => (url.searchParams.has(key) && Number.isFinite(Number(url.searchParams.get(key))) ? Math.trunc(Number(url.searchParams.get(key))) : undefined);
          return json(res, 200, await dev.log(route[1], { since: number('since'), tail: number('tail') ?? 200, wait: Math.min(60, Math.max(0, number('wait') ?? 0)) * 1000 }));
        }
      }
      if (method !== 'POST') fail(404, 'Unknown remote API operation.');
      let text = '';
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 16384) fail(413, 'Request too large.'); }
      let input;
      try { input = JSON.parse(text || '{}'); } catch { fail(400, 'Invalid JSON.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Expected an object.');
      if (route[0] === 'dev' && dev && route.length === 3) {
        projectOf(token, route[1], 'dev');
        const by = { name: `remote: ${token.name}`, login: `token:${token.id}` };
        const options = { connection: input.connection, clear: input.clear === true, ...(Number.isInteger(input.port) ? { port: input.port } : {}) };
        audit = { tokenId: token.id, client: token.name, operation: route.join('/'), project: route[1], ...(route[2] === 'input' ? { key: typeof input.key === 'string' ? input.key.slice(0, 20) : undefined, text: typeof input.text === 'string' ? input.text.length : undefined } : {}) };
        try {
          if (route[2] === 'start') return json(res, 201, devSession(await dev.start(route[1], options, by)));
          if (route[2] === 'restart') return json(res, 201, devSession(await dev.restart(route[1], options, by)));
          if (route[2] === 'stop') return json(res, 200, devSession(dev.stop(route[1])));
          if (route[2] === 'input') {
            const result = Number.isInteger(input.choose) ? dev.choose(route[1], input.choose) : dev.input(route[1], { key: input.key, text: input.text, enter: input.enter !== false });
            return json(res, 200, { ...result, session: devSession(result.session) });
          }
        } catch (error) { if (error.status) fail(error.status, error.message); throw error; }
        fail(404, 'Unknown remote API operation.');
      }
      if (route.length === 1 && route[0] === 'preflight') return json(res, 200, await source(token, input, input.action === 'update' ? 'update' : 'build'));
      const operation = async () => {
        token = authenticate(req.headers.authorization);
        if (!token) fail(401, 'Token expired or was revoked while waiting.');
        const requestId = req.headers['idempotency-key'];
        if (typeof requestId !== 'string' || !/^[\w-]{8,100}$/.test(requestId)) fail(400, 'Mutations require an Idempotency-Key.');
        const fingerprint = JSON.stringify({ route, input });
        const previous = jobs().find((job) => job.remote?.tokenId === token.id && job.remote?.requestId === requestId);
        if (previous) {
          if (previous.remote.fingerprint !== fingerprint) fail(409, 'Idempotency key was used for different arguments.');
          return json(res, 200, cleanJob(previous));
        }
        let result;
        const by = { name: `remote: ${token.name}`, login: `token:${token.id}` };
        if (route.length === 1 && route[0] === 'jobs') {
          if (!['build', 'update'].includes(input.action)) fail(400, 'Action must be build or update.');
          const scope = input.action === 'update' ? 'update' : 'build';
          const chosen = await source(token, input, scope);
          if (input.submit) allowed(token, 'submit', chosen.project);
          if ((input.submit || input.action === 'update') && input.confirmRelease !== true) fail(400, 'Publishing requires confirmRelease: true.');
          if (input.action === 'update') result = await enqueueUpdate(chosen.project, { profile: chosen.profile, ref: chosen.commit, platform: input.platform ?? 'all', channel: input.channel, environment: input.environment, message: input.message }, by, { tokenId: token.id, requestId, fingerprint });
          else result = await enqueue({ project: chosen.project, profile: chosen.profile, ref: chosen.commit, label: chosen.ref, platform: input.platform ?? 'ios', submit: input.submit === true, install: false, skipUnchanged: false, trigger: 'remote', by, remote: { tokenId: token.id, requestId, fingerprint } });
        } else if (route.length === 3 && route[0] === 'jobs' && route[2] === 'cancel' && validId(route[1])) {
          const job = read(route[1]);
          projectOf(token, job.project, 'cancel');
          cancel(job.id);
          result = read(job.id);
        } else if (route.length === 3 && route[0] === 'jobs' && route[2] === 'submit' && validId(route[1])) {
          const job = read(route[1]);
          projectOf(token, job.project, 'submit');
          if (!token.profiles.includes(job.profile)) fail(403, 'Profile is not allowed.');
          if (input.confirmRelease !== true) fail(400, 'Publishing requires confirmRelease: true.');
          if (job.source !== 'github' || !job.commit?.hash) fail(409, 'Remote submission requires an artifact built from a pushed commit.');
          await source(token, { project: job.project, profile: job.profile, ref: job.commit.hash, commit: job.commit.hash, repository: input.repository }, 'submit');
          result = submit(job, by, { tokenId: token.id, requestId, fingerprint });
        } else fail(404, 'Unknown remote API operation.');
        if (result.error) fail(409, result.error);
        audit = { tokenId: token.id, client: token.name, requestId, operation: route.join('/'), jobId: result.id, project: result.project, commit: result.commit?.hash };
        return json(res, 201, cleanJob(result));
      };
      const pending = mutations.then(operation);
      mutations = pending.catch(() => {});
      return await pending;
    } catch (error) {
      if (!error.status) console.error('remote API', error.message);
      return json(res, error.status ?? 500, { error: error.status ? error.message : 'Remote server error.' });
    } finally {
      if (token && req.method === 'POST') {
        try {
          const file = `${accessFile()}.audit.jsonl`;
          mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
          appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), tokenId: token.id, method: req.method, path: url.pathname.slice(0, 250), status: res.statusCode, ...audit })}\n`, { mode: 0o600 });
        } catch (error) { console.error('remote audit', error.message); }
      }
    }
  };
}
