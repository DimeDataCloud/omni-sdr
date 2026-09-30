// Time and vocabulary (DESIGN §5.4 time rules, §7.3–7.7 labels). Every label the UI shows comes from here.
import type { DraftStatus, Intent, Role, ModelTier, EmailStatus, AutoAdjustSource } from './api/types';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function relTime(iso: string | null | undefined, tz: string, now = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  const diff = now - t;
  const abs = Math.abs(diff);
  const future = diff < 0;
  if (abs < 60e3) return future ? 'in a moment' : 'just now';
  if (abs < 3600e3) { const m = Math.round(abs / 60e3); return future ? `in ${m} min` : `${m} min ago`; }
  if (abs < 86400e3) { const h = Math.round(abs / 3600e3); return future ? `in ${h}h` : `${h}h ago`; }
  if (abs < 7 * 86400e3) return new Date(t).toLocaleString('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return new Date(t).toLocaleDateString('en-US', { timeZone: tz, day: 'numeric', month: 'short' });
}
export const absTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export const clock = (iso: string, tz: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
export const dayLabel = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' });
export const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function fmtDur(min: number) {
  const t = Math.round(min); const h = Math.floor(t / 60); const m = t % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
export const slaText = (min: number) => (min <= 0 ? `Overdue ${fmtDur(-min)}` : `${fmtDur(min)} left`);
export const slaTone = (min: number): Tone => (min <= 0 ? 'danger' : min < 60 ? 'warning' : 'neutral');

export function draftStatus(status: DraftStatus, dispatched = false): { label: string; tone: Tone } {
  if (status === 'approved') return dispatched ? { label: 'Sent', tone: 'neutral' } : { label: 'Approved · sends next window', tone: 'success' };
  const map: Record<Exclude<DraftStatus, 'approved'>, { label: string; tone: Tone }> = {
    generating: { label: 'Writing…', tone: 'neutral' }, gating: { label: 'Checking claims…', tone: 'neutral' }, blocked: { label: 'Blocked by gate', tone: 'danger' },
    review: { label: 'In review', tone: 'info' }, discarded: { label: 'Rejected', tone: 'neutral' }, superseded: { label: 'Replaced', tone: 'neutral' },
  };
  return map[status];
}

export function findingText(code: string, detail: string): string {
  switch (code) {
    case 'unsupported_sentence': return 'This sentence makes a claim with nothing behind it.';
    case 'unsupported_number': return 'This number has no evidence behind it.';
    case 'number_mismatch': return "A number doesn't match the evidence.";
    case 'no_evidence': return 'A first message must cite at least one verified fact about the prospect.';
    case 'evidence_expired': return 'The evidence is out of date. Refresh it or remove the claim.';
    case 'evidence_not_found': case 'evidence_wrong_contact': return "The cited evidence isn't about this prospect.";
    case 'fact_missing': case 'claim_malformed': return "A claim points at evidence that doesn't say it.";
    case 'claim_not_in_body': return 'A cited claim is no longer in the text.';
    case 'revenue_formula_required': return 'Dollar-loss figures need a verified calculation. Remove the figure.';
    case 'implied_prior_contact': return `Implies you've talked before ("${detail}"). This is a first message.`;
    case 'banned_filler': return `Filler phrase: "${detail}".`;
    case 'competitor_named': return `Names a competitor (${detail}).`;
    default: return detail || code.replace(/_/g, ' ');
  }
}
/** The sentence a finding is about, when the detail carries it (so the body can highlight it). */
export function findingSentence(code: string, detail: string): string | null {
  if (code === 'unsupported_sentence' || code === 'revenue_formula_required') return detail;
  if (code === 'unsupported_number') return detail.replace(/^[^:]*in: /, '');
  return null;
}

export const INTENT: Record<Intent, { label: string; tone: Tone }> = {
  meeting_request: { label: 'Meeting request', tone: 'accent' }, positive_inquiry: { label: 'Interested', tone: 'success' },
  question: { label: 'Question', tone: 'info' }, referral: { label: 'Referral', tone: 'info' }, objection: { label: 'Objection', tone: 'warning' },
  out_of_office: { label: 'Out of office', tone: 'neutral' }, not_interested: { label: 'Not interested', tone: 'neutral' },
  wrong_person: { label: 'Wrong person', tone: 'neutral' }, unsubscribe: { label: 'Unsubscribed', tone: 'danger' }, bounce: { label: 'Bounced', tone: 'danger' },
  unclassified: { label: 'Needs a look', tone: 'neutral' },
};

export function enrollmentState(state: string, stopReason: string | null): string {
  if (state === 'stopped') {
    if (stopReason?.startsWith('reply:')) return `Stopped · replied (${INTENT[stopReason.slice(6) as Intent]?.label.toLowerCase() ?? stopReason.slice(6)})`;
    if (stopReason === 'unsubscribe') return 'Stopped · unsubscribed';
    return `Stopped${stopReason ? ` · ${stopReason.replace(/_/g, ' ')}` : ''}`;
  }
  const map: Record<string, string> = { waiting: 'Queued', drafting: 'Drafting', awaiting_approval: 'Waiting for approval', scheduled: 'Scheduled', sent: 'Sent',
    paused: 'Paused', snoozed: 'Snoozed', converted: 'Meeting booked', completed: 'Finished' };
  return map[state] ?? state;
}

export const EMAIL_STATUS: Record<EmailStatus, { label: string; tone: Tone }> = {
  valid: { label: 'Verified', tone: 'success' }, unknown: { label: 'Unverified', tone: 'neutral' }, risky: { label: 'Risky', tone: 'warning' }, invalid: { label: 'Invalid', tone: 'danger' },
};
export const TIER: Record<ModelTier, { label: string; hint: string; credits: number }> = {
  flash_lite: { label: 'Flash-Lite', hint: 'fastest, cheapest', credits: 1 },
  flash: { label: 'Flash', hint: 'default', credits: 1 },
  pro: { label: 'Pro', hint: 'best for plans and research', credits: 4 },
};
export const ROLE: Record<Role, { label: string; hint: string }> = {
  admin: { label: 'Admin', hint: 'billing, members, settings' }, operator: { label: 'Operator', hint: 'campaigns, leads, approvals' },
  reviewer: { label: 'Reviewer', hint: 'approves drafts, reads the inbox' }, client_viewer: { label: 'Client', hint: 'sees results' },
};
export const AUTO_ADJUST: Record<AutoAdjustSource, string> = {
  booked_meetings: 'Booked meetings', positive_replies: 'Positive replies', objections: 'Objections', unsubscribes_bounces: 'Unsubscribes and bounces',
  sops: 'Your SOPs', won_lost: 'Won/lost notes', draft_edits: 'Your draft edits', rejections: 'Rejection reasons',
};
export const initials = (s: string | null | undefined) => (s ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');
export const domainOf = (uri: string) => { try { return new URL(uri).hostname.replace(/^www\./, ''); } catch { return uri; } };
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const factSummary = (facts: Record<string, unknown>) =>
  Object.entries(facts).map(([k, v]) => `${k}: ${typeof v === 'object' && v && 'summary' in v ? String((v as { summary: unknown }).summary) : JSON.stringify(v)}`);
