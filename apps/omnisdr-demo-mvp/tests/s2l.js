// Speed-to-lead simulation: the real cadence module behind /api/lead/plan and /api/lead/reply. Run against a local worker (BASE).
import { isFederalHoliday, DEFAULT_RULES } from '../src/text-cadence.mjs';
const BASE = process.env.BASE || 'http://localhost:8787';
let fail = 0;
const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' ' + (d || ''))); };
const post = async (u, b) => { const r = await fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() }; };

const W = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (d, tz) => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23', minute: 'numeric' }).formatToParts(d).forEach((x) => { p[x.type] = x.value; }); return { wd: W.indexOf(p.weekday), hr: Number(p.hour), mi: Number(p.minute) }; };
// next time (at least 2 hours from now, within 9 days) whose wall clock in tz is the given weekday (null = Mon to Fri) and hour
const find = (tz, wd, hr) => { let t = new Date(Math.ceil((Date.now() + 7200000) / 900000) * 900000); for (let i = 0; i < 9 * 96; i++, t = new Date(t.getTime() + 900000)) { const p = parts(t, tz); if (p.hr === hr && p.mi === 0 && (wd === null ? p.wd >= 1 && p.wd <= 5 : p.wd === wd)) return t; } throw new Error('no time'); };
const CT = 'America/Chicago';
const plan = (o) => post('/api/lead/plan', { tenant: 'riverbend', name: 'Dana', zone: 'central', consent: true, sent: [], flags: {}, ...o });
const iso = (d) => d.toISOString();

const wk10 = find(CT, null, 10);
let r = await plan({ requestedAt: iso(wk10), now: iso(wk10) });
ok('at the moment of the request the first text is due in 2 minutes', r.j.decision?.action === 'wait' && r.j.decision.reason === 'not_due' && new Date(r.j.decision.until) - wk10 === 120000, JSON.stringify(r.j));
r = await plan({ requestedAt: iso(wk10), now: iso(new Date(wk10.getTime() + 120000)) });
ok('2 minutes later the first text goes', r.j.decision?.action === 'send' && new Date(r.j.decision.at) - wk10 === 120000, JSON.stringify(r.j));
ok('first text names the business and carries STOP', /Riverbend Bath/.test(r.j.text || '') && /Reply STOP/.test(r.j.text || ''));

const first = new Date(r.j.decision.at);
r = await plan({ requestedAt: iso(wk10), now: iso(first), sent: [iso(first)] });
ok('after text 1 the next text waits at least 12 hours', r.j.decision?.action === 'wait' && new Date(r.j.decision.until) - first >= 12 * 3600000, JSON.stringify(r.j));
const t2 = new Date(r.j.decision.until);
const p2 = parts(t2, CT);
ok('text 2 lands inside 9 AM to 8 PM Monday to Saturday', p2.hr >= 9 && p2.hr < 20 && p2.wd !== 0, JSON.stringify(p2));

r = await plan({ requestedAt: iso(wk10), now: iso(wk10), consent: false });
ok('no consent: no text', r.j.decision?.action === 'stop' && r.j.decision.reason === 'no_consent', JSON.stringify(r.j));

const sun22 = find(CT, 0, 22);
r = await plan({ requestedAt: iso(sun22), now: iso(sun22) });
const pu = r.j.decision?.until ? parts(new Date(r.j.decision.until), CT) : {};
ok('Sunday 10 PM: first text waits for Monday 9 AM', r.j.decision?.action === 'wait' && r.j.decision.reason === 'quiet_hours' && pu.wd === 1 && pu.hr === 9, JSON.stringify(r.j));

const sun10 = find(CT, 0, 10);
r = await plan({ requestedAt: iso(sun10), now: iso(new Date(sun10.getTime() + 120000)) });
ok('Sunday 10 AM: the first reply still goes within 2 minutes', r.j.decision?.action === 'send', JSON.stringify(r.j));

