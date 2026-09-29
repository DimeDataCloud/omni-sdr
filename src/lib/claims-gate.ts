import { EvidenceAnchor, OutreachCopy } from '../types';

export interface ClaimsCheckResult {
  passed: boolean;
  veracityScore: number;
  matchedEvidence: EvidenceAnchor[];
  violations: string[];
}

// Banned generic cold outreach filler phrases that flag generic AI spam
const BANNED_HALLUCINATIONS = [
  'came across your profile',
  'stumbled upon your website',
  'i help businesses scale',
  'guaranteed 10-20 qualified appointments',
  'hope this email finds you well',
  'quick question for you',
  'wondering if you are taking on new clients',
  'synergies between our companies',
  'revolutionary ai solution',
  'game-changer for your business'
];

/**
 * Validates outreach copy against strict verified evidence anchors.
 * An outreach copy MUST pass this gate before it can be queued or sent.
 */
export function validateClaimsGate(
  copy: OutreachCopy,
  evidencePool: EvidenceAnchor[]
): ClaimsCheckResult {
  const violations: string[] = [];
  const lowerBody = (copy.body + ' ' + (copy.subject || '')).toLowerCase();

  // 1. Check for banned generic AI spam phrases
  for (const phrase of BANNED_HALLUCINATIONS) {
    if (lowerBody.includes(phrase)) {
      violations.push(`Banned generic filler detected: "${phrase}". Copy must be grounded in specific prospect data.`);
    }
  }

  // 2. Check evidence binding
  if (!copy.citedEvidenceId) {
    violations.push('No evidence anchor bound to this outreach draft.');
  }

  const boundEvidence = evidencePool.filter(e => e.id === copy.citedEvidenceId);
  if (boundEvidence.length === 0) {
    violations.push(`Cited evidence ID ${copy.citedEvidenceId} not found in verified prospect dossier.`);
  }

  // 3. Verify that the copy actually references key tokens from the evidence
  const matchedEvidence: EvidenceAnchor[] = [];
  for (const evidence of evidencePool) {
    // Check snippet overlap or title presence
    const snippetTokens = evidence.snippet
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4);
    
    const hasOverlap = snippetTokens.some(token => lowerBody.includes(token));
    const mentionsTitle = lowerBody.includes(evidence.title.toLowerCase());

    if (hasOverlap || mentionsTitle) {
      matchedEvidence.push(evidence);
    }
  }

  if (matchedEvidence.length === 0 && boundEvidence.length > 0) {
    // If it binds an ID but completely ignores the evidence in the actual text
    violations.push(`Copy does not substantively reference the cited evidence: "${boundEvidence[0]?.title}".`);
  }

  // 4. Calculate veracity score
  let score = 1.0;
  if (violations.length > 0) {
    score = Math.max(0.1, 1.0 - (violations.length * 0.3));
  } else if (matchedEvidence.length >= 2) {
    score = 1.0;
  } else {
    score = 0.92;
  }

  const passed = violations.length === 0 && score >= 0.85;

  return {
    passed,
    veracityScore: Math.round(score * 100) / 100,
    matchedEvidence,
    violations
  };
}
