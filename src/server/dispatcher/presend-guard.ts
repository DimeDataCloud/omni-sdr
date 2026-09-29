import { Lead, OutreachCopy, TrustDialLevel } from '@/types';
import { claimsGateVerifier } from '../claims-gate/verifier';

export interface PreSendValidation {
  canSend: boolean;
  blockReason?: string;
  veracityScore: number;
}

// Global exclusion domains that must NEVER receive cold outreach
const EXCLUSION_DOMAINS = [
  'omnisdr.com',
  'dimedata.cloud',
  'google.com',
  'apple.com',
  'microsoft.com',
  'tenlandholdings.com'
];

export class PreSendGuard {
  private dailySendCounts: Record<string, number> = {};

  /**
   * Pre-send safety check ensuring complete compliance before firing external bytes
   */
  validate(
    lead: Lead,
    copy: OutreachCopy,
    trustDialLevel: TrustDialLevel,
    senderEmail: string = 'outbound@omnisdr.com'
  ): PreSendValidation {
    // 1. Check Global Blocklist & Excluded Domains
    if (lead.email) {
      const domain = lead.email.split('@')[1]?.toLowerCase();
      if (domain && EXCLUSION_DOMAINS.includes(domain)) {
        return {
          canSend: false,
          blockReason: `Target domain "${domain}" is on the internal exclusion blocklist.`,
          veracityScore: 0
        };
      }
    }

    // 2. Check Recipient Lead Status
    if (lead.status === 'rejected' || lead.status === 'disqualified') {
      return {
        canSend: false,
        blockReason: `Lead ${lead.businessName} is marked as ${lead.status}. Execution halted.`,
        veracityScore: 0
      };
    }

    // 3. Enforce The Trust Dial
    if (trustDialLevel === 1 && lead.status !== 'approved') {
      return {
        canSend: false,
        blockReason: 'Trust Dial is set to Level 1 (Manual Swipe Review). Lead requires human approval first.',
        veracityScore: 100
      };
    }

    if (trustDialLevel === 2 && copy.confidenceScore < 0.90) {
      return {
        canSend: false,
        blockReason: `Trust Dial Level 2 requires >=90% confidence (lead scored ${Math.round(copy.confidenceScore * 100)}%).`,
        veracityScore: Math.round(copy.confidenceScore * 100)
      };
    }

    // 4. Rate Limiting Check (Warmup Protection: max 30 sends/day/sender)
    const today = new Date().toISOString().split('T')[0];
    const key = `${senderEmail}_${today}`;
    const currentSends = this.dailySendCounts[key] || 0;

    if (currentSends >= 30) {
      return {
        canSend: false,
        blockReason: `Daily rate limit reached for ${senderEmail} (${currentSends}/30 sends). Paused to protect domain reputation.`,
        veracityScore: 100
      };
    }

    // 5. Claims-Gate Verification
    const audit = claimsGateVerifier.verify(copy, lead.evidenceAnchors);
    if (!audit.isApproved) {
      return {
        canSend: false,
        blockReason: `Claims-Gate Refusal: ${audit.violations.join('; ')}`,
        veracityScore: audit.veracityScore
      };
    }

    return {
      canSend: true,
      veracityScore: audit.veracityScore
    };
  }

  recordSend(senderEmail: string): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${senderEmail}_${today}`;
    this.dailySendCounts[key] = (this.dailySendCounts[key] || 0) + 1;
  }
}

export const preSendGuard = new PreSendGuard();
