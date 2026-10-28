// What a client may see of a conversation (PR #155 V-49 P2). The summary is written from the intent and channel, never from
// message text, so a phone number or a name typed by the sender cannot reach it. The real route returns no body text at all.
import type { ClientConversation, Intent } from '../types';

const SAID: Record<Intent, string> = {
  meeting_request: 'Asked to book a time', positive_inquiry: 'Showed interest', question: 'Asked a question', referral: 'Pointed us to someone else',
  objection: 'Raised a concern', out_of_office: 'Sent an out-of-office reply', not_interested: 'Said they are not interested', wrong_person: 'Said we reached the wrong person',
  unsubscribe: 'Asked to stop hearing from us', bounce: 'The message did not arrive', unclassified: 'Waiting for a person to look',
};
const VIA = { email: 'by email', linkedin: 'on LinkedIn', form: 'through your form' } as const;

/** Last four digits only: (•••) •••-0142. Null when there is no number. */
export const maskPhone = (p: string | null): string | null => { const d = (p ?? '').replace(/\D/g, ''); return d.length >= 4 ? '(•••) •••-' + d.slice(-4) : null; };

export interface InboundLike { channel: 'email' | 'linkedin' | 'form'; receivedAt: string; intent: string; handledAt: string | null }

export const projectConversation = (contactId: string, name: string, phone: string | null, last: InboundLike): ClientConversation => ({
  id: contactId, name, maskedPhone: maskPhone(phone), channel: last.channel, lastAt: last.receivedAt,
  summary: `${SAID[last.intent as Intent] ?? SAID.unclassified} ${VIA[last.channel] ?? ''}`.trim(), status: last.handledAt ? 'handled' : 'open',
});
