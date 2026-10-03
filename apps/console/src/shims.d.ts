// The shared JS modules the demo runs in the browser (same code as the backend).
declare module '@gate/check.mjs' {
  export const GATE_VERSION: string;
  export function checkDraft(
    draft: { subject?: string | null; body: string; step: number; claims: { text: string; evidence_id: string; fact_key: string }[] },
    ctx: { contactId: string; evidence: Map<string, { contact_id: string; facts: Record<string, unknown>; expires_at: string }>; now: Date; competitors: string[] },
  ): { passed: boolean; version: string; findings: { code: string; detail: string }[] };
}
declare module '@rules/reply-rules.mjs' {
  export function classifyReply(m: { subject?: string; body?: string; from?: string }): { intent: string; confidence: number | null; by: string };
  export function addBusinessMinutes(start: Date, minutes: number, timeZone: string, hours?: { open?: number; close?: number }): Date;
  export const SLA_MINUTES: number;
}
declare module '@rules/playbook.mjs' {
  export const PLAYBOOK_CATEGORIES: readonly string[];
  export const FIELDS: readonly string[];
  export function unknownFields(text: string | null | undefined): string[];
  export function render(template: string, values: Record<string, string | null | undefined>): { text: string; missing: string[] };
  export function firstName(name: string | null | undefined): string | null;
  export const AUTONOMY_WINDOW: number;
  export const AUTONOMY_RATE: number;
}
declare module '@rules/catalog.mjs' {
  export const CONNECTORS: readonly {
    id: string; name: string; category: 'mail' | 'calendar' | 'booking' | 'social' | 'commerce' | 'crm' | 'export' | 'mcp' | 'warmup' | 'sms';
    auth: 'oauth' | 'api_key' | 'app_password' | 'provider'; activation: 'live' | 'later'; costOwner: 'omni' | 'customer';
    scopes: readonly { scope: string; why: string }[]; note?: string; consent?: { required: boolean; version: string };
  }[];
  export function freeEmailChecks(email: string): { email: string; status: 'invalid' | 'unknown'; role: boolean; disposable: boolean; reason: string | null };
}
declare module '@db/permissions.mjs' {
  export const ACTIONS: readonly string[];
  export function can(m: { role: string; clientApprovalsEnabled?: boolean }, action: string): boolean;
}

// G5 build-time config (src/lib/api/http.ts, src/lib/auth.ts). Absent: the build runs the demo.
interface ImportMetaEnv {
  readonly VITE_OMNI_API_URL?: string;
  readonly VITE_OMNI_IDP_KEY?: string;
  readonly VITE_OMNI_DEV_AS?: string;
}
