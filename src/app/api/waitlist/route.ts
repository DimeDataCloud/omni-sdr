import { NextRequest, NextResponse } from 'next/server';
import { saveWaitlistLead, getAllWaitlistLeads, exportLeadsToCSV } from '@/lib/storage';

// In-memory sliding-window rate limiter per IP
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;

// Clean up stale rate limits every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (entry.expiresAt < now) {
      rateLimitMap.delete(ip);
    }
  }
}, 15 * 60 * 1000);

/**
 * Sanitizes input string to prevent XSS, script injection, and control characters.
 */
function sanitizeString(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>]/g, '') // Strip angle brackets
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Strip control chars
    .trim()
    .slice(0, maxLength);
}

/**
 * RFC 5322 compliant email validator
 */
function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(email);
}

export async function POST(req: NextRequest) {
  try {
    // 1. IP extraction & Rate Limiting
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
               req.headers.get('x-real-ip') ||
               '127.0.0.1';

    const now = Date.now();
    const rateLimit = rateLimitMap.get(ip);

    if (rateLimit) {
      if (rateLimit.expiresAt > now) {
        if (rateLimit.count >= MAX_REQUESTS_PER_WINDOW) {
          return NextResponse.json(
            { error: 'Too many submissions from this connection. Please try again later.' },
            { status: 429, headers: { 'Retry-After': '600' } }
          );
        }
        rateLimit.count += 1;
      } else {
        rateLimitMap.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
      }
    } else {
      rateLimitMap.set(ip, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    }

    // 2. Parse & Validate Payload Size
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    // 3. Field Sanitization & Validation
    const name = sanitizeString(body.name, 100);
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const email = sanitizeString(rawEmail, 254);
    const company = sanitizeString(body.company, 100) || null;
    const phone = sanitizeString(body.phone, 30) || null;
    const location = sanitizeString(body.location, 100) || null;
    const rawAccountType = sanitizeString(body.accountType, 20);
    const accountType = rawAccountType === 'agency' ? 'agency' : 'owner';

    if (!name || name.length < 2) {
      return NextResponse.json(
        { error: 'Please provide a valid full name (minimum 2 characters)' },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid business or personal email address' },
        { status: 400 }
      );
    }

    const userAgent = sanitizeString(req.headers.get('user-agent'), 250);

    // 4. Persistence to Storage System (Cloud Storage + local append ledger)
    const lead = await saveWaitlistLead({
      name,
      email,
      accountType,
      company,
      phone,
      location,
      source: 'omnisdr.com/landing',
      userAgent,
      ip
    });

    // 5. Response with flexible undetermined discount messaging
    return NextResponse.json({
      success: true,
      message: "Thank you! Your spot is secured. You're locked in for our exclusive early-access discount when we launch.",
      accessCode: lead.discountCode,
      leadId: lead.id,
      gcsSynced: lead.storageSync?.gcs ?? false
    }, {
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });
  } catch (error: any) {
    console.error('[API /api/waitlist] Error processing lead submission:', error);
    return NextResponse.json(
      { error: 'Internal Server Error while securing discount' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    // SECURITY: Protect read access to customer lead data
    const authHeader = req.headers.get('authorization') || '';
    const adminKey = req.nextUrl.searchParams.get('key') || '';
    const expectedSecret = process.env.ADMIN_SECRET_KEY;
    if (!expectedSecret) {
      // Fail closed: no secret configured means nobody gets read access.
      return NextResponse.json(
        { error: 'Server misconfigured: ADMIN_SECRET_KEY is not set' },
        { status: 500 }
      );
    }

    const isAuthorized =
      authHeader === `Bearer ${expectedSecret}` || 
      adminKey === expectedSecret;

    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized. Protected endpoint.' },
        { status: 401 }
      );
    }

    const format = req.nextUrl.searchParams.get('format');

    if (format === 'csv') {
      const csv = await exportLeadsToCSV();
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="omni_sdr_waitlist_${Date.now()}.csv"`,
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    const leads = await getAllWaitlistLeads();
    return NextResponse.json({
      count: leads.length,
      leads
    }, {
      headers: {
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error: any) {
    console.error('[API /api/waitlist] Error fetching leads:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve waitlist leads' },
      { status: 500 }
    );
  }
}
