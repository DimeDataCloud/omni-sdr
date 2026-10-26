// Signups go into Cloudflare D1 (binding WAITLIST_DB, schema in migrations/0001_waitlist.sql).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newAccessCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return 'OMNI-VIP-' + Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function onRequestPost(context: any) {
  try {
    const request = context.request;
    const body = await request.json();

    const { name, email, company, phone, location, accountType } = body;

    // Strict validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      return new Response(JSON.stringify({ error: 'Name is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'A valid email address is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // One row per lowercased email. A repeat signup changes nothing and gets the first access code back.
    try {
      const row: any = await context.env.WAITLIST_DB
        .prepare(
          `INSERT INTO waitlist (email, name, account_type, company, phone, location, access_code)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(email) DO UPDATE SET email = email
           RETURNING access_code`
        )
        .bind(
          email.trim().toLowerCase().slice(0, 254),
          name.trim().slice(0, 100),
          accountType === 'agency' ? 'agency' : 'owner',
          company ? String(company).trim().slice(0, 100) : null,
          phone ? String(phone).trim().slice(0, 30) : null,
          location ? String(location).trim().slice(0, 100) : null,
          newAccessCode()
        )
        .first();
      if (!row?.access_code) throw new Error('no row returned');
      return new Response(JSON.stringify({
        success: true,
        message: "Thank you! Your spot is secured. You're locked in for our exclusive early-access discount when we launch.",
        accessCode: row.access_code
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY'
        }
      });
    } catch (dbErr) {
      console.error('[Cloudflare Pages Edge] Error writing waitlist signup to D1:', dbErr);
    }

    // Nothing was saved, so say so. Never promise a spot that wasn't recorded.
    return new Response(JSON.stringify({ error: 'We could not save your signup. Please try again in a minute.' }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: 'Internal Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// No GET. Signups are only ever written here; a read route is how the 2026-09-28 P0 leaked every signup.
// Export from an authenticated machine: wrangler d1 execute WAITLIST_DB --remote --command "SELECT * FROM waitlist"
