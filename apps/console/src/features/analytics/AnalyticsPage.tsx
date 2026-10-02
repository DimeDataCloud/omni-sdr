// Analytics (DESIGN 6.8). Only what happened: sent → replied → positive → meeting. No opens, ever.
// A rate with no denominator shows "—" and says why; every number comes from rows.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { Send, MessageSquareReply, Sparkles, CalendarCheck2, CheckCheck, Coins, Info } from 'lucide-react';
import { api } from '@/lib/api';
import type { Analytics } from '@/lib/api/types';
import { useMedia, useQuery, prefetchQuery } from '@/lib/hooks';
import type { Scope } from '@/lib/api/client';
import { useWorkspace } from '@/lib/session';
import { useCommands } from '@/lib/commands';
import { AskButton } from '@/lib/ask';
import { Card, CountUp, ErrorState, Page, PageHeader, Segmented, Skeleton, cx, listItem, listStagger } from '@/components/ui';

type Days = 7 | 30 | 90;

/** Warmed on hover of the Analytics nav link (components/shell/prefetch.ts). */
export const prefetch = (s: Scope) => prefetchQuery(`analytics:${s.workspaceId}:30`, () => api.analytics(s, 30));

export default function AnalyticsPage() {
  const { scope, tz, role, can } = useWorkspace();
  const [days, setDays] = useState<Days>(30);
  useCommands(([7, 30, 90] as Days[]).filter((d) => d !== days).map((d) => ({ id: `d${d}`, label: `Show the last ${d} days`, run: () => setDays(d) })));
  const a = useQuery(() => api.analytics(scope, days), [scope.workspaceId, days], { key: `analytics:${scope.workspaceId}:${days}` });
  const credits = useQuery(() => api.credits(scope), [scope.workspaceId], { enabled: role !== 'client_viewer' });
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const d = a.data;
  const client = role === 'client_viewer';

  return (
    <Page>
      <PageHeader title={client ? 'Results' : 'Analytics'} subtitle={`Counted from sends, replies and meetings in this workspace. Days in ${tz.replace('_', ' ')}.`}
        actions={<><Segmented id="days" label="Period" value={String(days) as '7' | '30' | '90'} onChange={(v) => setDays(Number(v) as Days)}
          options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
          <AskButton about={{ kind: 'analytics', id: String(days), label: `the last ${days} days of results` }} /></>} />
      <ErrorState error={a.error} onRetry={a.reload} />
      {a.loading || !d ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}<Skeleton className="h-72 rounded-xl sm:col-span-2 lg:col-span-5" /></div>
      ) : (
        <motion.div key={days} variants={listStagger} initial="hidden" animate="show" className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
            <Tile icon={Send} label="Sent" value={d.totals.sent} />
            <Tile icon={MessageSquareReply} label="Replies" value={d.totals.replies} rate={d.rates.replyRate} rateLabel="of sent" />
            <Tile icon={Sparkles} label="Positive" value={d.totals.positive} rate={d.rates.positiveRate} rateLabel="of sent" />
            <Tile icon={CalendarCheck2} label="Meetings" value={d.totals.meetings} onClick={() => nav('../meetings')} />
            {!client && <Tile icon={CheckCheck} label="Approval rate" value={d.rates.approvalRate} pct sub={`${d.approvals.approved} approved · ${d.approvals.rejected} rejected`} />}
          </div>

          <motion.div variants={listItem}><Card className="p-5"><Chart data={d} /></Card></motion.div>

          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <motion.div variants={listItem}>
              <Card className="overflow-hidden">
                <h2 className="px-5 pt-4 pb-2 text-base font-semibold">Replies by sequence step</h2>
                {d.byStep.length ? (
                  <table className="w-full text-sm">
                    <thead className="bg-sunken text-left text-xs text-muted"><tr><th className="px-5 py-2 font-medium">Step</th><th className="px-3 py-2 text-right font-medium">Sent</th><th className="px-3 py-2 text-right font-medium">Replied</th><th className="px-5 py-2 font-medium">Reply rate</th></tr></thead>
                    <tbody>
                      {d.byStep.map((s) => (
                        <tr key={s.step} className="border-t border-line">
                          <td className="px-5 py-2.5">{s.step === 0 ? '1 · first touch' : `${s.step + 1} · follow-up`}</td>
                          <td className="tabular px-3 text-right">{s.sent}</td><td className="tabular px-3 text-right">{s.replied}</td>
                          <td className="px-5"><div className="flex items-center justify-end gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken max-sm:hidden"><motion.div className="h-full rounded-full bg-chart-1" initial={reduce ? false : { width: 0 }} animate={{ width: `${Math.min(100, s.replyRate ?? 0)}%` }} transition={{ duration: 0.7 }} /></div>
                            <span className="tabular w-12 text-right">{s.replyRate === null ? '—' : `${s.replyRate}%`}</span></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : <p className="px-5 pb-5 text-sm text-muted">Nothing sent in this period yet.</p>}
              </Card>
            </motion.div>
            {!client && can('team_view') && (
              <motion.div variants={listItem}>
                <Card className="p-5">
                  <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><Coins className="size-4" aria-hidden />Credits</h2>
                  {credits.data ? (
                    <dl className="space-y-2.5 text-sm">
                      {(['action', 'data', 'media'] as const).map((k) => (
                        <div key={k} className="flex items-baseline justify-between"><dt className="text-muted">{k === 'action' ? 'Action (AI jobs)' : k === 'data' ? 'Data (lookups)' : 'Media'}</dt>
                          <dd><CountUp value={credits.data!.balances[k] ?? 0} className="font-semibold" /></dd></div>
                      ))}
                    </dl>
                  ) : <Skeleton className="h-20" />}
                </Card>
              </motion.div>
            )}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted"><Info className="size-3.5" aria-hidden />Measured by replies and meetings only. No tracking is added to your email.</p>
        </motion.div>
      )}
    </Page>
  );
}

function Tile({ icon: Icon, label, value, rate, rateLabel, pct, sub, onClick }: { icon: typeof Send; label: string; value: number | null; rate?: number | null; rateLabel?: string; pct?: boolean; sub?: string; onClick?: () => void }) {
  const Tag = onClick ? motion.button : motion.div;
  return (
    <Tag variants={listItem} onClick={onClick} className={cx('card flex flex-col p-4 text-left', onClick && 'lift')}>
      <span className="flex items-center gap-2 text-sm text-muted"><Icon className="size-4" aria-hidden />{label}</span>
      <span className="mt-2 text-2xl font-semibold">{value === null ? '—' : <CountUp value={value} format={(n) => (pct ? `${n.toFixed(1)}%` : Math.round(n).toLocaleString('en-US'))} />}</span>
      <span className="mt-0.5 text-xs text-muted">
        {value === null ? 'nothing decided yet' : sub ?? (rate !== undefined ? (rate === null ? 'nothing sent yet' : `${rate}% ${rateLabel}`) : ' ')}
      </span>
    </Tag>
  );
}

const SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--chart-1)' },
  { key: 'replies', label: 'Replies', color: 'var(--chart-3)' },
  { key: 'meetings', label: 'Meetings', color: 'var(--chart-5)' },
] as const;

