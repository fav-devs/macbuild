import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const SCOPES = ['read', 'build', 'update', 'submit', 'cancel', 'dev'];
export const accessFile = () => process.env.MACBUILD_REMOTE_ACCESS ?? join(homedir(), '.config/macbuild/remote-server.json');
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function privateJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
  chmodSync(file, 0o600);
}
export function loadAccess(file = accessFile()) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, tokens: [] };
}
export function issueToken({ name, projects, scopes = ['read', 'build'], profiles = ['development'], requiredChecks = [], expiresDays = 90, device = false, allProjects = false }, file = accessFile()) {
  const validList = (list) => Array.isArray(list) && list.length > 0 && list.every((item) => typeof item === 'string' && /^[\w.-]{1,100}$/.test(item));
  if (!name || typeof name !== 'string' || name.length > 80) throw new Error('Token needs a name (up to 80 characters).');
  if ((!allProjects && !validList(projects)) || (allProjects && !device) || !validList(profiles)) throw new Error('Explicit project and profile allowlists are required; wildcards are not allowed.');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !SCOPES.includes(scope))) throw new Error(`Scopes: ${SCOPES.join(', ')}`);
  if (!Array.isArray(requiredChecks) || requiredChecks.some((check) => typeof check !== 'string' || !check || check.length > 150)) throw new Error('Invalid required CI checks.');
  if (!(device && expiresDays === 0) && (!Number.isFinite(expiresDays) || expiresDays < 1 || expiresDays > 365)) throw new Error('Token lifetime must be 1–365 days.');
  const config = loadAccess(file);
  const id = randomBytes(10).toString('hex');
  const secret = `mb_${id}_${randomBytes(32).toString('hex')}`;
  const token = { id, name, projects: allProjects ? [] : projects, ...(device ? { device: true, allProjects } : {}), scopes, profiles, requiredChecks, createdAt: Date.now(), expiresAt: device && expiresDays === 0 ? null : Date.now() + expiresDays * 86400000, hash: digest(secret) };
  config.tokens.push(token);
  privateJson(file, config);
  return { token: secret, ...publicToken(token) };
}
export function publicToken({ hash, ...token }) { return token; }
export function revokeToken(id, file = accessFile()) {
  const config = loadAccess(file);
  const token = config.tokens.find((item) => item.id === id);
  if (!token) throw new Error('Unknown token id.');
  token.revokedAt = Date.now();
  privateJson(file, config);
  return publicToken(token);
}
export function authenticate(header, file = accessFile()) {
  const match = /^Bearer (mb_([a-f0-9]{20})_[a-f0-9]{64})$/.exec(header ?? '');
  if (!match) return null;
  const token = loadAccess(file).tokens.find((item) => item.id === match[2]);
  if (!token || token.revokedAt || !(token.expiresAt > Date.now() || (token.device === true && token.expiresAt === null)) || !/^[a-f0-9]{64}$/.test(token.hash ?? '')) return null;
  return timingSafeEqual(Buffer.from(token.hash, 'hex'), Buffer.from(digest(match[1]), 'hex')) ? publicToken(token) : null;
}
export function repositoryId(remote) {
  const text = String(remote ?? '').trim();
  const ssh = /^[\w.-]+@([^:]+):(.+)$/.exec(text);
  let host; let path;
  if (ssh) [, host, path] = ssh;
  else {
    try { const url = new URL(text); host = url.hostname; path = url.pathname.replace(/^\//, ''); }
    catch { throw new Error('Origin must be an HTTPS or SSH repository URL.'); }
    if (!/^(https:|ssh:)$/.test(new URL(text).protocol)) throw new Error('Origin must use HTTPS or SSH.');
  }
  if (!host || !path || path.includes('..') || /[\s?#]/.test(path)) throw new Error('Invalid repository origin.');
  return `${host.toLowerCase()}/${path.replace(/\/$/, '').replace(/\.git$/, '')}`;
}

// A trusted device may use projects registered on this Mac, including future registrations.
export const permitsProject = (token, project) => (token.device === true && token.allProjects === true) || token.projects.includes(project);

// Last activity is approximate, with at most one persisted write per minute per credential.
export function recordTokenUse(id, file = accessFile()) {
  const config = loadAccess(file);
  const token = config.tokens.find((item) => item.id === id);
  if (!token || token.revokedAt || Date.now() - (token.lastSeenAt ?? 0) < 60000) return;
  token.lastSeenAt = Date.now();
  privateJson(file, config);
}
export function connectedDevices(file = accessFile()) {
  return loadAccess(file).tokens.map((token) => ({
    id: token.id, name: token.name, device: token.device === true,
    projects: token.projects, allProjects: token.device === true && token.allProjects === true,
    profiles: token.profiles, scopes: token.scopes,
    createdAt: token.createdAt, expiresAt: token.expiresAt,
    lastSeenAt: token.lastSeenAt ?? null, revokedAt: token.revokedAt ?? null,
    status: token.revokedAt ? 'revoked' : token.expiresAt !== null && token.expiresAt <= Date.now() ? 'expired' : 'authorized',
  })).sort((a, b) => (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt));
}
