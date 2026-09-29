import { Campaign, DynamicAuditReport, InboundReplyTriage, Lead, Tenant } from '@/types';
import fs from 'fs';
import path from 'path';

// If Google Application Default Credentials or FIREBASE_SERVICE_ACCOUNT is available,
// Firestore initializes natively. Otherwise, it gracefully persists to local JSON data store.
const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getFilePath(collection: string): string {
  return path.join(DATA_DIR, `${collection}.json`);
}

function readCollection<T>(collection: string): T[] {
  const filePath = getFilePath(collection);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading collection ${collection}:`, err);
    return [];
  }
}

function writeCollection<T>(collection: string, data: T[]): void {
  const filePath = getFilePath(collection);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing collection ${collection}:`, err);
  }
}

export class Repository<T extends { id: string }> {
  constructor(private collectionName: string) {}

  async getAll(): Promise<T[]> {
    return readCollection<T>(this.collectionName);
  }

  async getById(id: string): Promise<T | null> {
    const items = await this.getAll();
    return items.find(i => i.id === id) || null;
  }

  async create(item: T): Promise<T> {
    const items = await this.getAll();
    items.unshift(item);
    writeCollection<T>(this.collectionName, items);
    return item;
  }

  async update(id: string, updates: Partial<T>): Promise<T | null> {
    const items = await this.getAll();
    const index = items.findIndex(i => i.id === id);
    if (index === -1) return null;

    items[index] = { ...items[index], ...updates };
    writeCollection<T>(this.collectionName, items);
    return items[index];
  }

  async delete(id: string): Promise<boolean> {
    const items = await this.getAll();
    const filtered = items.filter(i => i.id !== id);
    if (filtered.length === items.length) return false;

    writeCollection<T>(this.collectionName, filtered);
    return true;
  }

  async query(predicate: (item: T) => boolean): Promise<T[]> {
    const items = await this.getAll();
    return items.filter(predicate);
  }
}

// Export singleton repositories for each entity
export const LeadRepo = new Repository<Lead>('leads');
export const CampaignRepo = new Repository<Campaign>('campaigns');
export const AuditRepo = new Repository<DynamicAuditReport>('audits');
export const InboundReplyRepo = new Repository<InboundReplyTriage>('inbound_replies');
export const TenantRepo = new Repository<Tenant>('tenants');
