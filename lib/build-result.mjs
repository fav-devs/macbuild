import { existsSync, statSync } from 'node:fs';

const plainText = (text) => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

export function failureLine(text) {
  const lines = plainText(text).split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  return lines.filter((line) => /❌|error:|failed|FAILURE|non-zero code|syntax error near unexpected token/i.test(line)
    && !/build command failed/.test(line) && !/^>\s*\d+\s*\|/.test(line)).at(-1) ?? '';
}

export function jobSucceeded(build, text) {
  const plain = plainText(text);
  if (build.action === 'update') return /^macbuild: update successful\s*$/m.test(plain);
  if (build.submissionOnly || ['submit', 'testflight'].includes(build.action)) {
    return /^macbuild: submission successful\s*$/m.test(plain);
  }
  return /^Build successful\s*$/m.test(plain) || /^macbuild: unchanged since /m.test(plain);
}

export function recoverArtifact(build, text, artifact) {
  if (build.action === 'update' || build.submissionOnly || build.expired || !existsSync(artifact) || !/^Build successful\s*$/m.test(plainText(text))) return build;
  const size = statSync(artifact).size;
  if (!size) return build;
  build.buildCompleted = true;
  build.ipaBytes = size;
  build.submission ||= plainText(text).match(/https:\/\/expo\.dev\S+\/submissions\/[0-9a-f-]+/)?.[0];
  if (build.status === 'failed') build.reason = failureLine(text) || build.reason;
  return build;
}
