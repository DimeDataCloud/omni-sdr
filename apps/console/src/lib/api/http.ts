// The `http` adapter: the same Client contract, answered by the real API (docs/claude/API.md) with the signed-in
// person's Identity Platform ID token. List routes answer `{ items }`; the contract wants the array.
// Endpoints the API hasn't built yet (API.md §7 items 7–9, all PROPOSED) answer 501 `not_built`, except Studio's
// reads, which answer "nothing yet, generation off" so Studio shows its empty state instead of an error.
import { ApiError, invalidate, type Client, type Scope, type Campaign, type Icp, type ActivityItem, type ImportResult } from './client';
import type {
  Me, Settings, Members, ApprovalsList, ApprovalCard, InboxItem, Meeting, Agent, ChatMessage, Routine, Capacity, Analytics, Credits,
  Connector, Contact, ContactDetail, StudioCaps,
} from './types';
import { DEV_AS, idToken, signOut } from '../auth';

export const API_URL = (import.meta.env.VITE_OMNI_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

async function bearer(force = false) {
  if (DEV_AS) return `dev:${DEV_AS}`;
  const t = await idToken(force);
  if (!t) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return t;
}

async function req<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${await bearer(retried)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit' });
  } catch {
    throw new ApiError(0, 'network', 'Couldn’t reach Omni-SDR. Check your connection and try again.');
  }
  if (res.status === 401 && !retried && !DEV_AS) return req<T>(method, path, body, true); // the token may have just expired
  if (res.status === 204) return undefined as T;
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) signOut();
    throw new ApiError(res.status, out?.error ?? 'error', out?.message ?? `Request failed (${res.status}).`, out?.details);
  }
  return out as T;
}
const get = <T>(p: string) => req<T>('GET', p);
const items = async <T>(p: string) => (await get<{ items: T[] }>(p)).items;
/** A write, then every mounted query refetches (the demo adapter does the same). */
async function write<T>(method: string, p: string, body?: unknown) { const out = await req<T>(method, p, body); invalidate(); return out; }

