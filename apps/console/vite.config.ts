import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { appCsp } from './worker/csp';

// The demo imports the real claims gate and reply rules from packages/, so the browser runs the same checks as the API.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@gate': fileURLToPath(new URL('../../packages/gate/src', import.meta.url)),
      '@rules': fileURLToPath(new URL('../../packages/api/src/services', import.meta.url)),
      '@db': fileURLToPath(new URL('../../packages/db/src', import.meta.url)),
    },
  },
  // Own (empty) PostCSS config: without it Vite walks up and loads the repo root's Next.js config.
  css: { postcss: { plugins: [] } },
  server: { fs: { allow: ['..', '../../packages'] }, port: 5173 },
  // No data: URIs for fonts/images: the production CSP allows fonts from 'self' only.
  build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 600, assetsInlineLimit: 0 },
  // The local gates run against the production CSP (minus the https upgrade, which would break http://127.0.0.1).
  preview: { headers: { 'Content-Security-Policy': appCsp().replace('; upgrade-insecure-requests', '') } },
});
