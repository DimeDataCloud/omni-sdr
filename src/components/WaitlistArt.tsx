// The waitlist page's own artwork, drawn as SVG: the Omni funnel mark, the hero's inbound-thread illustration and the
// small icons the form uses. The hero's one idea: three inbound messages pour into the funnel, every one is answered,
// and the good lead leaves the spout as a single pipe that the page carries down into the form and the demo.
// No JS animation: the CSS in waitlist.module.css plays it on first paint, before hydration, and reduced motion shows
// the end state. The messages are illustrative and match the ones in DemoVideo.
import React, { useId } from 'react';
import s from './waitlist.module.css';

const svgId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');

// Christian's funnel mark at top-bar size: the same geometry and heavier stroke as public/logo-mark-small.svg.
export function FunnelMark({ className }: { className?: string }) {
  const id = svgId(useId());
  return (
    <svg className={className} viewBox="96 88 320 344" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#E4FFEA" />
          <stop offset="1" stopColor="#A3FFB4" />
        </linearGradient>
        <radialGradient id={`${id}m`} cx="0.5" cy="0.6" r="0.6">
          <stop offset="0" stopColor="#A3FFB4" />
          <stop offset="1" stopColor="#FFFFFF" />
        </radialGradient>
      </defs>
      <path d="M123 142 L232 300 L232 408 L290 362 L290 300 L389 142 Z" fill={`url(#${id}c)`} stroke="#1A1A1A" strokeWidth="22" strokeLinejoin="round" />
      <ellipse cx="256" cy="138" rx="133" ry="36" fill={`url(#${id}m)`} stroke="#1A1A1A" strokeWidth="22" />
    </svg>
  );
}

const MESSAGES = [
  { channel: 'Email', text: 'What does this cost per month?', done: 'Answered' },
  { channel: 'Web form', text: 'Can someone call me about whitening tomorrow?', done: 'Meeting request', good: true },
  { channel: 'LinkedIn', text: 'Do you work with two-chair practices?', done: 'Answered' },
];
// The art is 720 units wide. Line i leaves the bottom of chip i (centres at 1/6, 1/2 and 5/6 of the width, which is
// where the 3-column chip grid puts them) and drops into the funnel mouth. The spout ends at the bottom edge, 27 units
// wide outside its strokes, and the page's pipe (3.75cqw of the same 720-unit container) carries on from there.
const STARTS = [120, 360, 600];
const LINES = ['M120 0 C120 40 318 30 322 70', 'M360 0 L360 70', 'M600 0 C600 40 402 30 398 70'];

export function InboundThread() {
  const id = svgId(useId());
  const at = (i: number) => ({ '--i': i }) as React.CSSProperties;
  return (
    <div className={s.thread} role="img"
      aria-label="Messages from email, a website form and LinkedIn pour into Omni. Each one is answered, and the qualified lead is handed to your closer.">
      <ol className={s.chips}>
        {MESSAGES.map((m, i) => (
          <li key={m.channel} className={s.cell} style={at(i)}>
            <div className={m.good ? `${s.chip} ${s.chipGood}` : s.chip}>
              <div className={s.chipTop}>
                <span className={s.channel}>{m.channel}</span>
                <span className={s.status}>
                  <span className={s.statusNew} />
                  <span className={s.statusDone}><TickIcon className={s.tick} /><span className={s.statusText}>{m.done}</span></span>
                </span>
              </div>
              <p className={s.msg}>{m.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <svg className={s.art} viewBox="0 0 720 176" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${id}c`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="0.55" stopColor="#E4FFEA" />
            <stop offset="1" stopColor="#A3FFB4" />
          </linearGradient>
          <radialGradient id={`${id}m`} cx="0.5" cy="0.6" r="0.6">
            <stop offset="0" stopColor="#A3FFB4" />
            <stop offset="1" stopColor="#FFFFFF" />
          </radialGradient>
        </defs>
        {/* mouth, back rim, the lines pouring in, then the cone and front rim drawn over them */}
        <ellipse cx="360" cy="70" rx="84" ry="18" fill="#FFFFFF" />
        <ellipse className={s.mouthGlow} cx="360" cy="70" rx="84" ry="18" fill={`url(#${id}m)`} />
        <path className={s.rim} d="M276 70 A84 18 0 0 1 444 70" />
        {LINES.map((d, i) => <path key={d} className={i === 1 ? `${s.line} ${s.lineGood}` : s.line} d={d} pathLength={1} style={at(i)} />)}
        {LINES.map((d, i) => <circle key={d} className={i === 1 ? `${s.drop} ${s.dropGood}` : s.drop} r="4.5" style={{ ...at(i), offsetPath: `path('${d}')` }} />)}
        {STARTS.map((x, i) => <circle key={x} className={s.port} cx={x} cy="0" r="4" style={at(i)} />)}
        <path d="M276 70 A84 18 0 0 0 444 70 L372 146 L372 176 L348 176 L348 146 Z" fill={`url(#${id}c)`} />
        <path className={s.rim} d="M276 70 A84 18 0 0 0 444 70 M276 70 L348 146 L348 176 M372 176 L372 146 L444 70" />
      </svg>
    </div>
  );
}

export function TickIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.6 8.3 L7 10.6 L11.4 5.8" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Drawn when it appears: the check's stroke runs from 0 to 1 (pathLength) in the CSS.
export function CheckBadge({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="11" />
      <path d="M7 12.4 L10.5 15.8 L17 8.6" pathLength={1} />
    </svg>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10 H15.5 M11 5.5 L15.5 10 L11 14.5" />
    </svg>
  );
}

export function OwnerIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="6.75" r="3.25" />
      <path d="M3.75 17 C4.4 13.6 6.9 11.75 10 11.75 C13.1 11.75 15.6 13.6 16.25 17" />
    </svg>
  );
}

export function AgencyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 17 V5.5 L10 3 V17 M10 7.5 L16.5 9.5 V17 M2.5 17 H17.5 M6 8 V8.01 M6 11 V11.01 M6 14 V14.01 M13.25 12 V12.01 M13.25 14.5 V14.51" />
    </svg>
  );
}
