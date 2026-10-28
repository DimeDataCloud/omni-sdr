// Dev portal: setup versions. Pure functions the demo store uses: diff a config against the applied one, classify risk, run demo checks.
// 6a computes the diff and risk on the server from a path table; Backend will send that table as data. This local copy is demo only.
import type { DemoConnection, Risk, SetupChange, SetupConfig } from '../types';

export const EMPTY_CONFIG: SetupConfig = {
  hours: '', timezone: 'America/Chicago', quietHours: '', services: '', ownerContacts: '', consentBasis: '',
  closers: '', booking: '', payment: '', resolution: '', unknown: 'Ask a human', followUpDays: [2, 5, 9], tone: 'warm', replyNotes: '',
};

type Path = keyof SetupConfig & string;
// path -> [area, label, risk]. Risk rule (Halo default, Christian can overrule): copy low, schedule and routing medium, connection and send settings high.
const TABLE: Record<Path, [string, string, Risk]> = {
  hours: ['hours', 'Business hours', 'medium'], timezone: ['hours', 'Time zone', 'medium'], quietHours: ['hours', 'Quiet hours', 'high'],
  services: ['playbook', 'Services', 'low'], tone: ['playbook', 'Tone', 'low'], replyNotes: ['playbook', 'Reply notes', 'low'], followUpDays: ['playbook', 'Follow-up days', 'medium'],
  ownerContacts: ['alerts', 'Owner contacts', 'low'], consentBasis: ['connections', 'Consent basis', 'high'],
  closers: ['handoff', 'Closers', 'medium'], resolution: ['handoff', 'Resolution route', 'medium'], unknown: ['handoff', 'Unknown route', 'medium'],
  booking: ['booking', 'Booking route', 'medium'], payment: ['booking', 'Payment route', 'medium'],
};
export const PATHS = Object.keys(TABLE) as Path[];
export const labelOf = (p: string) => TABLE[p as Path]?.[1] ?? p;

const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')) || '(empty)';

/** Differences between the applied config and a new one. A null base means a first version: every filled field counts. */
export function diffConfig(base: SetupConfig | null, next: SetupConfig): SetupChange[] {
  const from = base ?? EMPTY_CONFIG;
  const out: SetupChange[] = [];
  for (const path of PATHS) {
    if (JSON.stringify(from[path]) === JSON.stringify(next[path])) continue;
    const [area, , risk] = TABLE[path];
    out.push({ area, path, before: show(from[path]), after: show(next[path]), risk });
  }
  return out;
}

const ORDER: Risk[] = ['low', 'medium', 'high'];
export const topRisk = (diff: SetupChange[]): Risk => diff.reduce<Risk>((r, c) => (ORDER.indexOf(c.risk) > ORDER.indexOf(r) ? c.risk : r), 'low');

/** DEMO checks after apply. 6a returns an empty list (real post-checks arrive with 6c); these are simulated from the config and labelled as demo on screen. */
export function demoChecks(config: SetupConfig, connections: DemoConnection[]): { label: string; ok: boolean; why: string | null }[] {
  const hasEmail = /@/.test(config.ownerContacts);
  const hasHours = Boolean(config.hours.trim());
  const mailbox = connections.find((c) => c.channel === 'mailbox');
  return [
    { label: 'A test lead gets a reply inside the window', ok: hasHours, why: hasHours ? null : 'Business hours are empty, so the window cannot be checked' },
    { label: 'Alerts reach an owner', ok: hasEmail, why: hasEmail ? null : 'No owner email address is set' },
    { label: 'The mailbox can send (connected or simulated)', ok: mailbox?.state !== 'needs_approval', why: mailbox?.state === 'needs_approval' ? 'The client has not approved mailbox access yet' : null },
  ];
}
