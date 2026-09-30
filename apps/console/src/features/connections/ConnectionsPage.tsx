// Connections (DESIGN 6.10). Status is real; "activates later" modules offer only the setup that exists.
import { useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Mail, Calendar, CalendarCheck, Share2, ShoppingBag, Database, Download, Cpu, Flame, MessageSquare, CheckCircle2, Plug, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import type { Connector } from '@/lib/api/types';
import { useQuery } from '@/lib/hooks';
import { useWorkspace } from '@/lib/session';
import { Badge, Button, Checkbox, ErrorState, Page, PageHeader, Sheet, SkeletonList, listItem, listStagger } from '@/components/ui';

const CAT: Record<Connector['category'], { label: string; icon: typeof Mail }> = {
  mail: { label: 'Email', icon: Mail }, calendar: { label: 'Calendar', icon: Calendar }, booking: { label: 'Booking', icon: CalendarCheck }, social: { label: 'Social', icon: Share2 },
  commerce: { label: 'Commerce', icon: ShoppingBag }, crm: { label: 'CRM', icon: Database }, export: { label: 'Export', icon: Download }, mcp: { label: 'MCP', icon: Cpu },
  warmup: { label: 'Warm-up', icon: Flame }, sms: { label: 'SMS', icon: MessageSquare },
};

export default function ConnectionsPage() {
  const { scope, can } = useWorkspace();
  const q = useQuery(() => api.connectors(scope), [scope.workspaceId]);
  const [connecting, setConnecting] = useState<Connector | null>(null);
  const groups = Object.entries(CAT).map(([k, v]) => ({ key: k, ...v, items: (q.data ?? []).filter((c) => c.category === k) })).filter((g) => g.items.length);
  return (
    <Page>
      <PageHeader title="Connections" subtitle="What Omni-SDR can reach, and exactly why it asks for each permission." />
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading ? <SkeletonList rows={5} /> : (
        <motion.div variants={listStagger} initial="hidden" animate="show" className="space-y-7">
          {groups.map((g) => (
            <motion.section key={g.key} variants={listItem} aria-labelledby={`cg-${g.key}`}>
              <h2 id={`cg-${g.key}`} className="section-title mb-2 flex items-center gap-2"><g.icon className="size-3.5" aria-hidden />{g.label}</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {g.items.map((c) => (
                  <article key={c.id} className="card flex flex-col p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken"><g.icon className="size-5" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold">{c.name}</h3>
                        <p className="text-xs text-muted">{c.costOwner === 'customer' ? 'Billed by the provider to you' : 'Included'} · {c.auth === 'oauth' ? 'Sign in with the provider' : c.auth === 'api_key' ? 'API key' : c.auth === 'app_password' ? 'App password' : 'Provider setup'}</p>
                      </div>
                      {c.status === 'connected' ? <Badge tone="success" icon={<CheckCircle2 className="size-3" aria-hidden />}>Connected</Badge>
                        : c.status === 'activates_later' ? <Badge tone="info">Set up now, activates later</Badge> : <Badge>Not connected</Badge>}
                    </div>
                    {c.id === 'gmail' && <p className="mt-3 text-sm">Send-only. Omni-SDR can&rsquo;t read your mail. Replies come back through reply.omnisdr.com.</p>}
                    {c.note && <p className="mt-3 text-sm text-muted">{c.note}</p>}
                    {c.category === 'warmup' && <p className="mt-3 flex gap-2 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Reply-network warm-up can put your mailbox at risk. Your hard daily cap always applies.</p>}
                    {c.scopes.length > 0 && (
                      <details className="group mt-3 text-sm">
                        <summary className="cursor-pointer font-medium text-ink select-none">{c.scopes.length === 1 ? '1 permission' : `${c.scopes.length} permissions`}, and why</summary>
                        <ul className="mt-2 space-y-1.5">{c.scopes.map((s) => <li key={s.scope}><code className="rounded bg-sunken px-1 font-mono text-xs">{s.scope}</code><span className="block text-muted">{s.why}</span></li>)}</ul>
                      </details>
                    )}
                    {can('connections') && c.status !== 'connected' && (
                      <div className="mt-auto pt-4"><Button size="sm" variant={c.status === 'activates_later' ? 'secondary' : 'primary'} icon={<Plug className="size-4" aria-hidden />} onClick={() => setConnecting(c)}>
                        {c.status === 'activates_later' ? 'Set up' : 'Connect'}</Button></div>
                    )}
                  </article>
                ))}
              </div>
            </motion.section>
          ))}
        </motion.div>
      )}
      <ConnectSheet c={connecting} onClose={() => setConnecting(null)} />
    </Page>
  );
}

function ConnectSheet({ c, onClose }: { c: Connector | null; onClose: () => void }) {
  const [agree, setAgree] = useState(false);
  const needsConsent = Boolean(c?.consent?.required);
  return (
    <Sheet open={Boolean(c)} onOpenChange={(v) => { if (!v) { setAgree(false); onClose(); } }} title={c ? `Connect ${c.name}` : ''}
      description="In this demo, connecting stops here. In the live product this opens the provider's own sign-in."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={needsConsent && !agree} onClick={() => { toast('Demo: no account was connected.'); setAgree(false); onClose(); }}>Continue to {c?.name}</Button></>}>
      {c && (
        <div className="space-y-3 text-sm">
          {c.scopes.length > 0 && <><p className="font-medium">You&rsquo;ll be asked to allow:</p>
            <ul className="space-y-1.5">{c.scopes.map((s) => <li key={s.scope} className="rounded-lg bg-sunken p-2.5"><code className="font-mono text-xs">{s.scope}</code><span className="block text-muted">{s.why}</span></li>)}</ul></>}
          {needsConsent && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-warning">
              <p>Automating LinkedIn breaks LinkedIn&rsquo;s User Agreement. Your account may be restricted.</p>
              <Checkbox checked={agree} onChange={setAgree} label={`I understand (consent ${c.consent!.version})`} className="mt-1 text-fg" />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
