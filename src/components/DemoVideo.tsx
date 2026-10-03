'use client';

// The waitlist page's "See Omni in Action": a ~36 s motion demo of the MVP flow, drawn in code (no video file to host,
// sharp at any size). Every scene shows something the product does; the data is illustrative, and the player says so.
// It plays when on screen, pauses when off it, and loops. With reduced motion it doesn't autoplay and nothing moves
// (MotionConfig reducedMotion="user" drops transforms; only short fades remain): the chapters become a step-through.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useInView, useReducedMotion } from 'motion/react';
import { Pause, Play, RotateCcw } from 'lucide-react';

const INK = '#1A1A1A';
const GREEN = '#A3FFB4';      // fill only, always with INK text on it
const ACCENT_INK = '#1F6B3A'; // dark green for text and icons on sand/white (≥ 4.5:1)
const SAND = '#F7F5F0';
const LINE = '#E8E4D9';

const ease = [0.22, 1, 0.36, 1] as const;

type Scene = { id: string; chapter: string; caption: string; ms: number; render: () => React.ReactNode };

// ── small pieces ─────────────────────────────────────────────────────────────────────────────────────────────────────
function Chip({ children, tone = 'plain', delay = 0 }: { children: React.ReactNode; tone?: 'plain' | 'green' | 'warn' | 'bad'; delay?: number }) {
  const styles = {
    plain: { background: '#FFFFFF', color: INK, border: `1px solid ${LINE}` },
    green: { background: GREEN, color: INK, border: '1px solid transparent' },
    warn: { background: '#FFF1C7', color: '#5C4300', border: '1px solid #F2DE9C' },
    bad: { background: '#FDE2E0', color: '#7A1C14', border: '1px solid #F5C2BD' },
  }[tone];
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay, duration: 0.35, ease }}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={styles}
    >
      {children}
    </motion.span>
  );
}

