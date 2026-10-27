// Dev portal step 3: setup versions. Pure functions the demo store uses: diff a draft against the live snapshot, label risk, run rollout post-checks.
// Risk rule (Halo default, Christian can overrule): copy is low, schedule and routing are medium, consent and sending windows are high.
import type { ClientSetup, Risk, SetupChange, SetupSnapshot } from '../types';

type Area = SetupChange['area'];
const RISK: Record<string, Risk> = {
  'profile.services': 'low', 'profile.ownerContacts': 'low', 'profile.hours': 'medium', 'profile.timezone': 'medium', 'profile.consentBasis': 'high',
  'handoff.booking': 'medium', 'handoff.payment': 'medium', 'handoff.resolution': 'medium', 'handoff.unknown': 'medium', 'handoff.closers': 'medium', 'handoff.quietHours': 'high',
  'customizations.tone': 'low', 'customizations.replyNotes': 'low', 'customizations.followUpDays': 'medium',
};
const LABEL: Record<string, string> = {
  'profile.services': 'Services', 'profile.ownerContacts': 'Owner contacts', 'profile.hours': 'Business hours', 'profile.timezone': 'Time zone', 'profile.consentBasis': 'Consent basis',
  'handoff.booking': 'Booking route', 'handoff.payment': 'Payment route', 'handoff.resolution': 'Resolution route', 'handoff.unknown': 'Unknown route', 'handoff.closers': 'Closers', 'handoff.quietHours': 'Quiet hours',
  'customizations.tone': 'Tone', 'customizations.replyNotes': 'Reply notes', 'customizations.followUpDays': 'Follow-up days',
};
const AREAS: Area[] = ['profile', 'handoff', 'customizations'];

export const snapshotOf = (s: ClientSetup): SetupSnapshot => structuredClone({ profile: s.profile, handoff: s.handoff, customizations: s.customizations });
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '')) || '(empty)';

/** Plain-language differences between what is live and the draft. An empty `live` means a first version: every filled field counts. */
export function diffSetup(live: SetupSnapshot | null, draft: SetupSnapshot): SetupChange[] {
  const out: SetupChange[] = [];
  for (const area of AREAS) {
    const next = draft[area] as unknown as Record<string, unknown>;
    const cur = (live?.[area] ?? {}) as Record<string, unknown>;
    for (const field of Object.keys(next)) {
      if (JSON.stringify(cur[field] ?? (typeof next[field] === 'string' ? '' : undefined)) === JSON.stringify(next[field])) continue;
      const key = `${area}.${field}`;
      out.push({ area, field, label: LABEL[key] ?? field, before: show(cur[field]), after: show(next[field]), risk: RISK[key] ?? 'high' });
    }
  }
  return out;
}

const ORDER: Risk[] = ['low', 'medium', 'high'];
export const topRisk = (changes: SetupChange[]): Risk => changes.reduce<Risk>((r, c) => (ORDER.indexOf(c.risk) > ORDER.indexOf(r) ? c.risk : r), 'low');

/** The automatic checks after a rollout. Simulated here from the snapshot; the real ones run against the live system. */
export function postChecks(snap: SetupSnapshot, setup: ClientSetup): { label: string; ok: boolean; why: string | null }[] {
  const hasEmail = /@/.test(snap.profile.ownerContacts);
  const hasHours = Boolean(snap.profile.hours.trim());
  const mailbox = setup.connections.find((c) => c.channel === 'mailbox');
  return [
    { label: 'A test lead gets a reply inside the window', ok: hasHours, why: hasHours ? null : 'Business hours are empty, so the window cannot be checked' },
    { label: 'Alerts reach an owner', ok: hasEmail, why: hasEmail ? null : 'No owner email address is set' },
    { label: 'The mailbox can send (connected or simulated)', ok: mailbox?.state !== 'needs_approval', why: mailbox?.state === 'needs_approval' ? 'The client has not approved mailbox access yet' : null },
  ];
}
