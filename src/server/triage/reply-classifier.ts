import { InboundReplyTriage, Lead } from '@/types';
import { triageInboundReply } from '@/lib/gemini';
import { InboundReplyRepo, LeadRepo } from '../db/firestore';

export class ReplyClassifier {
  /**
   * Process an inbound prospect reply from Gmail or Twilio SMS
   */
  async processInboundMessage(
    leadId: string,
    channel: 'email' | 'sms',
    incomingMessage: string
  ): Promise<InboundReplyTriage> {
    const lead = await LeadRepo.getById(leadId);
    const leadName = lead?.decisionMakerName || 'Prospect';
    const companyName = lead?.businessName || 'Target Company';

    // 1. Triage using Gemini intelligence
    const triage = await triageInboundReply(incomingMessage, leadName, companyName);

    // 2. Determine lead status update
    let newStatus = lead?.status || 'replied';
    if (triage.sentiment === 'positive_hot') {
      newStatus = 'replied';
    } else if (triage.sentiment === 'unsubscribe') {
      newStatus = 'disqualified';
    }

    if (lead) {
      await LeadRepo.update(lead.id, {
        status: newStatus,
        lastTouchAt: new Date().toISOString(),
        notes: `Inbound reply received (${triage.sentiment}): "${incomingMessage.slice(0, 100)}..."`
      });
    }

    // 3. Create InboundReply record
    const replyRecord: InboundReplyTriage = {
      id: `reply-${Date.now()}`,
      leadId,
      leadName,
      companyName,
      channel,
      incomingText: incomingMessage,
      sentiment: triage.sentiment,
      suggestedAction: triage.suggestedAction,
      suggestedReplyCopy: triage.suggestedReplyCopy,
      receivedAt: new Date().toISOString(),
      autoExecuted: false
    };

    await InboundReplyRepo.create(replyRecord);
    return replyRecord;
  }
}

export const replyClassifier = new ReplyClassifier();
