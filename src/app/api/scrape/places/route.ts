import { NextRequest, NextResponse } from 'next/server';
import { googlePlacesHarvester } from '@/server/harvester/google-places';
import { LeadRepo, AuditRepo } from '@/server/db/firestore';
import { generateAuditReport, generateOutreachCopy } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query = 'Commercial Roofing', location = 'Nashville, TN', campaignId = 'camp-1', niche = 'Commercial Contracting' } = body;

    const places = await googlePlacesHarvester.searchBusinesses(query, location);
    const leads = [];

    for (const place of places) {
      const lead = googlePlacesHarvester.extractLeadAndEvidence(place, campaignId, niche);

      // Generate bespoke copy and audit report via Gemini
      const copy = await generateOutreachCopy(lead, 'Automated 24/7 high-ticket lead triage');
      lead.outreachDrafts = copy;

      const audit = await generateAuditReport(lead);
      await AuditRepo.create(audit);
      await LeadRepo.create(lead);

      leads.push(lead);
    }

    return NextResponse.json({
      success: true,
      count: leads.length,
      leads
    });
  } catch (err: any) {
    console.error('Error in /api/scrape/places:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
