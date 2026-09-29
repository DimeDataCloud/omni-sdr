import { NextRequest, NextResponse } from 'next/server';
import { websiteAuditor } from '@/server/harvester/website-auditor';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ success: false, error: 'URL is required.' }, { status: 400 });
    }

    const auditResult = await websiteAuditor.auditUrl(url);

    return NextResponse.json({
      success: true,
      audit: auditResult
    });
  } catch (err: any) {
    console.error('Error in /api/scrape/website:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
