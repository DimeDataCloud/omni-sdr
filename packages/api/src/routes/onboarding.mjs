// The composer's onboarding (SPEC §1 step 2; DECISIONS 2026-09-28 "Landing: composer first, proactive and skippable"
// and "Onboarding minimum: nothing"). One question at a time, in order; every question can be skipped, and a skipped
// one isn't asked again unless the person asks to revisit it. Answers feed what Omni writes (generate.mjs), and
// anything generated while one is missing says what it lacked.
//
//   GET  …/onboarding                 → { next, answered[], skipped[], missing[], done }
//   POST …/onboarding  { key, value } | { key, skip: true } | { key, revisit: true }
import { T, audit } from './index.mjs';
import { v, parse } from '../validate.mjs';
import { badRequest, forbidden } from '../errors.mjs';
import { can } from '../../../db/src/permissions.mjs';

// The order the composer asks in. `action` is the permission the answer needs; `missing` says what generation
// loses without it (shown next to anything generated, with a one-click "add it").
export const QUESTIONS = [
  { key: 'website', ask: 'What’s your website?', kind: 'url', action: 'build', why: 'Omni reads it to learn what you sell and how you talk.',
    missing: 'your website' },
  { key: 'offer', ask: 'In a sentence or two, what do you offer and who is it for?', kind: 'text', action: 'build',
    why: 'Every email is written around this.', missing: 'your offer' },
  { key: 'voice', ask: 'Paste an email you’ve written that sounds like you, or record a voice note.', kind: 'text', action: 'build',
    why: 'Drafts match your tone instead of sounding generic.', missing: 'a sample of your voice' },
  { key: 'postal_address', ask: 'What postal address should your emails carry?', kind: 'text', action: 'workspace_settings',
    why: 'US law (CAN-SPAM) requires a postal address in commercial email; nothing sends without one.', missing: 'your postal address' },
  { key: 'icp', ask: 'Who are your best customers? Describe them, or upload a list of past clients.', kind: 'icp', action: 'build',
    why: 'Leads are scored against it.', missing: 'an ideal customer profile' },
  { key: 'connections', ask: 'Connect the mailbox you send from.', kind: 'connections', action: 'connections',
    why: 'Emails go out from your own account, never ours.', missing: 'a connected mailbox' },
];
const BY_KEY = new Map(QUESTIONS.map((q) => [q.key, q]));

async function state(tx, m) {
  const p = (await tx.query(`SELECT website, offer, voice_sample, skipped FROM workspace_profiles WHERE workspace_id = $1`, [m.workspaceId])).rows[0] ?? {};
  const w = (await tx.query(`SELECT postal_address FROM workspaces WHERE id = $1`, [m.workspaceId])).rows[0] ?? {};
  const icps = Number((await tx.query(`SELECT count(*) AS n FROM icps`)).rows[0].n);
  const mailboxes = Number((await tx.query(`SELECT count(*) AS n FROM mailboxes WHERE paused_reason IS NULL`)).rows[0].n);
  const have = { website: Boolean(p.website), offer: Boolean(p.offer), voice: Boolean(p.voice_sample), postal_address: Boolean(w.postal_address),
    icp: icps > 0, connections: mailboxes > 0 };
  const skipped = (p.skipped ?? []).filter((k) => BY_KEY.has(k) && !have[k]);
  const answered = QUESTIONS.filter((q) => have[q.key]).map((q) => q.key);
  // The next question this person can answer; one they lack the role for is left for someone who has it.
  const next = QUESTIONS.find((q) => !have[q.key] && !skipped.includes(q.key) && can(m, q.action)) ?? null;
  return {
    next: next ? { key: next.key, ask: next.ask, kind: next.kind, why: next.why, skippable: true } : null,
    answered, skipped,
    missing: QUESTIONS.filter((q) => !have[q.key]).map((q) => ({ key: q.key, label: q.missing })),
    done: !next,
    profile: { website: p.website ?? null, offer: p.offer ?? null, voiceSample: p.voice_sample ?? null },
  };
}

