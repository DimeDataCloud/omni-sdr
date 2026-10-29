// Pure: the approved rubric (35/25/20/10/10) and the solid-lead gates. Fixed before run 1; do not tune to hit a count.
import { normPhone, isChain, looksNonTrade } from './util.mjs';
export const WEIGHTS = Object.freeze({ icp: 35, independence: 25, openness: 20, reach: 10, confidence: 10 });
export const SOLID_MIN = 60;
const NICHE_WORDS = 'plumb|heat|cool|air|hvac|electric|roof|paint|landscap|lawn|tree|pool|floor|fenc|deck|siding|gutter|window|garage|lock|tow|well|remodel|construct|builder|service|repair|contract';

export function scoreLead(l, excl) {
  const s = l.signals || null; const why = []; const gates = []; const pts = {};
  const siteRead = !!(s && s.textLen > 200);

  // ICP and niche fit (35)
  let icp = 0;
  // A niche inferred only from a general-contractor licence is a weak fit (18 of 25); fixed here before run 1.
  if (l.niche) { icp += l.nicheWeak ? 18 : 25; why.push(`niche ${l.niche}${l.nicheWeak ? ' (general licence only)' : ''}`); } else gates.push('no_niche');
  if (l.package === 'voice' && s?.afterHoursClaim) { icp += 7; why.push('after-hours demand claimed'); }
  if (l.package === 'followup' && (s?.freeEstimate || s?.contactForm)) { icp += 7; why.push('takes estimate requests'); }
  if (l.nicheCount === 1) icp += 3;
  pts.icp = Math.min(icp, WEIGHTS.icp);

  // Independence and size (25). Size is an estimate from public signals, never a headcount.
  let ind = siteRead ? 18 : 15; let sizeEst = 'unknown';
  if (isChain(l.business, excl)) { gates.push('chain'); ind = 0; }
  if (s?.franchise) { ind -= 20; gates.push('franchise_language'); }
  // Multi-location is tagged, never penalised: the agency package covers it (Christian, 2026-10-28). Franchise language still gates.
  const branchName = /\b(office|branch|division|region(al)?|district|headquarters)\b/i.test(l.business);
  if (s?.multiLocation || s?.multiState || s?.locationCount > 1 || l.locationEvidence?.addresses > 1 || branchName) {
    l.multiLocation = l.locationEvidence?.addresses > 1 ? `multi-location (${l.locationEvidence.addresses} addresses on own site)` : s?.locationCount > 1 ? `multi-location (site says ${s.locationCount})` : s?.multiLocation ? 'likely multi-location (site language)' : 'likely multi-location (branch-style name)';
    if (s?.multiState) l.multiLocation = (l.multiLocation ? l.multiLocation + '; ' : 'multi-location: ') + 'serves 3+ states, large regional firm (tag only)';
    why.push(l.multiLocation);
  }
  l.growthSignal = s?.hiring ? 'growth signal (hiring on own site)' : '';
  if (s?.teamSize) {
    sizeEst = s.teamSize > 25 ? `large (~${s.teamSize}+)` : s.teamSize > 10 ? `mid (~${s.teamSize})` : `small (~${s.teamSize})`;
    if (s.teamSize > 25) ind -= 15; else if (s.teamSize > 10) ind -= 5;
  }
  if (s?.familyOwned) { ind = Math.max(ind, 25) - 0; if (sizeEst === 'unknown') sizeEst = 'small (owner-operated language)'; why.push('owner-operated language'); }
  pts.independence = Math.max(0, Math.min(ind, WEIGHTS.independence)); l.sizeEstimate = sizeEst;

  // Not overworked = not already covered (gate). The missed-call proxy is a separate flag, not scored.
  let open = siteRead ? 20 : 12;
  if (s?.bookingTool) { open -= 8; why.push('has online booking'); }
  if (s?.chatWidget) { open -= 6; why.push('has chat widget'); }
  if (s?.answeringService) { gates.push('already_covered'); open = 0; }
  if (siteRead && !s.bookingTool && !s.chatWidget && !s.answeringService) why.push('no booking, chat or answering service seen');
  pts.openness = Math.max(0, open);
  l.missedCallProxy = !!(siteRead && !s.bookingTool && !s.chatWidget && !s.answeringService && (s.afterHoursClaim || l.package === 'voice'));

  // Reachability (10)
  let reach = 0;
  if (normPhone(l.phone)) reach += 4; else gates.push('no_phone');
  if (normPhone(l.phone) && l.phoneConfirmed) reach += 4; else if (normPhone(l.phone)) gates.push('phone_unconfirmed');
  if (siteRead) reach += 2;
  pts.reach = reach;

  // Data confidence (10)
  let conf = 0;
  if (l.zipVerified) conf += 5; else gates.push('zip_unverified');
  if ((l.provenance || []).some((p) => p.source === 'business_website')) conf += 3;
  if (new Set((l.provenance || []).map((p) => p.source)).size >= 2) conf += 2;
  pts.confidence = conf;

  if (looksNonTrade(l.business, excl) && !l.niche) gates.push('not_a_trade');
  // Supply houses and key kiosks carry a trade category but are not owner-run service businesses (Ferguson and KeyMe passed in b006).
  // Public bodies, clubs and marine towing are not the owner-run trade businesses the packages sell to (Teaneck Swim Club, Ingram Marine passed in c001).
  if (/\.(gov|edu)(\/|$)/i.test(l.website || '') || /\b(club|association|township|borough|city of|county of|marine|barge)\b/i.test(l.business)) gates.push('not_a_trade');
  if (/\b(supply|supplies|wholesale|distribut\w*|warehouse|kiosk)\b/i.test(l.business)) gates.push('supplier');
  // Audit of 395 loaded leads (2026-10-29) found a union local, a day care, a sewerage authority, engineering firms and a tech/investment company carrying a trade category.
  if ((excl.nonTradeNamePatterns || []).some((p) => new RegExp(p, 'i').test(l.business || '')) || l.siteNonTrade) gates.push('not_a_trade');
  // A site that is part of a group, or that now belongs to another business (domain redirect, name and phone gone), is not the independent we sourced.
  if (s?.group) gates.push('part_of_group');
  if (l.identityMismatch) gates.push('identity_mismatch');
  if (s?.closed || l.closed) gates.push('closed');
  // Own-site checks (false-positive filters, not score changes): a site that never mentions the niche, or a parked page.
  if (siteRead && l.nicheOnSite === false) gates.push('niche_unconfirmed');
  // A thin or script-only site cannot confirm the niche: then the name must say it, or two non-website sources must agree (a 718 HVAC "corp" with a bare logo page passed before this).
  const nonSiteSources = new Set((l.provenance || []).filter((p) => p.source !== 'business_website').map((p) => p.source)).size;
  if (s && s.textLen < 600 && l.nicheOnSite !== true && !l.nicheInName && nonSiteSources < 2) gates.push('niche_unconfirmed');
  if (l.parkedSite) gates.push('parked_site');
  const area = String(l.phone || '').replace(/\D/g, '').replace(/^1/, '').slice(0, 3);
  const home = { TN: ['615', '629', '931', '423', '865', '901', '731'], NJ: ['201', '551', '908', '973', '862', '732', '848', '609', '856', '640'] }[/^(37|38)/.test(l.zip || '') ? 'TN' : 'NJ'];
  // Owner-name business with no trade word in the name: the listed number is the likeliest personal line. Tag only.
  l.soleProprietorHint = /^[A-Z][a-z]+(?: [A-Z]\.?)? [A-Z][a-z'-]+(?:,? (?:LLC|Inc\.?|Co\.?))?$/.test(String(l.business || '').trim()) && !new RegExp(NICHE_WORDS, 'i').test(l.business);
  l.outOfAreaPhone = area && !home.includes(area) ? area : '';  const score = Math.round(Object.values(pts).reduce((a, b) => a + b, 0));
  if (score < SOLID_MIN) gates.push(`score_below_${SOLID_MIN}`);
  return { score, pts, why, gates, solid: gates.length === 0 };
}
