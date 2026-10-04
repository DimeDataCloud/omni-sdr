// Assemble the waitlist site (omnisdr.com) for Cloudflare Pages after `next build`.
// Pages serves static files from dist/ (wrangler.toml pages_build_output_dir) and
// runs functions/ at the repo root for /api/waitlist. Only prerendered pages are
// copied; dynamic routes (src/app/api/**, /audit/[slug]) are not served on Pages.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = join(root, '.next', 'server', 'app');
const out = join(root, 'dist');

if (!existsSync(join(app, 'index.html'))) {
  console.error('build-pages: .next/server/app/index.html missing; run next build first');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(root, 'public'), out, { recursive: true });
cpSync(join(root, '.next', 'static'), join(out, '_next', 'static'), { recursive: true });

for (const name of readdirSync(app)) {
  if (name === '_global-error.html') continue;
  if (name === '_not-found.html') {
    cpSync(join(app, name), join(out, '404.html'));
  } else if (name === 'index.html') {
    cpSync(join(app, name), join(out, 'index.html'));
  } else if (name.endsWith('.html')) {
    // privacy.html -> privacy/index.html so /privacy resolves without a redirect
    const dir = join(out, name.slice(0, -'.html'.length));
    mkdirSync(dir, { recursive: true });
    cpSync(join(app, name), join(dir, 'index.html'));
  } else if (name === 'icon.png.body') {
    cpSync(join(app, name), join(out, 'icon.png'));
  }
}

console.log('build-pages: dist/ ready');
