import { Lead, OutreachCopy, TrustDialLevel } from '@/types';
import { preSendGuard } from './presend-guard';
import { DispatchResult } from './gmail-dispatcher';
import { LeadRepo } from '../db/firestore';

export class TwilioDispatcher {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  constructor(
    accountSid?: string,
    authToken?: string,
    fromNumber?: string
  ) {
    this.accountSid = accountSid || process.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = authToken || process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = fromNumber || process.env.TWILIO_PHONE_NUMBER || '+16158278674';
  }

  /**
   * Dispatches compliant 1-to-1 SMS follow-up via Twilio
   */
  async dispatch(
    lead: Lead,
    copy: OutreachCopy,
    trustDialLevel: TrustDialLevel = 1
  ): Promise<DispatchResult> {
    const rawPhone = lead.phone || '';
    const cleanPhone = this.normalizePhone(rawPhone);

    if (!cleanPhone) {
      return {
        success: false,
        channel: 'sms',
        recipient: rawPhone,
        dispatchedAt: new Date().toISOString(),
        error: `Invalid or missing phone number for ${lead.businessName}.`
      };
    }

    // Pre-send validation
    const validation = preSendGuard.validate(lead, copy, trustDialLevel, this.fromNumber);
    if (!validation.canSend) {
      return {
        success: false,
        channel: 'sms',
        recipient: cleanPhone,
        dispatchedAt: new Date().toISOString(),
        error: validation.blockReason || 'Failed pre-send validation.'
      };
    }

    const messageText = `${copy.body}\n${copy.callToAction}`;

    if (this.accountSid && this.authToken) {
      try {
        const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
        const bodyParams = new URLSearchParams({
          To: cleanPhone,
          From: this.fromNumber,
          Body: messageText
        });

        const authHeader = 'Basic ' + Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: bodyParams.toString()
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.message || `Twilio error: ${res.status}`);
        }

        await LeadRepo.update(lead.id, {
          status: 'active_sequence',
          lastTouchAt: new Date().toISOString()
        });

        return {
          success: true,
          messageId: data.sid,
          channel: 'sms',
          recipient: cleanPhone,
          dispatchedAt: new Date().toISOString()
        };
      } catch (err: any) {
        console.error('Twilio dispatch failed:', err);
        return {
          success: false,
          channel: 'sms',
          recipient: cleanPhone,
          dispatchedAt: new Date().toISOString(),
          error: err.message
        };
      }
    }

    // Fallback simulation mode
    const simulatedSid = `SM_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    console.log(`[Twilio Dispatcher (Simulated)] Sent ${simulatedSid} to ${cleanPhone}: "${messageText}"`);

    await LeadRepo.update(lead.id, {
      status: 'active_sequence',
      lastTouchAt: new Date().toISOString()
    });

    return {
      success: true,
      messageId: simulatedSid,
      channel: 'sms',
      recipient: cleanPhone,
      dispatchedAt: new Date().toISOString()
    };
  }

  private normalizePhone(phone: string): string | null {
    const digits = phone.replace(/[^0-9]/g, '');
    if (digits.length === 10) {
      return `+1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    return null;
  }
}

export const twilioDispatcher = new TwilioDispatcher();
