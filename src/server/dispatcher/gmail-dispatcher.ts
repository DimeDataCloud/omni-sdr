import { Lead, OutreachCopy, TrustDialLevel } from '@/types';
import { preSendGuard } from './presend-guard';
import { LeadRepo } from '../db/firestore';

export interface DispatchResult {
  success: boolean;
  messageId?: string;
  channel: 'email' | 'sms' | 'linkedin';
  recipient: string;
  dispatchedAt: string;
  error?: string;
}

export class GmailDispatcher {
  private senderEmail: string;

  constructor(senderEmail = 'outbound@omnisdr.com') {
    this.senderEmail = senderEmail;
  }

  /**
   * Dispatch a verified cold email via Google Workspace / Gmail API
   */
  async dispatch(
    lead: Lead,
    copy: OutreachCopy,
    trustDialLevel: TrustDialLevel = 1,
    parentMessageId?: string
  ): Promise<DispatchResult> {
    const recipient = lead.email || '';
    if (!recipient) {
      return {
        success: false,
        channel: 'email',
        recipient: 'unknown',
        dispatchedAt: new Date().toISOString(),
        error: `Lead ${lead.businessName} has no valid recipient email address.`
      };
    }

    // 1. Pre-Send Guard Enforcement
    const validation = preSendGuard.validate(lead, copy, trustDialLevel, this.senderEmail);
    if (!validation.canSend) {
      return {
        success: false,
        channel: 'email',
        recipient,
        dispatchedAt: new Date().toISOString(),
        error: validation.blockReason || 'Failed pre-send guard validation.'
      };
    }

    // 2. Generate RFC 2822 Message-ID and payload
    const domain = this.senderEmail.split('@')[1] || 'omnisdr.com';
    const messageId = `<omni.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@${domain}>`;
    const now = new Date().toUTCString();

    const headers = [
      `From: "Christian Dixon" <${this.senderEmail}>`,
      `To: ${recipient}`,
      `Date: ${now}`,
      `Subject: ${copy.subject || 'Follow up'}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 7bit',
    ];

    if (parentMessageId) {
      headers.push(`In-Reply-To: ${parentMessageId}`);
      headers.push(`References: ${parentMessageId}`);
    }

    const emailBody = `${copy.body}\n\n${copy.callToAction}\n\nChristian Dixon\nFounding Partner | Omni-SDR`;
    const rfc2822Payload = `${headers.join('\r\n')}\r\n\r\n${emailBody}`;

    // 3. Execution (Simulated native dispatch with audit logging)
    console.log(`[Gmail Dispatcher] Dispatched ${messageId} to ${recipient}`);
    preSendGuard.recordSend(this.senderEmail);

    // Update lead status in repository
    await LeadRepo.update(lead.id, {
      status: 'active_sequence',
      lastTouchAt: new Date().toISOString()
    });

    return {
      success: true,
      messageId,
      channel: 'email',
      recipient,
      dispatchedAt: new Date().toISOString()
    };
  }
}

export const gmailDispatcher = new GmailDispatcher();
