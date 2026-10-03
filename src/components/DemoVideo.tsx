'use client';

// The waitlist page's "See Omni in Action": a ~35 s motion demo of the inbound flow (SDR-PIVOT P8), drawn in code (no video file to host,
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
// The inbound story (SDR-PIVOT P8): Omni is the buffer between the first touch and the real closer. Everyone and every
// business here is fictional; addresses are on reserved .example domains.
function SceneArrive() {
  const msgs = [
    ['Website form', 'Lena O.', 'Can someone call me about whitening tomorrow?', 'live'],
    ['Email reply', 'Marcus H.', 'What does this cost per month?', 'live'],
    ['LinkedIn (pasted)', 'Dana B.', 'Saw your post. Do you work with two-chair practices?', 'live'],
    ['Instagram', '@sunny.smiles', 'how much is a cleaning?? 😬', 'soon'],
    ['Facebook', 'Priya K.', 'Are you taking new patients?', 'soon'],
  ] as const;
  return (
    <Panel title="Every message, one inbox">
      <div className="space-y-1.5">
        {msgs.map(([ch, who, text, state], i) => (
          <motion.div key={ch} {...rowIn(i, 0.2)} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
            <div className="w-28 shrink-0">
              <div className="text-[10px] font-semibold truncate" style={{ color: ACCENT_INK }}>{ch}</div>
              <div className="text-[10px] truncate" style={{ color: '#6B675E' }}>{who}</div>
            </div>
            <div className="flex-1 min-w-0 text-[11px] truncate" style={{ color: INK }}>{text}</div>
            {state === 'soon' && <Chip delay={0.4 + i * 0.18}>coming soon</Chip>}
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="mt-2 text-[10px] font-semibold" style={{ color: ACCENT_INK }}>
        Each person gets one thread, whatever channel they used.
      </motion.div>
    </Panel>
  );
}

function SceneSort() {
  const rows = [
    ['Can someone call me about whitening tomorrow?', 'green', 'Meeting request · 2h to answer'],
    ['What does this cost per month?', 'plain', 'Question'],
    ['Do you work with two-chair practices?', 'plain', 'Question'],
    ['Please take me off your list.', 'bad', 'Opt-out · suppressed, never answered'],
  ] as const;
  return (
    <Panel title="Sorted by what each person needs">
      <div className="space-y-1.5">
        {rows.map(([text, tone, label], i) => (
          <motion.div key={text} {...rowIn(i)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
            <span className="text-[11px] truncate" style={{ color: INK }}>{text}</span>
            <Chip tone={tone} delay={0.9 + i * 0.3}>{label}</Chip>
          </motion.div>
        ))}
      </div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }} className="mt-2 text-[10px] font-semibold" style={{ color: ACCENT_INK }}>
        Anything it isn’t sure about goes to a person.
      </motion.div>
    </Panel>
  );
}

function SceneAnswer() {
  return (
    <Panel title="Answered in your words">
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-3 h-full content-start">
        <div className="sm:col-span-2 rounded-xl p-2 text-[10px] leading-snug" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: '#4A463F' }}>
          <div className="font-semibold mb-1" style={{ color: '#6B675E' }}>Your playbook · Question</div>
          Good question, {'{first_name}'}. Pricing is a flat monthly fee with no setup cost.
          <div className="mt-1"><Chip delay={0.6}>+ next qualifying question</Chip></div>
        </div>
        <div className="sm:col-span-3 relative rounded-xl p-3 text-[11px] leading-relaxed" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}>
          <div className="text-[10px] mb-1" style={{ color: '#6B675E' }}>Reply to Marcus · email</div>
          <p>
            Good question, <motion.mark initial={{ backgroundColor: 'rgba(163,255,180,0)' }} animate={{ backgroundColor: 'rgba(163,255,180,1)' }}
              transition={{ delay: 1.0, duration: 0.5 }} style={{ color: INK, padding: '0 2px', borderRadius: 3 }}>Marcus</motion.mark>. Pricing is a flat monthly fee with no setup cost.
          </p>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="mt-1">When are you hoping to get started?</motion.p>
          <div className="mt-2 flex justify-end">
            <motion.span initial={{ opacity: 0, scale: 1.4, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ delay: 2.6, duration: 0.35 }}
              className="rounded-md px-2 py-0.5 text-[11px] font-black uppercase" style={{ background: GREEN, color: INK, border: `2px solid ${INK}` }}>
              Approved by you
            </motion.span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function SceneQualify() {
  const qs = [
    ['When are you hoping to start?', 'This month'],
    ['How many chairs?', 'Two'],
    ['Anyone else in the decision?', 'Just me'],
  ] as const;
  return (
    <Panel title="Qualified, one question at a time">
      <div className="space-y-2">
        {qs.map(([q, a], i) => (
          <motion.div key={q} {...rowIn(i, 0.2 + i * 0.4)} className="rounded-lg px-3 py-2" style={{ background: '#FFFFFF', border: `1px solid ${LINE}` }}>
            <div className="text-[10px]" style={{ color: '#6B675E' }}>{q}</div>
            <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: INK }}>
              {a}<span className="inline-flex items-center justify-center rounded-full w-3.5 h-3.5 text-[8px] font-bold" style={{ background: GREEN, color: INK }}>✓</span>
            </div>
          </motion.div>
        ))}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 2.4, duration: 0.4 }}
          className="text-center rounded-md py-1 text-[10px] font-bold" style={{ background: INK, color: GREEN }}>
          Qualified · ready for a person
        </motion.div>
      </div>
    </Panel>
  );
}

