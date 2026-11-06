// Adding macbuild's hook (lib/metro.cjs) to an app's metro.config.js, with the user's say-so: from the dev server page,
// `macbuild dev hook NAME`, or a fix ticked in setup. The line requires @fav-devs/macbuild/metro, which resolves on this
// Mac through ~/.node_modules (one of Node's global folders, linked here and by install.sh), so the app gets no new
// dependency. Anywhere else the require fails, the catch ignores it, and Metro carries on as before.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const HOOK_MARK = '@fav-devs/macbuild/metro';
export const HOOK_LINE = "try { require('@fav-devs/macbuild/metro').attach(); } catch {}";
const ESM_LINE = "try { (await import('node:module')).createRequire(import.meta.url)('@fav-devs/macbuild/metro').attach(); } catch {}";
export const HOOK_BLOCK = `
// macbuild: shows this dev server, its whole terminal, on the macbuild dashboard when it runs on a Mac with macbuild.
// Anywhere else (teammates, CI, EAS builds) the require fails quietly and nothing changes.
${HOOK_LINE}
`;
const EXPO_DEFAULT = `// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
`;
const NAMES = ['metro.config.js', 'metro.config.cjs', 'metro.config.mjs', 'metro.config.ts'];

// The app's Metro config, and whether the hook is in it.
export function metroHook(dir) {
  const file = NAMES.map((name) => join(dir, name)).find((path) => existsSync(path)) ?? null;
  let text = '';
  try { text = file ? readFileSync(file, 'utf8') : ''; } catch {}
  return { file, name: file ? basename(file) : 'metro.config.js', present: text.includes(HOOK_MARK), line: file?.endsWith('.mjs') ? ESM_LINE : HOOK_LINE };
}

// ~/.node_modules/@fav-devs/macbuild -> this checkout. Only ever replaces a link, never a real folder.
export function linkForNode({ root = ROOT, home = homedir() } = {}) {
  const link = join(home, '.node_modules', '@fav-devs', 'macbuild');
  mkdirSync(dirname(link), { recursive: true });
  let current = null;
  try {
    if (!lstatSync(link).isSymbolicLink()) return { link, ok: false, reason: `${link} is a folder, not macbuild's link` };
    current = readlinkSync(link);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current !== root) {
    if (current !== null) unlinkSync(link);
    symlinkSync(root, link);
  }
  return { link, ok: true };
}

// Adds the hook: appended to a CommonJS or ESM metro.config, or a new metro.config.js with Expo's defaults.
export function addMetroHook(dir, { root = ROOT, home = homedir(), expo = true } = {}) {
  const linked = linkForNode({ root, home });
  if (!linked.ok) throw Object.assign(new Error(linked.reason), { status: 409 });
  const hook = metroHook(dir);
  if (hook.present) return { changed: false, file: hook.file, created: false, line: hook.line };
  if (hook.file?.endsWith('.ts')) throw Object.assign(new Error(`macbuild doesn't edit ${hook.name}. Add this line at the end of it: ${HOOK_LINE}`), { status: 409, line: HOOK_LINE });
  if (!hook.file) {
    if (!expo) throw Object.assign(new Error('There’s no metro.config.js to add it to.'), { status: 409 });
    const file = join(dir, 'metro.config.js');
    writeFileSync(file, `${EXPO_DEFAULT}${HOOK_BLOCK}`);
    return { changed: true, file, created: true, line: HOOK_LINE };
  }
  const text = readFileSync(hook.file, 'utf8');
  const block = hook.file.endsWith('.mjs') ? HOOK_BLOCK.replace(HOOK_LINE, ESM_LINE) : HOOK_BLOCK;
  appendFileSync(hook.file, `${text.endsWith('\n') ? '' : '\n'}${block}`);
  return { changed: true, file: hook.file, created: false, line: hook.line };
}
