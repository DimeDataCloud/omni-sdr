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