const VALUE = {
  website: v.string({ min: 4, max: 300 }),
  offer: v.string({ min: 3, max: 2000 }),
  voice: v.string({ min: 3, max: 4000 }),
  postal_address: v.string({ min: 10, max: 300 }),
};

export function registerOnboarding(r) {
  r.get(`${T}/onboarding`, (ctx) => ctx.tenant((tx, m) => state(tx, m), { action: 'build' }));

  r.post(`${T}/onboarding`, (ctx) => {
    const b = parse(v.object({ key: v.oneOf(QUESTIONS.map((q) => q.key)), value: v.optional(v.string({ min: 1, max: 4000 })),
      skip: v.optional(v.bool()), revisit: v.optional(v.bool()) }), ctx.body);
    const modes = [b.value !== undefined, b.skip === true, b.revisit === true].filter(Boolean).length;
    if (modes !== 1) throw badRequest('send exactly one of value, skip or revisit');
    const q = BY_KEY.get(b.key);
    return ctx.tenant(async (tx, m) => {
      if (!can(m, q.action)) throw forbidden();
      await tx.query(`INSERT INTO workspace_profiles (org_id, workspace_id, updated_by) VALUES ($1, $2, $3) ON CONFLICT (workspace_id) DO NOTHING`,
        [m.orgId, m.workspaceId, m.userId]);
      if (b.skip) {
        await tx.query(`UPDATE workspace_profiles SET skipped = (SELECT array_agg(DISTINCT x) FROM unnest(skipped || ARRAY[$2]) x),
          updated_at = now(), updated_by = $3 WHERE workspace_id = $1`, [m.workspaceId, b.key, m.userId]);
      } else if (b.revisit) {
        await tx.query(`UPDATE workspace_profiles SET skipped = array_remove(skipped, $2), updated_at = now(), updated_by = $3 WHERE workspace_id = $1`,
          [m.workspaceId, b.key, m.userId]);
      } else {
        // ICP and connections are answered on their own screens (ICP builder, Connections); the composer links there.
        if (!VALUE[b.key]) throw badRequest(`${b.key} is answered on its own screen`, { field: 'key' });
        let value = parse(VALUE[b.key], b.value);
        if (b.key === 'website') {
          const u = (() => { try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; } })();
          if (!u || !/^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(u.hostname)) throw badRequest('that doesn’t look like a website', { field: 'value' });
          value = `https://${u.hostname.toLowerCase()}${u.pathname === '/' ? '' : u.pathname}`;
        }
        if (b.key === 'postal_address') {
          await tx.query(`UPDATE workspaces SET postal_address = $2 WHERE id = $1`, [m.workspaceId, value.trim()]);
        } else {
          const col = { website: 'website', offer: 'offer', voice: 'voice_sample' }[b.key];
          await tx.query(`UPDATE workspace_profiles SET ${col} = $2, skipped = array_remove(skipped, $3), updated_at = now(), updated_by = $4
            WHERE workspace_id = $1`, [m.workspaceId, value.trim(), b.key, m.userId]);
        }
        await audit(tx, m, 'onboarding_answer', 'workspace', m.workspaceId);
      }
      return state(tx, m);
    }, { action: 'build' });
  });
}

/** What generation is missing for this workspace: labels the composer shows next to anything it writes. */
export async function missingContext(tx, workspaceId) {
  const p = (await tx.query(`SELECT website, offer, voice_sample FROM workspace_profiles WHERE workspace_id = $1`, [workspaceId])).rows[0] ?? {};
  const out = [];
  if (!p.offer) out.push({ key: 'offer', label: BY_KEY.get('offer').missing });
  if (!p.website) out.push({ key: 'website', label: BY_KEY.get('website').missing });
  if (!p.voice_sample) out.push({ key: 'voice', label: BY_KEY.get('voice').missing });
  return out;
}
