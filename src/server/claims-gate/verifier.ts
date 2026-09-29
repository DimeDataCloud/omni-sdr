import { EvidenceAnchor, OutreachCopy } from '@/types';

export interface VeracityAuditResult {
  isApproved: boolean;
  veracityScore: number; // 0 - 100
  wordCount: number;
  characterCount: number;
  citedAnchor: EvidenceAnchor | null;
  violations: string[];
  recommendations: string[];
}

const BANNED_PATTERNS = [
  /\bhope this (?:email|message) finds you well\b/i,
  /\bcame across your (?:profile|website)\b/i,
  /\bstumbled upon your (?:business|company)\b/i,
  /\bhelp businesses like yours scale\b/i,
  /\bguaranteed (?:10|15|20|30) (?:qualified|new) (?:leads|appointments)\b/i,
  /\bquick question for you\b/i,
  /\bcan i pick your brain\b/i,
  /\bfree 15-minute discovery call\b/i,
  /\brevolutionary ai (?:platform|solution)\b/i
];

export class ClaimsGateVerifier {
  /**
   * Verify outreach copy against strict empirical evidence anchors.
   * Hard-refuses any message containing unevidenced assertions or spam patterns.
   */
  verify(copy: OutreachCopy, availableAnchors: EvidenceAnchor[]): VeracityAuditResult {
    const violations: string[] = [];
    const recommendations: string[] = [];

    const fullText = `${copy.subject || ''} ${copy.body} ${copy.callToAction}`;
    const words = copy.body.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const characterCount = copy.body.length;

    // 1. Length checks
    if (copy.channel === 'email' && wordCount > 85) {
      violations.push(`Email copy exceeds 85 words (${wordCount} words detected). High-ticket buyers abandon lengthy sales emails.`);
    }

    if (copy.channel === 'sms' && characterCount > 240) {
      violations.push(`SMS exceeds 240 characters (${characterCount} chars). May break into multiple segments or trigger carrier filtering.`);
    }

    if (copy.channel === 'linkedin' && characterCount > 300) {
      violations.push(`LinkedIn connection note exceeds 300 characters (${characterCount} chars). Will be truncated by LinkedIn API.`);
    }

    // 2. Banned spam pattern matching
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.test(fullText)) {
        violations.push(`Triggered spam filter: matches banned pattern "${pattern.source}".`);
      }
    }

    // 3. Evidence binding verification
    const boundAnchor = availableAnchors.find(a => a.id === copy.citedEvidenceId) || null;
    if (!boundAnchor) {
      violations.push(`Missing or invalid evidence anchor ID (${copy.citedEvidenceId}). Outreach cannot be sent without cited proof.`);
    } else {
      // 4. Substantive token overlap
      const snippetTokens = boundAnchor.snippet
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 4);

      const bodyLower = fullText.toLowerCase();
      const hasTokenMatch = snippetTokens.some(token => bodyLower.includes(token));
      const hasTitleMatch = bodyLower.includes(boundAnchor.title.toLowerCase().slice(0, 15));

      if (!hasTokenMatch && !hasTitleMatch) {
        violations.push(`Copy does not substantively reference the cited evidence anchor: "${boundAnchor.title}".`);
        recommendations.push('Insert a direct phrase or metric from the prospect evidence into the opening line.');
      }
    }

    // 5. Score computation
    let score = 100;
    if (violations.length > 0) {
      score = Math.max(10, 100 - violations.length * 25);
    } else if (wordCount <= 60 && boundAnchor) {
      score = 98; // Ideal concise evidence-backed copy
    }

    const isApproved = violations.length === 0 && score >= 85;

    return {
      isApproved,
      veracityScore: score,
      wordCount,
      characterCount,
      citedAnchor: boundAnchor,
      violations,
      recommendations
    };
  }
}

export const claimsGateVerifier = new ClaimsGateVerifier();