function Typed({ text, delay = 0, speed = 0.035 }: { text: string; delay?: number; speed?: number }) {
  return (
    <span aria-label={text}>
      {text.split('').map((ch, i) => (
        <motion.span key={i} aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: delay + i * speed, duration: 0.01 }}>
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full w-full flex flex-col">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#6B675E' }}>{title}</div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

const rowIn = (i: number, base = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { delay: base + i * 0.18, duration: 0.4, ease },
});

// ── scenes ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function SceneIcp() {
  const rows = ['Brightline Family Dental · Owner · Nashville', 'Harbor Pediatric Dentistry · Office manager · Franklin', 'Music Row Smiles · Owner · Nashville', 'Sylvan Park Dental · Owner · Nashville'];
  return (
    <Panel title="Ideal customer, from your past clients">
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-3 h-full content-start">
        <div className="sm:col-span-3 rounded-xl p-2 space-y-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
          <div className="text-[10px] font-semibold" style={{ color: '#6B675E' }}>past-clients.csv · 12 rows</div>
          {rows.map((r, i) => (
            <motion.div key={r} {...rowIn(i)} className="flex items-center gap-2 text-[11px] rounded-md px-2 py-1" style={{ background: SAND, color: INK }}>
              <span className="font-mono text-[9px]" style={{ color: '#6B675E' }}>{i + 1}</span>
              <span className="truncate">{r}</span>
            </motion.div>
          ))}
        </div>
        <div className="sm:col-span-2 grid grid-cols-3 sm:flex sm:flex-col gap-2">
          {[
            ['Industry', 'Dental practices', 'rows 1–4'],
            ['Title', 'Owner', 'rows 1, 3, 4'],
            ['Region', 'Nashville area', 'rows 1–4'],
          ].map(([k, v, cite], i) => (
            <motion.div key={k} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.1 + i * 0.35, duration: 0.45, ease }}
              className="rounded-xl p-2" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
              <div className="text-[9px] uppercase tracking-wide font-semibold" style={{ color: '#6B675E' }}>{k}</div>
              <div className="text-[12px] font-semibold" style={{ color: INK }}>{v}</div>
              <div className="mt-1"><Chip delay={1.4 + i * 0.35}>{cite}</Chip></div>
            </motion.div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function SceneFind() {
  const leads = [
    ['Belmont Family Dentistry', 92, 'Books online via Calendly'],
    ['East Nashville Smiles', 88, 'Contact form on homepage'],
    ['Germantown Dental Studio', 85, 'Phone link, no online booking seen'],
    ['Twelve South Dental', 81, 'Books online via Zocdoc'],
  ] as const;
  return (
    <Panel title="Find leads">
      <div className="rounded-xl px-3 py-2 mb-2 text-[12px] flex items-center gap-2" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}>
        <span style={{ color: '#6B675E' }}>⌕</span>
        <Typed text="Find 50 dental practices in Nashville" />
      </div>
      <div className="space-y-1.5">
        {leads.map(([name, fit, ev], i) => (
          <motion.div key={name} {...rowIn(i, 1.5)} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold truncate" style={{ color: INK }}>{name}</div>
              <div className="text-[10px] truncate" style={{ color: ACCENT_INK }}>Evidence: {ev}</div>
            </div>
            <div className="w-20">
              <div className="text-[9px] text-right font-semibold" style={{ color: '#6B675E' }}>fit {fit}</div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
                <motion.div className="h-full rounded-full" style={{ background: GREEN, border: `1px solid ${ACCENT_INK}` }}
                  initial={{ width: 0 }} animate={{ width: `${fit}%` }} transition={{ delay: 1.7 + i * 0.18, duration: 0.6, ease }} />
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

function SceneVerify() {
  const rows = [
    ['dr.patel@belmontfamilydentistry.example', 'green', '✓ Verified'],
    ['frontdesk@eastnashvillesmiles.example', 'warn', 'Risky · role inbox'],
    ['hello@germantowndental.example', 'warn', 'Risky · catch-all'],
    ['amy.lee@twelvesouthdental.example', 'green', '✓ Verified'],
    ['info@oldpractice.example', 'bad', 'Invalid · no mailbox'],
  ] as const;
  return (
    <Panel title="Every address checked before anything sends">
      <div className="space-y-1.5">
        {rows.map(([email, tone, label], i) => (
          <motion.div key={email} {...rowIn(i)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
            <span className="font-mono text-[10px] truncate" style={{ color: INK }}>{email}</span>
            <Chip tone={tone} delay={0.9 + i * 0.3}>{label}</Chip>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.8 }} className="mt-2 text-[10px] font-semibold" style={{ color: ACCENT_INK }}>
        Only verified addresses can be sent to.
      </motion.div>
    </Panel>
  );
}

function SceneDraft() {
  return (
    <Panel title="Drafts that cite their facts">
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-3 h-full content-start">
        <div className="sm:col-span-3 rounded-xl p-3 text-[11px] leading-relaxed" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}>
          <div className="text-[10px] mb-1" style={{ color: '#6B675E' }}>To: Dr. Patel · Step 1 of 3</div>
          <div className="font-semibold mb-1">Quick question about after-hours calls</div>
          <p>
            Hi Dr. Patel, <motion.mark initial={{ backgroundColor: 'rgba(163,255,180,0)' }} animate={{ backgroundColor: 'rgba(163,255,180,1)' }}
              transition={{ delay: 1.2, duration: 0.5 }} style={{ color: INK, padding: '0 2px', borderRadius: 3 }}>
              I saw your homepage lets patients book online through Calendly.
            </motion.mark>{' '}
            Would a 15-minute call next week about the calls that come in after hours be useful?
          </p>
          <div className="mt-2"><Chip delay={1.6}>Evidence · their homepage</Chip></div>
        </div>
        <div className="sm:col-span-2 rounded-xl p-2 space-y-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
          <div className="text-[10px] font-semibold" style={{ color: '#6B675E' }}>Safety gate</div>
          {['Every claim cites a fact', 'No invented numbers', 'No unsupported superlatives', 'Unsubscribe link included'].map((t, i) => (
            <motion.div key={t} {...rowIn(i, 2.0)} className="flex items-center gap-1.5 text-[10px]" style={{ color: INK }}>
              <span className="inline-flex items-center justify-center rounded-full w-3.5 h-3.5 text-[8px] font-bold" style={{ background: GREEN, color: INK }}>✓</span>{t}
            </motion.div>
          ))}
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 3.0, duration: 0.4 }}
            className="mt-1 text-center rounded-md py-1 text-[10px] font-bold" style={{ background: INK, color: GREEN }}>
            Passed · ready for review
          </motion.div>
        </div>
      </div>
    </Panel>
  );
}

function SceneApprove() {
  return (
    <Panel title="You approve every message">
      <div className="relative h-full flex items-center justify-center">
        {[2, 1].map((k) => (
          <div key={k} className="absolute rounded-2xl w-[62%] h-[78%]" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, transform: `translateY(${k * 7}px) scale(${1 - k * 0.04})`, opacity: 0.7 }} />
        ))}
        <motion.div className="relative rounded-2xl w-[62%] h-[78%] p-3 text-[11px] shadow-md" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}
          initial={{ x: 0, rotate: 0 }} animate={{ x: ['0%', '0%', '130%'], rotate: [0, 0, 12], opacity: [1, 1, 0] }}
          transition={{ duration: 3.2, times: [0, 0.55, 1], ease: 'easeInOut', delay: 0.4 }}>
          <div className="text-[10px]" style={{ color: '#6B675E' }}>Dr. Patel · Belmont Family Dentistry</div>
          <div className="font-semibold my-1">Quick question about after-hours calls</div>
          <div className="text-[10px] leading-snug" style={{ color: '#3D3A35' }}>I saw your homepage lets patients book online through Calendly…</div>
          <div className="mt-2 flex gap-1"><Chip>Gate: passed</Chip><Chip>fit 92</Chip></div>
          <motion.div initial={{ opacity: 0, scale: 1.4, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: -12 }} transition={{ delay: 1.6, duration: 0.35 }}
            className="absolute bottom-3 right-3 rounded-md px-2 py-0.5 text-[11px] font-black uppercase" style={{ background: GREEN, color: INK, border: `2px solid ${INK}` }}>
            Approved
          </motion.div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.4 }}
          className="absolute bottom-0 text-[10px] font-semibold" style={{ color: ACCENT_INK }}>
          Nothing sends without you · inside your send window and daily cap
        </motion.div>
      </div>
    </Panel>
  );
}

function SceneInbox() {
  const steps = [
    ['Sent from you@yourpractice.com', 'plain'],
    ['Reply: “Could we talk Tuesday afternoon?”', 'plain'],
    ['Sorted: meeting request · you’re alerted', 'green'],
    ['Meeting booked · sequence stopped', 'green'],
  ] as const;
  return (
    <Panel title="Your Gmail, your replies, sorted">
      <div className="space-y-2">
        {steps.map(([t, tone], i) => (
          <motion.div key={t} {...rowIn(i, 0.2 + i * 0.45)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium"
            style={tone === 'green' ? { background: GREEN, color: INK } : { background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}>
            <span className="inline-flex w-4 h-4 items-center justify-center rounded-full text-[9px] font-bold" style={{ background: INK, color: GREEN }}>{i + 1}</span>
            {t}
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }} className="text-[10px] font-semibold" style={{ color: ACCENT_INK }}>
          No open tracking, ever. Opt-outs are honored automatically.
        </motion.div>
      </div>
    </Panel>
  );
}

function SceneEnd({ onCta }: { onCta?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="text-[20px] font-semibold" style={{ color: INK }}>
        Find the right businesses. Reach them with facts.
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-[12px]" style={{ color: '#4A463F' }}>
        You stay in control of every message.
      </motion.div>
      {onCta && (
        <motion.button type="button" onClick={(e) => { e.stopPropagation(); onCta(); }}
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8, duration: 0.4 }}
          className="rounded-full px-5 py-2 text-[12px] font-bold uppercase tracking-wide focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: GREEN, color: INK, outlineColor: ACCENT_INK }}>
          Join the waitlist
        </motion.button>
      )}
    </div>
  );
}

// ── player ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function DemoVideo({ onCta }: { onCta?: () => void }) {
  const scenes: Scene[] = [
    { id: 'icp', chapter: 'Learn', ms: 6000, caption: 'Omni learns who you sell to from your past clients. Every trait cites the rows behind it.', render: () => <SceneIcp /> },
    { id: 'find', chapter: 'Find', ms: 6500, caption: 'It finds businesses that fit and reads each one’s own website for evidence.', render: () => <SceneFind /> },
    { id: 'verify', chapter: 'Verify', ms: 5500, caption: 'Every address is checked first. Only verified addresses can be sent to.', render: () => <SceneVerify /> },
    { id: 'draft', chapter: 'Write', ms: 6500, caption: 'Drafts cite what they say, and a safety gate blocks anything it can’t back up.', render: () => <SceneDraft /> },
    { id: 'approve', chapter: 'Approve', ms: 5500, caption: 'You approve every message before it goes out.', render: () => <SceneApprove /> },
    { id: 'inbox', chapter: 'Reply', ms: 5500, caption: 'It sends from your own Gmail, sorts the replies, and stops the sequence when a meeting is booked.', render: () => <SceneInbox /> },
    { id: 'end', chapter: 'Join', ms: 5000, caption: 'Join the waitlist for early access.', render: () => <SceneEnd onCta={onCta} /> },
  ];

  const reduced = useReducedMotion();
  const frameRef = useRef<HTMLDivElement>(null);
  const inView = useInView(frameRef, { amount: 0.5 });
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const [userPaused, setUserPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);   // ms into the current scene
  const [cycle, setCycle] = useState(0);       // remounts a scene when it is replayed

  const active = playing && inView && !userPaused && !reduced;
  const scene = scenes[index];

  const go = useCallback((i: number) => { setIndex(((i % scenes.length) + scenes.length) % scenes.length); setElapsed(0); setCycle((c) => c + 1); }, [scenes.length]);

  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      setElapsed((e) => {
        const next = e + dt;
        if (next >= scene.ms) { go(index + 1); return 0; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, index, scene.ms, go]);

  const toggle = () => { if (reduced) { go(index + 1); return; } setUserPaused((p) => !p); setPlaying(true); };
  const total = scenes.reduce((s, x) => s + x.ms, 0);
  const done = scenes.slice(0, index).reduce((s, x) => s + x.ms, 0) + Math.min(elapsed, scene.ms);

  return (
    <MotionConfig reducedMotion="user">
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <div ref={frameRef} role="region" aria-roledescription="animated demo" aria-label="Omni SDR product demo"
        className="relative w-full rounded-2xl overflow-hidden aspect-[3/4] sm:aspect-[16/10]"
        style={{ background: SAND, border: `1px solid ${LINE}`, boxShadow: '0 8px 32px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderBottom: `1px solid ${LINE}`, background: 'rgba(255,255,255,0.7)' }}>
          {['#E8E4D9', '#E8E4D9', '#E8E4D9'].map((c, i) => <span key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />)}
          <span className="ml-2 text-[10px] font-semibold whitespace-nowrap" style={{ color: '#6B675E' }}>Omni SDR · {scene.chapter}</span>
          <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap" style={{ color: '#8A857B' }}>Illustrative<span className="hidden sm:inline"> data</span></span>
        </div>
        <div className="absolute inset-x-0 bottom-0 top-[33px] p-3 md:p-4 text-left">
          <AnimatePresence mode="wait">
            <motion.div key={`${scene.id}-${cycle}`} className="h-full"
              initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -12 }}
              transition={{ duration: 0.45, ease }}>
              {scene.render()}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-[2.5rem] text-sm font-medium text-center" style={{ color: '#3D3A35' }}>{scene.caption}</p>

      <div className="mt-2 flex items-center gap-2 sm:gap-3">
        <button type="button" onClick={toggle} aria-label={reduced ? 'Next step' : active ? 'Pause demo' : 'Play demo'}
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: INK, color: GREEN, outlineColor: ACCENT_INK }}>
          {reduced ? <Play size={14} /> : active ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="flex-1 min-w-0 flex gap-1" role="tablist" aria-label="Demo chapters">
          {scenes.map((s, i) => {
            const fill = i < index ? 1 : i === index ? Math.min(elapsed / s.ms, 1) : 0;
            return (
              <button key={s.id} type="button" role="tab" aria-selected={i === index} aria-label={`Chapter ${i + 1}: ${s.chapter}`}
                onClick={() => go(i)} className="group flex-1 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 rounded" style={{ outlineColor: ACCENT_INK, flexGrow: s.ms }}>
                <span className="block h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
                  <span className="block h-full" style={{ width: `${(reduced ? (i <= index ? 1 : 0) : fill) * 100}%`, background: INK }} />
                </span>
                <span className="hidden sm:block mt-1 text-[9px] font-semibold uppercase tracking-wide text-center" style={{ color: i === index ? INK : '#8A857B' }}>{s.chapter}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => { go(0); setUserPaused(false); }} aria-label="Restart demo"
          className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ background: '#FFFFFF', color: INK, border: `1px solid ${LINE}`, outlineColor: ACCENT_INK }}>
          <RotateCcw size={14} />
        </button>
      </div>
      <span className="sr-only">{`${Math.round(done / 1000)} of ${Math.round(total / 1000)} seconds`}</span>
    </div>
    </MotionConfig>
  );
}
