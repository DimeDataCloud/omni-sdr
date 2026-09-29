import { NextRequest, NextResponse } from 'next/server';
import { replyClassifier } from '@/server/triage/reply-classifier';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { leadId, channel = 'email', message } = body;

    if (!leadId || !message) {
      return NextResponse.json({ success: false, error: 'leadId and message are required.' }, { status: 400 });
    }

    const triageResult = await replyClassifier.processInboundMessage(leadId, channel, message);

    return NextResponse.json({
      success: true,
      triage: triageResult
    });
  } catch (err: any) {
    console.error('Error in /api/webhooks/incoming:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
