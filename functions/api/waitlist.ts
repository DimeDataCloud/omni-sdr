// Waitlist API for omnisdr.com — D1 backend
// Records TCPA consent for recurring marketing outreach

interface Env {
  DB: D1Database;
}

const CONSENT_TEXT = "By submitting, you agree to receive recurring marketing calls and text messages (including by autodialer or prerecorded voice) from OmniSDR at the phone number provided. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out of texts.";

function sanitize(input: unknown, maxLen: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim().slice(0, maxLen);
}

function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(email);
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };

  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Malformed JSON payload' }), { status: 400, headers });
    }

    const name = sanitize(body.name, 100);
    const email = sanitize(typeof body.email === 'string' ? body.email.trim().toLowerCase() : '', 254);
    const company = sanitize(body.company, 100) || null;
    const phone = sanitize(body.phone, 30) || null;
    const location = sanitize(body.location, 100) || null;
    const accountType = sanitize(body.accountType, 20) === 'agency' ? 'agency' : 'owner';

    if (!name || name.length < 2) {
      return new Response(JSON.stringify({ error: 'Please provide a valid full name (minimum 2 characters)' }), { status: 400, headers });
    }
    if (!isValidEmail(email)) {
      return new Response(JSON.stringify({ error: 'Please enter a valid email address' }), { status: 400, headers });
    }

    // Rate limit: 5 submissions per IP per 10 minutes
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await env.DB.prepare(
      'SELECT COUNT(*) as c FROM waitlist_leads WHERE ip = ? AND submitted_at > ?'
    ).bind(ip, tenMinAgo).first<{ c: number }>();
    if (recent && recent.c >= 5) {
      return new Response(JSON.stringify({ error: 'Too many submissions. Please try again later.' }), { status: 429, headers });
    }

    const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const submittedAt = new Date().toISOString();
    const userAgent = sanitize(request.headers.get('user-agent'), 250) || null;

    try {
      await env.DB.prepare(
        `INSERT INTO waitlist_leads (id, name, email, account_type, company, phone, location, status, source, user_agent, ip, submitted_at, consent_text, consent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'omnisdr.com/landing', ?, ?, ?, ?, ?)`
      ).bind(id, name, email, accountType, company, phone, location, userAgent, ip, submittedAt, CONSENT_TEXT, submittedAt).run();
    } catch (e: any) {
      if (e?.message?.includes('UNIQUE constraint failed')) {
        return new Response(JSON.stringify({ success: true, leadId: id, duplicate: true }), { status: 200, headers });
      }
      throw e;
    }

    return new Response(JSON.stringify({ success: true, leadId: id }), {
      status: 200,
      headers: { ...headers, 'X-Frame-Options': 'DENY' }
    });
  } catch (error: any) {
    console.error('[waitlist] Error:', error?.message || error);
    return new Response(JSON.stringify({ error: 'We could not save your signup. Please try again in a minute.' }), { status: 502, headers });
  }
}

// No GET — reads stay out of the public function.
// Export leads via: wrangler d1 execute omnisdr-rep --command "SELECT * FROM waitlist_leads"
