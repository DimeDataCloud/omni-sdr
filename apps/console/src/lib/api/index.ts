// Which backend the screens talk to. A build with VITE_OMNI_API_URL talks to the real API (G5) unless the visitor
// opened the demo (`?demo=1`, kept for the tab). A build without it (local design work, the gates) is the demo.
// Screens only see the Client contract, so neither adapter needs UI changes.
import { demoClient } from './demo/client';
import { httpClient, API_URL } from './http';
import type { Client } from './client';

function demoChosen() {
  try {
    const p = new URLSearchParams(window.location.search).get('demo');
    if (p === '1') sessionStorage.setItem('omni.demo', '1');
    if (p === '0') sessionStorage.removeItem('omni.demo');
    return sessionStorage.getItem('omni.demo') === '1';
  } catch { return false; }
}

export const api: Client = API_URL && !demoChosen() ? httpClient : demoClient;
export const isDemo = api.mode === 'demo';
export * from './client';
