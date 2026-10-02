// The API image copies packages by hand (packages/api/Dockerfile). Every file outside packages/api that the API's own
// source reaches, by import or by a URL read at load time, must be inside a COPY, or the server dies at startup in
// prod while every test here passes (the tests run from the repo, where everything exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(API, '../..');
const posix = (p) => p.split('\\').join('/');

function files(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.m?js$/.test(n) ? [p] : [];
  });
}

/** Repo-relative paths a module reaches: static imports, dynamic imports, and new URL('…', import.meta.url). */
function reached(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm), ...src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
    ...src.matchAll(/new URL\(\s*[`'"](\.{1,2}\/[^`'"$]+)/g)].map((m) => m[1]);
  for (const s of specs) {
    const target = resolve(dirname(file), s);
    if (/\.m?js$/.test(target)) { try { statSync(target); reached(target, seen); } catch { seen.add(target); } } else seen.add(target);
  }
  return seen;
}

function copied() {
  return readFileSync(join(API, 'Dockerfile'), 'utf8').split('\n')
    .map((l) => /^COPY\s+(?!--from)(\S+)\s/.exec(l)?.[1]).filter(Boolean).map((s) => posix(s).replace(/\/$/, ''));
}

/** Paths the build context lets through: Dockerfile.dockerignore is an allow-list (`**`, then `!path/**` lines). */
function allowed() {
  return readFileSync(join(API, 'Dockerfile.dockerignore'), 'utf8').split('\n').map((l) => l.trim())
    .filter((l) => l.startsWith('!')).map((l) => l.slice(1).replace(/\/\*\*$/, ''));
}

test('image: everything the API reaches outside packages/api is copied into the image', () => {
  const entries = files(join(API, 'src'));
  const all = new Set();
  for (const f of entries) for (const p of reached(f)) all.add(posix(relative(ROOT, p)));
  const outside = [...all].filter((p) => !p.startsWith('packages/api/'));
  assert.ok(outside.some((p) => p.startsWith('packages/db/')), 'fixture: the walk sees cross-package imports');
  const sources = copied();
  const missing = outside.filter((p) => !sources.some((s) => p === s || p.startsWith(`${s}/`)));
  assert.deepEqual(missing, [], `not in any COPY of packages/api/Dockerfile: ${missing.join(', ')}`);
});

test('image: every COPY source is let through the build context allow-list (else the build fails)', () => {
  const allow = allowed();
  assert.ok(allow.length > 0, 'fixture: the allow-list has entries');
  const blocked = copied().filter((src) => !allow.some((a) => src === a || src.startsWith(`${a}/`)));
  assert.deepEqual(blocked, [], `COPY sources not allowed by packages/api/Dockerfile.dockerignore: ${blocked.join(', ')}`);
});