function SceneHandoff() {
  return (
    <Panel title="Handed to your closer">
      <div className="relative h-full flex items-start justify-center pt-1">
        <motion.div className="relative rounded-2xl w-full sm:w-[78%] p-3 text-[11px] shadow-md" style={{ background: '#FFFFFF', border: `1px solid ${LINE}`, color: INK }}
          initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.5, ease }}>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-[12px]">Marcus Hale</span>
            <Chip tone="green" delay={0.4}>Wants a meeting</Chip>
            <Chip tone="warn" delay={0.6}>Accept within 2h</Chip>
          </div>
          <div className="text-[10px] mt-0.5" style={{ color: '#6B675E' }}>Harbor Pediatric Dentistry · via email</div>
          <div className="mt-2 text-[10px] leading-snug" style={{ color: '#3D3A35' }}>
            Asked about pricing; starting this month; two chairs; decides alone.
          </div>
          <motion.div {...rowIn(0, 1.2)} className="mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-1 text-[10px]" style={{ background: SAND }}>
            <span className="truncate">cal.example/your-closer</span><span className="font-semibold whitespace-nowrap" style={{ color: ACCENT_INK }}>Copy booking link</span>
          </motion.div>
          <div className="mt-2 flex justify-end">
            <motion.span initial={{ opacity: 0, scale: 1.4, rotate: -8 }} animate={{ opacity: 1, scale: 1, rotate: -8 }} transition={{ delay: 2.4, duration: 0.35 }}
              className="rounded-md px-2 py-0.5 text-[11px] font-black uppercase" style={{ background: GREEN, color: INK, border: `2px solid ${INK}` }}>
              Accepted
            </motion.span>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.0 }}
          className="absolute bottom-0 text-[10px] font-semibold text-center" style={{ color: ACCENT_INK }}>
          Your closer sees the summary, the answers and the whole thread, and nothing else.
        </motion.div>
      </div>
    </Panel>
  );
}

function SceneEnd({ onCta }: { onCta?: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-3">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} className="text-[20px] font-semibold" style={{ color: INK }}>
        Every message answered. Every good lead handed off.
      </motion.div>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="text-[12px]" style={{ color: '#4A463F' }}>
        Omni is the buffer between your first touch and your closer.
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
    { id: 'arrive', chapter: 'Arrive', ms: 6000, caption: 'Messages from your website, email and LinkedIn land in one inbox. Instagram and Facebook are coming.', render: () => <SceneArrive /> },
    { id: 'sort', chapter: 'Sort', ms: 5500, caption: 'Each one is sorted by what the person needs. Opt-outs are honored and never answered.', render: () => <SceneSort /> },
    { id: 'answer', chapter: 'Answer', ms: 6500, caption: 'Replies come from your own playbook, filled in for each person, and you approve them.', render: () => <SceneAnswer /> },
    { id: 'qualify', chapter: 'Qualify', ms: 5500, caption: 'Omni asks your qualifying questions, one at a time.', render: () => <SceneQualify /> },
    { id: 'handoff', chapter: 'Hand off', ms: 6500, caption: 'Qualified people go to your closer with a summary, their answers and your booking link.', render: () => <SceneHandoff /> },
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