function Chart({ data }: { data: Analytics }) {
  const [hover, setHover] = useState<number | null>(null);
  const reduce = useReducedMotion();
  const narrow = useMedia('(max-width: 639px)');
  const W = narrow ? 440 : 1000; const H = narrow ? 260 : 240; const P = { l: 30, r: 10, t: 12, b: 28 };
  const max = Math.max(4, ...data.daily.map((d) => Math.max(d.sent, d.replies, d.meetings)));
  const step = Math.ceil(max / 4);
  const top = step * 4;
  const xs = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, data.daily.length - 1);
  const ys = (v: number) => P.t + (H - P.t - P.b) * (1 - v / top);
  const paths = useMemo(() => SERIES.map((s) => {
    const pts = data.daily.map((d, i) => [xs(i), ys(d[s.key])] as const);
    // Catmull-Rom → cubic Bézier, control points clamped to the baseline so a smooth curve never dips below zero.
    const floor = ys(0);
    const c = (v: number) => Math.min(floor, v).toFixed(1);
    const line = pts.map(([x, y], i) => {
      if (!i) return `M${x.toFixed(1)},${y.toFixed(1)}`;
      const [x0, y0] = pts[Math.max(0, i - 2)]; const [x1, y1] = pts[i - 1]; const [x3, y3] = pts[Math.min(pts.length - 1, i + 1)];
      return `C${(x1 + (x - x0) / 6).toFixed(1)},${c(y1 + (y - y0) / 6)} ${(x - (x3 - x1) / 6).toFixed(1)},${c(y - (y3 - y1) / 6)} ${x.toFixed(1)},${y.toFixed(1)}`;
    }).join('');
    return { ...s, line, area: `${line}L${xs(data.daily.length - 1)},${ys(0)}L${xs(0)},${ys(0)}Z` };
  }), [data, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelEvery = Math.ceil(data.daily.length / (narrow ? 4 : 8));
  const h = hover !== null ? data.daily[hover] : null;
  return (
    <figure>
      <figcaption className="mb-3 flex flex-wrap items-center gap-4">
        <h2 className="mr-auto text-base font-semibold">Daily activity</h2>
        {SERIES.map((s) => <span key={s.key} className="flex items-center gap-1.5 text-sm"><span aria-hidden className="h-2.5 w-4 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-pan-y" role="img" aria-label={`Daily sent, replies and meetings over ${data.days} days`}
          onPointerLeave={() => setHover(null)} onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(data.daily.length - 1, Math.round(((x - P.l) / (W - P.l - P.r)) * (data.daily.length - 1)))));
          }}>
          <defs>{SERIES.map((s) => <linearGradient key={s.key} id={`g-${s.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity={0.18} /><stop offset="1" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
          {[0, 1, 2, 3, 4].map((i) => (<g key={i}><line x1={P.l} x2={W - P.r} y1={ys(i * step)} y2={ys(i * step)} stroke="var(--border)" />
            <text x={P.l - 8} y={ys(i * step) + 4} textAnchor="end" fontSize="12" fill="var(--text-muted)">{i * step}</text></g>))}
          {data.daily.map((d, i) => i % labelEvery === 0 && (
            <text key={d.day} x={xs(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--text-muted)">{new Date(`${d.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</text>))}
          {paths.map((p) => <motion.path key={`a${p.key}`} d={p.area} fill={`url(#g-${p.key})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />)}
          {paths.map((p, i) => <motion.path key={p.key} d={p.line} fill="none" stroke={p.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, delay: i * 0.12, ease: [0.2, 0.8, 0.2, 1] }} />)}
          {hover !== null && (<g>
            <line x1={xs(hover)} x2={xs(hover)} y1={P.t} y2={H - P.b} stroke="var(--border-control)" strokeDasharray="3 3" />
            {SERIES.map((s) => <circle key={s.key} cx={xs(hover)} cy={ys(data.daily[hover][s.key])} r={4.5} fill="var(--surface)" stroke={s.color} strokeWidth={2.5} />)}
          </g>)}
        </svg>
        {h && (
          <div className="pointer-events-none absolute top-2 rounded-lg bg-inverse px-3 py-2 text-xs text-fg-inverse shadow-lg" style={{ left: `clamp(8px, calc(${(xs(hover!) / W) * 100}% - 70px), calc(100% - 150px))` }}>
            <p className="mb-1 font-semibold">{new Date(`${h.day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</p>
            {SERIES.map((s) => <p key={s.key} className="tabular">{s.label}: {h[s.key]}</p>)}
          </div>
        )}
      </div>
      <table className="sr-only"><caption>Daily numbers</caption><thead><tr><th>Day</th><th>Sent</th><th>Replies</th><th>Positive</th><th>Meetings</th></tr></thead>
        <tbody>{data.daily.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.sent}</td><td>{d.replies}</td><td>{d.positive}</td><td>{d.meetings}</td></tr>)}</tbody></table>
    </figure>
  );
}
