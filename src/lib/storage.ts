import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';

export interface WaitlistLeadInput {
  name: string;
  email: string;
  accountType?: 'owner' | 'agency' | string | null;
  company?: string | null;
  phone?: string | null;
  location?: string | null;
  source?: string;
  userAgent?: string | null;
  ip?: string | null;
}

export interface WaitlistLead {
  id: string;
  name: string;
  email: string;
  accountType: 'owner' | 'agency' | string | null;
  company: string | null;
  phone: string | null;
  location: string | null;
  discountCode: string;
  status: 'new' | 'contacted' | 'enrolled';
  source: string;
  submittedAt: string;
  userAgent?: string | null;
  ip?: string | null;
  storageSync?: {
    local: boolean;
    gcs: boolean;
    gcsUri?: string;
  };
}

const DATA_DIR = path.join(process.cwd(), 'data');
const JSONL_FILE = path.join(DATA_DIR, 'waitlist.jsonl');
const JSON_FILE = path.join(DATA_DIR, 'waitlist.json');

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'omnisdr-leads';

// Initialize GCS client lazily
let gcsClient: Storage | null = null;
function getGCSClient(): Storage {
  if (!gcsClient) {
    gcsClient = new Storage();
  }
  return gcsClient;
}

/**
 * Ensure the local data directory exists.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Generates an early-bird discount code
 */
function generateDiscountCode(email: string): string {
  const hash = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `OMNI-VIP-${hash}`;
}

/**
 * Saves a new waitlist lead across:
 * 1. Local append-only JSONL
 * 2. Local full JSON cache
 * 3. Google Cloud Storage bucket (gs://omnisdr-leads/leads/...)
 */
export async function saveWaitlistLead(input: WaitlistLeadInput): Promise<WaitlistLead> {
  ensureDataDir();

  const id = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const discountCode = generateDiscountCode(input.email);
  const submittedAt = new Date().toISOString();

  const lead: WaitlistLead = {
    id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    accountType: input.accountType === 'agency' ? 'agency' : 'owner',
    company: input.company?.trim() || null,
    phone: input.phone?.trim() || null,
    location: input.location?.trim() || null,
    discountCode,
    status: 'new',
    source: input.source || 'omnisdr.com/landing',
    submittedAt,
    userAgent: input.userAgent || null,
    ip: input.ip || null,
    storageSync: {
      local: true,
      gcs: false
    }
  };

  // 1. Write to local JSONL (atomic append)
  try {
    fs.appendFileSync(JSONL_FILE, JSON.stringify(lead) + '\n', 'utf8');
  } catch (err) {
    console.error('[Storage] Error writing local JSONL:', err);
  }

  // 2. Update local JSON array
  try {
    let allLeads: WaitlistLead[] = [];
    if (fs.existsSync(JSON_FILE)) {
      try {
        const raw = fs.readFileSync(JSON_FILE, 'utf8');
        allLeads = JSON.parse(raw);
      } catch {
        allLeads = [];
      }
    }
    allLeads.unshift(lead);
    fs.writeFileSync(JSON_FILE, JSON.stringify(allLeads, null, 2), 'utf8');
  } catch (err) {
    console.error('[Storage] Error updating local JSON array:', err);
  }

  // 3. Upload to Google Cloud Storage (GCS)
  try {
    const storage = getGCSClient();
    const bucket = storage.bucket(BUCKET_NAME);
    const objectPath = `leads/${lead.id}.json`;
    const file = bucket.file(objectPath);

    await file.save(JSON.stringify(lead, null, 2), {
      contentType: 'application/json',
      metadata: {
        submittedAt: lead.submittedAt,
        email: lead.email,
        discountCode: lead.discountCode
      }
    });

    lead.storageSync = {
      local: true,
      gcs: true,
      gcsUri: `gs://${BUCKET_NAME}/${objectPath}`
    };
    console.log(`[Storage] Successfully saved lead ${lead.id} to GCS: gs://${BUCKET_NAME}/${objectPath}`);
  } catch (gcsErr: any) {
    console.warn(`[Storage] GCS upload skipped or failed (${gcsErr.message}). Local copy preserved safely.`);
  }

  return lead;
}

/**
 * Retrieves all stored leads
 */
export async function getAllWaitlistLeads(): Promise<WaitlistLead[]> {
  ensureDataDir();

  if (fs.existsSync(JSONL_FILE)) {
    try {
      const content = fs.readFileSync(JSONL_FILE, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      return lines.map((line) => JSON.parse(line)).reverse();
    } catch (err) {
      console.error('[Storage] Error reading JSONL file:', err);
    }
  }

  if (fs.existsSync(JSON_FILE)) {
    try {
      const raw = fs.readFileSync(JSON_FILE, 'utf8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  return [];
}

/**
 * Exports all leads to CSV
 */
export async function exportLeadsToCSV(): Promise<string> {
  const leads = await getAllWaitlistLeads();
  const headers = ['ID', 'Name', 'Email', 'Account Type', 'Company', 'Phone', 'Location', 'Discount Code', 'Status', 'Submitted At', 'GCS Synced'];
  
  const rows = leads.map((l) => [
    `"${l.id}"`,
    `"${(l.name || '').replace(/"/g, '""')}"`,
    `"${(l.email || '').replace(/"/g, '""')}"`,
    `"${(l.accountType === 'agency' ? 'agency' : 'owner').replace(/"/g, '""')}"`,
    `"${(l.company || '').replace(/"/g, '""')}"`,
    `"${(l.phone || '').replace(/"/g, '""')}"`,
    `"${(l.location || '').replace(/"/g, '""')}"`,
    `"${l.discountCode}"`,
    `"${l.status}"`,
    `"${l.submittedAt}"`,
    `"${l.storageSync?.gcs ? 'YES' : 'NO'}"`
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
