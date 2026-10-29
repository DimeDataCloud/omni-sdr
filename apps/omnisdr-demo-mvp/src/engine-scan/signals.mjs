// Pure: turn a business's own homepage/contact/about text into the signals the rubric scores. No I/O.
import { normPhone } from './util.mjs';
const has = (re, t) => re.test(t);
export function extractSignals(html, ctx = {}) {
  const raw = String(html || '');
  const t = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;/g, ' ').replace(/\s+/g, ' ');
  const low = t.toLowerCase(); const rawLow = raw.toLowerCase();
  const phones = new Set();
  for (const m of raw.matchAll(/tel:\+?1?[\s\-.(]*(\d{3})[\s\-.)]*(\d{3})[\s\-.]*(\d{4})/gi)) { const p = normPhone(m[1] + m[2] + m[3]); if (p) phones.add(p); }
  for (const m of t.matchAll(/\(?\b(\d{3})\)?[\s.\-]\s?(\d{3})[\s.\-](\d{4})\b/g)) { const p = normPhone(m[1] + m[2] + m[3]); if (p) phones.add(p); }
  const emails = [...new Set([...raw.matchAll(/mailto:([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))];
  const zips = new Set([...t.matchAll(/\b(?:TN|NJ|Tennessee|New Jersey)[ ,]+(\d{5})\b/g)].map((m) => m[1]));
  const team = low.match(/(?:team of|over|more than)\s+(\d{1,3})\+?\s+(?:technicians|employees|professionals|experts|team members|plumbers|electricians|installers)/);
  const sinceM = low.match(/(?:since|established|est\.?)\s+((?:19|20)\d\d)/);
  return {
    phones: [...phones],
    emails,
    zips: [...zips],
    bookingTool: has(/calendly|housecall ?pro|jobber|servicetitan|schedule ?engine|setmore|acuity|booksy|simplybook|book (?:online|now|an appointment)|schedule (?:online|service|an appointment)|online scheduling|request an appointment/, rawLow + ' ' + low),
    chatWidget: has(/tidio|intercom|drift\.com|livechat|podium|birdeye|tawk\.to|crisp\.chat|hs-scripts|chatra|olark|zendesk|live chat/, rawLow),
    answeringService: has(/answering service|call cent(?:er|re)|live operator|virtual receptionist|ai receptionist|smith\.ai|ruby receptionists|goodcall|we answer (?:every|all) call/, low),
    afterHoursClaim: has(/24\s?\/\s?7|24[- ]hour|after[- ]hours|emergency service|emergency calls|same[- ]day/, low),
    freeEstimate: has(/free estimate|free quote|request a (?:free )?quote|get a (?:free )?quote/, low),
    contactForm: has(/<form[^>]*>/i, raw),
    franchise: has(/franchis(?:e|ee|ees|ing)\b|independently owned and operated|each location is independently/, low),
    // Group or parent language (a subsidiary page: "Our Companies", "a Phalcon USA company"). Gate, not tag: the lead is not an independent.
    group: has(/\bour companies\b|family of (?:companies|brands)|portfolio of (?:companies|brands)|\bpart of the [\w&' -]{3,40} (?:group|companies|brands)\b/, low),
    multiLocation: has(/our locations|\d+\s+locations|offices in|branches|nationwide|serving (?:\d+|multiple|several) states|locations across/, low),
    locationCount: (() => { const m = [...low.matchAll(/(?<![\d.\-)])\b(\d{1,3})\+?\s+(?:locations|offices|branches|stores|showrooms)/g)].map((x) => +x[1]).filter((n) => n >= 2 && n <= 500); return m.length ? Math.max(...m) : null; })(),
    teamSize: team ? +team[1] : null,
    familyOwned: has(/family[- ]owned|locally owned|owner[- ]operated|owned and operated/, low),
    since: sinceM ? +sinceM[1] : null,
    // Growth signal (tag only, never scored): the business advertises open roles on its own site.
    hiring: has(/now hiring|we(?:'|’)re hiring|we are hiring|join our team|careers?\b|employment opportunities|apply (?:now|today)|help wanted/, low) || has(/href=["'][^"']*(?:careers?|join-our-team|employment|hiring|jobs)\b/, rawLow),
    // Tag only: three or more state names/abbreviations listed together (e.g. serving TN, AL, GA and KY).
    multiState: /(?:[^a-z]|^)(?:tn|nj|al|ga|ky|pa|ny|nc|va|ms|ar|mo|oh|in|fl|sc|md|de|ct)(?:[ ,]+(?:and )?)(?:tn|nj|al|ga|ky|pa|ny|nc|va|ms|ar|mo|oh|in|fl|sc|md|de|ct)(?:[ ,]+(?:and )?)(?:tn|nj|al|ga|ky|pa|ny|nc|va|ms|ar|mo|oh|in|fl|sc|md|de|ct)(?:[^a-z]|$)/.test(low),
    textLen: t.length,
    closed: has(/permanently closed|no longer in business|out of business/, low),
  };
}
