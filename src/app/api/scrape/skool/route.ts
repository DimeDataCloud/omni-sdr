import { NextRequest, NextResponse } from 'next/server';
import { skoolCrawler } from '@/server/harvester/skool-crawler';
import { AuditRepo, LeadRepo } from '@/server/db/firestore';
import { generateAuditReport, generateOutreachCopy } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url = 'https://skool.com/agency-builders', campaignId = 'camp-2' } = body;

    const intel = await skoolCrawler.crawlCommunity(url);
    const lead = skoolCrawler.toLead(intel, campaignId);

    const copy = await generateOutreachCopy(lead, 'Automated member onboarding and churn reduction');
    lead.outreachDrafts = copy;

    const audit = await generateAuditReport(lead);
    await AuditRepo.create(audit);
    await LeadRepo.create(lead);

    return NextResponse.json({
      success: true,
      intel,
      lead
    });
  } catch (err: any) {
    console.error('Error in /api/scrape/skool:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
