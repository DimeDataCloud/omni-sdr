const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const BUCKET_NAME = process.env.BUCKET_NAME || 'omnisdr-leads';

/**
 * Cloud Function to ingest and query waitlist submissions directly from Google Cloud Storage
 */
exports.waitlistIngest = async (req, res) => {
  // CORS support
  res.set('Access-Control-Allow-Origin', 'https://omnisdr.com');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  // No GET. This endpoint is public (allUsers invoker), so it only ever accepts writes.
  // Export the list from an authenticated machine instead:
  //   gcloud storage cat "gs://omnisdr-leads/leads/*.json"

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // POST: Ingest new lead into GCS
  try {
    const body = req.body || {};
    const { name, email, accountType, company, phone, location } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const hash = Math.random().toString(36).substring(2, 6).toUpperCase();
    const accessCode = `OMNI-VIP-${hash}`;
    const leadId = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const submittedAt = new Date().toISOString();

    const leadRecord = {
      id: leadId,
      name: name.trim().slice(0, 100),
      email: email.trim().toLowerCase().slice(0, 254),
      accountType: accountType === 'agency' ? 'agency' : 'owner',
      company: company ? String(company).trim().slice(0, 100) : null,
      phone: phone ? String(phone).trim().slice(0, 30) : null,
      location: location ? String(location).trim().slice(0, 100) : null,
      discountCode: accessCode,
      status: 'new',
      source: 'omnisdr.com',
      submittedAt,
      userAgent: req.get('user-agent') || null,
      ip: req.ip || req.get('x-forwarded-for') || null,
      storageSync: {
        gcs: true,
        gcsUri: `gs://${BUCKET_NAME}/leads/${leadId}.json`
      }
    };

    // Save to GCS
    const bucket = storage.bucket(BUCKET_NAME);
    const file = bucket.file(`leads/${leadId}.json`);
    await file.save(JSON.stringify(leadRecord, null, 2), {
      contentType: 'application/json',
      metadata: {
        cacheControl: 'no-cache',
        source: 'omnisdr-waitlist-api'
      }
    });

    console.log(`[Omni SDR Ingest] Successfully saved lead ${leadId} to gs://${BUCKET_NAME}/leads/${leadId}.json`);

    return res.status(200).json({
      success: true,
      message: "Thank you! Your spot is secured. You're locked in for our exclusive early-access discount when we launch.",
      accessCode,
      leadId,
      gcsSynced: true
    });
  } catch (err) {
    console.error('[Omni SDR Ingest] Error saving lead to GCS:', err);
    return res.status(500).json({ error: 'Failed to persist lead to storage' });
  }
};