const enc = encodeURIComponent;
const t = (s: Scope) => `/v1/o/${enc(s.orgId)}/w/${enc(s.workspaceId)}`;
const qs = (q: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const notBuilt = (what: string) => Promise.reject(new ApiError(501, 'not_built', `${what} isn’t available yet.`));

export const httpClient: Client = {
  mode: 'http',
  me: () => get<Me>('/v1/me'),
  createWorkspace: (orgId, name) => write('POST', `/v1/o/${enc(orgId)}/workspaces`, { name }),

  settings: (s) => get<Settings>(`${t(s)}/settings`),
  patchSettings: async (s, patch) => { await write('PATCH', `${t(s)}/settings`, patch); },
  members: (s) => get<Members>(`${t(s)}/members`),
  invite: (s, body) => write('POST', `${t(s)}/invites`, body),
  revokeInvite: async (s, id) => { await write('DELETE', `${t(s)}/invites/${enc(id)}`); },
  activity: (s) => items<ActivityItem>(`${t(s)}/activity`),

  approvals: (s, q = {}) => get<ApprovalsList>(`${t(s)}/approvals${qs({ status: q.status, minFit: q.minFit })}`),
  approval: (s, id) => get<ApprovalCard>(`${t(s)}/approvals/${enc(id)}`),
  approve: async (s, id) => { await write('POST', `${t(s)}/approvals/${enc(id)}/approve`); },
  bulkApprove: (s, ids) => write('POST', `${t(s)}/approvals/bulk-approve`, { ids }),
  reject: async (s, id, reason) => { await write('POST', `${t(s)}/approvals/${enc(id)}/reject`, reason ? { reason } : {}); },
  editDraft: (s, id, patch) => write('PATCH', `${t(s)}/approvals/${enc(id)}`, patch),
  createDraft: (s, body) => write('POST', `${t(s)}/drafts`, body),

  inbox: (s, q = {}) => items<InboxItem>(`${t(s)}/inbox${qs({ status: q.status })}`),
  handle: async (s, id) => { await write('POST', `${t(s)}/inbox/${enc(id)}/handle`); },
  bookFromReply: (s, id, body) => write<Meeting>('POST', `${t(s)}/inbox/${enc(id)}/meeting`, body),
  meetings: (s, range) => items<Meeting>(`${t(s)}/meetings${qs({ range })}`),
  patchMeeting: (s, id, patch) => write<Meeting>('PATCH', `${t(s)}/meetings/${enc(id)}`, patch),

  agents: (s) => items<Agent>(`${t(s)}/agents`),
  createAgent: (s, body) => write<Agent>('POST', `${t(s)}/agents`, body),
  patchAgent: (s, id, patch) => write<Agent>('PATCH', `${t(s)}/agents/${enc(id)}`, patch),
  agentStats: () => notBuilt('Agent stats'),
  datasets: () => notBuilt('Datasets'),
  archiveAgent: async (s, id) => { await write('DELETE', `${t(s)}/agents/${enc(id)}`); },
  messages: (s, agentId) => items<ChatMessage>(`${t(s)}/agents/${enc(agentId)}/messages`),
  // `about` and `mode` are PROPOSED (API.md §7 item 7); the built route takes body and modelTier only.
  sendMessage: (s, agentId, body, modelTier) => write('POST', `${t(s)}/agents/${enc(agentId)}/messages`, modelTier ? { body, modelTier } : { body }),

  routines: (s) => items<Routine>(`${t(s)}/routines`),
  createRoutine: (s, body) => write<Routine>('POST', `${t(s)}/routines`, body),
  patchRoutine: (s, id, patch) => write<Routine>('PATCH', `${t(s)}/routines/${enc(id)}`, patch),

  capacity: (s) => get<Capacity>(`${t(s)}/capacity`),
  setHold: async (s, body) => { await write('POST', `${t(s)}/holds`, body); },
  clearHold: async (s, scopeType, id) => { await write('DELETE', `${t(s)}/holds/${enc(scopeType)}/${enc(id)}`); },
  suppress: async (s, email, reason) => { await write('POST', `${t(s)}/suppression`, reason ? { email, reason } : { email }); },
  credits: (s) => get<Credits>(`${t(s)}/credits`),
  analytics: (s, days) => get<Analytics>(`${t(s)}/analytics${qs({ days })}`),
  pipeline: () => notBuilt('Today’s pipeline'),
  connectors: (s) => items<Connector>(`${t(s)}/connectors`),

  contacts: (s, q) => items<Contact>(`${t(s)}/contacts${qs({ q })}`),
  contact: (s, id) => get<ContactDetail>(`${t(s)}/contacts/${enc(id)}`),
  importContacts: (s, rows) => write<ImportResult>('POST', `${t(s)}/contacts`, { contacts: rows }),
  icps: (s) => items<Icp>(`${t(s)}/icps`),
  createIcp: (s, body) => write<Icp>('POST', `${t(s)}/icps`, body),
  campaigns: (s) => items<Campaign>(`${t(s)}/campaigns`),
  createCampaign: (s, body) => write<Campaign>('POST', `${t(s)}/campaigns`, body),
  patchCampaign: (s, id, patch) => write<Campaign>('PATCH', `${t(s)}/campaigns/${enc(id)}`, patch),
  enroll: async (s, campaignId, contactIds) => {
    const r = await write<{ enrolled: unknown[]; skipped: number }>('POST', `${t(s)}/campaigns/${enc(campaignId)}/enrollments`, { contactIds });
    return { enrolled: r.enrolled.length, skipped: r.skipped };
  },

  // Studio (PROPOSED, STUDIO-PLAN.md): nothing is stored server-side yet and generation is off.
  studioCaps: async () => ({ imageGeneration: false, videoGeneration: false, mediaCredits: 0, sample: false }) satisfies StudioCaps,
  assets: async () => [],
  asset: () => notBuilt('Studio'),
  uploadAsset: () => notBuilt('Uploading to Studio'),
  generate: () => notBuilt('Generation'),
  editAsset: () => notBuilt('Studio edits'),
  aiEdit: () => notBuilt('AI edits'),
  restoreVersion: () => notBuilt('Studio versions'),
  patchAsset: () => notBuilt('Studio'),
  setAssetStatus: () => notBuilt('Studio review'),
  archiveAsset: () => notBuilt('Studio'),
  products: async () => [],
  projects: async () => [],
  createProject: () => notBuilt('Studio projects'),
  patchProject: () => notBuilt('Studio projects'),
};

/** Sign-up and invites: signed in, no tenant yet. Not part of Client because the demo has no equivalent. */
export const account = {
  createOrg: (body: { orgName: string; accountType: 'owner' | 'agency'; workspaceName?: string }) =>
    write<{ orgId: string; workspaceId: string }>('POST', '/v1/orgs', body),
  acceptInvite: (token: string) => write<{ orgId: string }>('POST', '/v1/invites/accept', { token }),
};