const pac = find('America/Los_Angeles', null, 8);
r = await plan({ requestedAt: iso(pac), now: iso(pac), zone: 'pacific' });
ok('Pacific 8 AM: first text waits for 9 AM Pacific', r.j.decision?.action === 'wait', JSON.stringify(r.j));

const four = [0, 1, 2, 3].map((i) => iso(new Date(wk10.getTime() + i * 86400000 * 1.5)));
r = await plan({ requestedAt: iso(wk10), now: iso(new Date(wk10.getTime() + 6 * 86400000)), sent: four });
ok('four texts sent: sequence over', r.j.decision?.action === 'stop' && r.j.decision.reason === 'max_texts', JSON.stringify(r.j));

r = await plan({ requestedAt: iso(wk10), now: iso(wk10), flags: { replied: true } });
ok('replied: sequence stops', r.j.decision?.reason === 'replied');
r = await plan({ requestedAt: iso(wk10), now: iso(wk10), flags: { optedOut: true } });
ok('opted out: sequence stops', r.j.decision?.reason === 'opted_out');

r = await plan({ requestedAt: '2001-01-01T00:00:00Z', now: iso(wk10) });
ok('a simulated clock far from today is refused', r.j.ok === false);
r = await plan({ requestedAt: 'nope', now: iso(wk10) });
ok('garbage dates are refused, not a 500', r.s === 200 && r.j.ok === false);
r = await plan({ requestedAt: iso(wk10), now: iso(wk10), sent: Array(40).fill(iso(wk10)) });
ok('oversize sent list is capped', r.s === 200);

const reply = (text, extra) => post('/api/lead/reply', { tenant: 'riverbend', name: 'Dana', text, ...extra });
r = await reply('STOP');
ok('STOP: opted out by rule, with the ruled confirmation text', r.j.inbound === 'stop' && r.j.flags?.optedOut === true && /you're unsubscribed and won't get more texts\. Reply START to resubscribe\./.test(r.j.reply || ''));
r = await reply('please stop texting me');
ok('"stop texting me" counts as STOP', r.j.inbound === 'stop');
r = await reply('HELP');
ok('HELP answered by rule with contact details and rates line', r.j.inbound === 'help' && /555-0142/.test(r.j.reply || '') && /help@riverbend\.example/.test(r.j.reply || '') && /Msg & data rates may apply/.test(r.j.reply || '') && /Reply STOP/.test(r.j.reply || ''));
r = await reply('START', { wasOptedOut: true });
ok('START re-subscribes an opted-out number with the ruled wording', r.j.inbound === 'start' && r.j.flags?.optedOut === false && /subscribed again/.test(r.j.reply || '') && /Reply HELP for help, STOP to opt out/.test(r.j.reply || ''));
r = await reply('START');
ok('START is ignored when not opted out', r.j.inbound === 'start' && !r.j.flags?.optedOut);
r = await reply('Tuesday works for me');
ok('a slot reply books on the demo calendar', r.j.flags?.booked === true && /fake/.test(r.j.booking?.calendar || ''));
r = await reply('how much does it cost?');
ok('any other reply stops the sequence and hands to the assistant', r.j.flags?.replied === true && !r.j.flags?.booked && /Reply STOP/.test(r.j.reply || ''));

ok('holiday: Thanksgiving 2026', isFederalHoliday('2026-11-26'));
ok('holiday: July 3 2026 (observed)', isFederalHoliday('2026-07-03'));
ok('holiday: Dec 31 2027 (Jan 1 2028 is a Saturday)', isFederalHoliday('2027-12-31'));
ok('not a holiday: Dec 31 2026', !isFederalHoliday('2026-12-31'));
ok('rules: 4 texts, 7 days, 12 hour gap, 2 minute response', DEFAULT_RULES.maxTexts === 4 && DEFAULT_RULES.sequenceDays === 7 && DEFAULT_RULES.minGapMinutes === 720 && DEFAULT_RULES.responseWindowMinutes === 2);

console.log(fail ? 's2l: ' + fail + ' FAILED' : 's2l: all passed');
process.exit(fail ? 1 : 0);
