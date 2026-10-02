const GCS_INGEST_URL = 'https://omni-waitlist-api-eb7lrmqqwa-uc.a.run.app';

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

    // Stream directly into Google Cloud Storage via serverless ingest endpoint in Google project (hip-well-509308-m9)
    try {
      const gcsResponse = await fetch(GCS_INGEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          accountType: accountType === 'agency' ? 'agency' : 'owner',
          company: company ? String(company).trim() : null,
          phone: phone ? String(phone).trim() : null,
          location: location ? String(location).trim() : null
        })
      });

      if (gcsResponse.ok) {
        const result = await gcsResponse.json();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY'
          }
        });
      }
    } catch (gcsErr) {
      console.error('[Cloudflare Pages Edge] Error calling GCS ingest:', gcsErr);
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

// No GET. The ingest service refuses reads (405) because it is public; this proxy for them was how the 2026-09-28
// P0 leaked every signup, and it would reopen the leak if a read ever came back upstream (bug bounty 2026-10-02).
// Export from an authenticated machine: gcloud storage cat "gs://omnisdr-leads/leads/*.json"
