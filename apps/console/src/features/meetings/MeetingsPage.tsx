// Meetings (DESIGN 6.6): upcoming grouped by day; past meetings take their outcome in one tap.
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { CalendarDays, Video, CheckCircle2, UserX, Ban, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import type { Meeting } from '@/lib/api/types';
import { useNow, useQuery, prefetchQuery } from '@/lib/hooks';
import type { Scope } from '@/lib/api/client';
import { useWorkspace } from '@/lib/session';
import { useCommands } from '@/lib/commands';
import { AskButton } from '@/lib/ask';
import { clock, dayKey, dayLabel, fmtDur } from '@/lib/format';
import { Badge, Button, EmptyState, ErrorState, Page, PageHeader, Segmented, SkeletonList, cx, listItem, listStagger } from '@/components/ui';

const PROVIDER: Record<Meeting['provider'], string> = { native: 'Booked here', calendly: 'Calendly', cal_com: 'Cal.com' };
const STATUS: Record<Meeting['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  booked: { label: 'Booked', tone: 'info' }, completed: { label: 'Completed', tone: 'success' }, no_show: { label: 'No-show', tone: 'warning' }, canceled: { label: 'Canceled', tone: 'neutral' },
};

/** Warmed on hover of the Meetings nav link. */
export const prefetch = (s: Scope) => prefetchQuery(`meetings:${s.workspaceId}:upcoming`, () => api.meetings(s, 'upcoming'));

export default function MeetingsPage() {
  const { scope, tz, can } = useWorkspace();
  const [range, setRange] = useState<'upcoming' | 'past'>('upcoming');
  useCommands([range === 'upcoming' ? { id: 'range', label: 'Show past meetings', run: () => setRange('past') } : { id: 'range', label: 'Show upcoming meetings', run: () => setRange('upcoming') }]);
  const q = useQuery(() => api.meetings(scope, range), [scope.workspaceId, range], { key: `meetings:${scope.workspaceId}:${range}` });
  const now = useNow();
  const groups = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const x of q.data ?? []) { const k = dayKey(x.startsAt, tz); m.set(k, [...(m.get(k) ?? []), x]); }
    return [...m.entries()];
  }, [q.data, tz]);
  const todayKey = dayKey(new Date(now).toISOString(), tz);
  const setOutcome = async (m: Meeting, status: Meeting['status']) => {
    try { await api.patchMeeting(scope, m.id, { status }); toast.success(`Marked ${STATUS[status].label.toLowerCase()}. Analytics updated.`); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <Page>
      <PageHeader title="Meetings" subtitle={`Times in ${tz.replace('_', ' ')}.`}>
        <div className="w-full"><Segmented id="mt" label="Range" value={range} onChange={setRange} options={[{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} /></div>
      </PageHeader>
      <ErrorState error={q.error} onRetry={q.reload} />
      {q.loading ? <SkeletonList rows={4} /> : !groups.length ? (
        <EmptyState icon={<CalendarDays className="size-5" aria-hidden />} title={range === 'upcoming' ? 'No meetings coming up' : 'No past meetings'}
          body={range === 'upcoming' ? 'Book from a reply in the Inbox, or connect Calendly or Cal.com and bookings appear here.' : 'Finished meetings show here with their outcome.'} />
      ) : (
        <motion.div variants={listStagger} initial="hidden" animate="show" className="space-y-6">
          {groups.map(([k, ms]) => (
            <motion.section key={k} variants={listItem} aria-label={dayLabel(ms[0].startsAt, tz)}>
              <h2 className="section-title mb-2">{k === todayKey ? 'Today' : dayLabel(ms[0].startsAt, tz)}</h2>
              <ul className="space-y-2">
                {ms.map((m) => {
                  const mins = (new Date(m.startsAt).getTime() - now) / 60000;
                  const soon = range === 'upcoming' && mins > 0 && mins < 60 * 3;
                  return (
                    <li key={m.id} className={cx('card flex flex-wrap items-center gap-4 p-4', soon && 'ring-2 ring-ink/30')}>
                      <div className="w-24 shrink-0 whitespace-nowrap">
                        <p className="tabular text-lg font-semibold">{clock(m.startsAt, tz)}</p>
                        <p className="text-xs text-muted">{fmtDur((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60000)}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{m.contactName ?? 'Unknown contact'}</p>
                        <p className="truncate text-sm text-muted">{m.contactCompany}{soon && ` · starts in ${fmtDur(mins)}`}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{PROVIDER[m.provider]}</Badge>
                        <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                        {range === 'upcoming' && <AskButton about={{ kind: 'meeting', id: m.id, label: `the meeting with ${m.contactName ?? 'this contact'}` }} keys={false} label="Prep" />}
                        {m.meetUrl && m.status === 'booked' && range === 'upcoming' && (
                          <a href={m.meetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-control bg-surface px-3 text-sm font-medium hover:bg-sunken max-md:h-11">
                            <Video className="size-4" aria-hidden />Join<ExternalLink className="size-3 text-muted" aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>
                        )}
                      </div>
                      {range === 'past' && can('inbox_draft') && (
                        <div className="flex w-full flex-wrap gap-2 border-t border-line pt-3" role="group" aria-label="Outcome">
                          <Button size="sm" variant={m.status === 'completed' ? 'primary' : 'secondary'} icon={<CheckCircle2 className="size-4" aria-hidden />} onClick={() => setOutcome(m, 'completed')}>Completed</Button>
                          <Button size="sm" variant={m.status === 'no_show' ? 'primary' : 'secondary'} icon={<UserX className="size-4" aria-hidden />} onClick={() => setOutcome(m, 'no_show')}>No-show</Button>
                          <Button size="sm" variant={m.status === 'canceled' ? 'primary' : 'secondary'} icon={<Ban className="size-4" aria-hidden />} onClick={() => setOutcome(m, 'canceled')}>Canceled</Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </motion.section>
          ))}
        </motion.div>
      )}
    </Page>
  );
}
