import { NextRequest, NextResponse } from 'next/server';
import { LeadRepo } from '@/server/db/firestore';
import { gmailDispatcher } from '@/server/dispatcher/gmail-dispatcher';
import { twilioDispatcher } from '@/server/dispatcher/twilio-dispatcher';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leadId, channel = 'email', trustDialLevel = 1 } = body;

    const lead = await LeadRepo.getById(leadId);
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 });
    }

    const draft = lead.outreachDrafts.find(d => d.channel === channel) || lead.outreachDrafts[0];
    if (!draft) {
      return NextResponse.json({ success: false, error: `No outreach draft available for channel "${channel}".` }, { status: 400 });
    }

    let result;
    if (channel === 'email') {
      result = await gmailDispatcher.dispatch(lead, draft, trustDialLevel);
    } else if (channel === 'sms') {
      result = await twilioDispatcher.dispatch(lead, draft, trustDialLevel);
    } else {
      return NextResponse.json({ success: false, error: `Direct dispatch for channel "${channel}" requires manual token.` }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Error in /api/dispatch:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
