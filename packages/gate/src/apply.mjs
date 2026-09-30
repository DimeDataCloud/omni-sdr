// Gate service step: load a draft and its evidence as gate_svc, run checkDraft, and write the
// verdict. gate_svc is the only role that can write drafts.gate_* (0001 grants), so this module is
// the single path by which a draft becomes approvable.
import { withService } from '../../db/src/context.mjs';
import { checkDraft, GATE_VERSION } from './check.mjs';

/**
 * @returns {{ outcome: 'passed'|'blocked'|'stale'|'skipped', findings: object[] }}
 *   stale   = the text changed between read and write; the edit trigger has already re-queued it
 *   skipped = the draft isn't in 'gating' (already gated, discarded, or not visible in this tenant)
 */
export async function gateDraft(client, { orgId, workspaceId, draftId, competitors = [], now = new Date() }) {
  return withService(client, { orgId, workspaceId, role: 'gate_svc' }, async (tx) => {
    const d = (await tx.query(
      `SELECT d.id, d.subject, d.body, d.step, d.claims, d.status, e.contact_id, draft_sha(d.subject, d.body) AS sha
       FROM drafts d JOIN enrollments e ON e.id = d.enrollment_id
       WHERE d.id = $1`, [draftId])).rows[0];
    if (!d || d.status !== 'gating') return { outcome: 'skipped', findings: [] };

    const ids = Array.isArray(d.claims) ? [...new Set(d.claims.map((c) => c?.evidence_id).filter((x) => typeof x === 'string'))] : [];
    // RLS scopes this to the draft's workspace: another tenant's evidence id simply isn't found.
    const rows = ids.length ? (await tx.query(
      `SELECT id, contact_id, facts, expires_at FROM evidence WHERE id::text = ANY ($1::text[])`, [ids])).rows : [];
    const evidence = new Map(rows.map((r) => [r.id, r]));

    const verdict = checkDraft(d, { contactId: d.contact_id, evidence, now, competitors });
    const upd = await tx.query(
      `UPDATE drafts SET gate_passed = $2, gate_body_sha = CASE WHEN $2 THEN $3 ELSE NULL END, gate_version = $4,
              gated_at = now(), status = CASE WHEN $2 THEN 'review' ELSE 'blocked' END, gate_findings = $5
       WHERE id = $1 AND status = 'gating' AND draft_sha(subject, body) = $3`,
      [draftId, verdict.passed, d.sha, GATE_VERSION, JSON.stringify(verdict.findings)]);
    const affected = upd.affectedRows ?? upd.rowCount ?? 0; // PGlite reports affectedRows, pg reports rowCount
    if (!affected) return { outcome: 'stale', findings: verdict.findings };

    await tx.query(`INSERT INTO outbox (org_id, topic, key, payload) VALUES ($1, 'draft.gated', $2, $3)`,
      [orgId, draftId, JSON.stringify({ draft_id: draftId, passed: verdict.passed, version: GATE_VERSION, findings: verdict.findings })]);
    return { outcome: verdict.passed ? 'passed' : 'blocked', findings: verdict.findings };
  });
}
