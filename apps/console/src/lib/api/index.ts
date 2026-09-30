// Which backend the screens talk to. The deployed suite runs the demo (no production database exists yet);
// Screens only see the Client contract, so the real API can replace this later without UI changes.
import { demoClient } from './demo/client';
import type { Client } from './client';

export const api: Client = demoClient;
export * from './client';
