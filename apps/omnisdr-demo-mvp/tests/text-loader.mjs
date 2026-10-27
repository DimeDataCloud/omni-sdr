// Node loader for tests: import .html/.css/.txt as a default-exported string, as wrangler's Text rule does.
import { readFile } from 'node:fs/promises';
export async function load(url, ctx, next) {
  if (/\.(html|css|txt)$/.test(new URL(url).pathname)) return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(await readFile(new URL(url), 'utf8')) };
  return next(url, ctx);
}
