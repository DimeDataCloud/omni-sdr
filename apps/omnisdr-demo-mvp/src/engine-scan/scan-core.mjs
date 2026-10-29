// Pure scan core (no Node APIs): the caller injects get(url) (robots-aware fetch returning {ok,html,finalUrl,skipped}), the niche list and the exclude config. Used by scan.mjs and the portal Worker.
// Website: read with the engine's polite fetcher (robots respected, identified UA) and scored on the same rubric.
// Google Business Profile and social links: Google and the networks disallow automated reads, so the link is recorded and the name taken from the URL only; the brief says to add the business's own website.
import { extractSignals } from './signals.mjs';
import { scoreLead } from './score.mjs';
import { classifyNiche, normPhone, normDomain } from './util.mjs';
const SOCIAL = /(^|\.)(facebook|fb|instagram|linkedin|x|twitter|tiktok|youtube|yelp|nextdoor|pinterest)\.com$|(^|\.)fb\.me$/i;
const GBP = /(^|\.)(google\.[a-z.]+|g\.page|goo\.gl|maps\.app\.goo\.gl|business\.site)$/i;
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ');
export const kindOf = (u) => { let h; try { h = new URL(u).hostname.replace(/^www\./, ''); } catch { return 'invalid'; } return GBP.test(h) ? 'google_business_profile' : SOCIAL.test(h) ? 'social' : 'website'; };
const nameFromUrl = (u) => { try { const p = new URL(u).pathname.split('/').filter(Boolean); const seg = decodeURIComponent((p.find((x) => /^[^/]*[a-z]{3}/i.test(x) && !/^(maps|place|search|pages|profile|company|in|business)$/i.test(x)) || '').replace(/\+/g, ' ')); return seg.replace(/[-_]+/g, ' ').slice(0, 80); } catch { return ''; } };

export async function scan(url, { get: politeGet, niches, excl }) {
  const kind = kindOf(url); const brief = { url, kind, scannedAt: new Date().toISOString().slice(0, 10) };
  if (kind === 'invalid') return { ...brief, status: 'invalid_url' };
  if (kind !== 'website') {
    // Social pages are fetched only if robots allow (they almost never do); Google profiles are never fetched.
    if (kind === 'google_business_profile') return { ...brief, status: 'not_fetched', nameGuess: nameFromUrl(url), note: 'Google does not allow automated reads of Business Profiles. Add the business\'s own website link to scan it.' };
    const r = await politeGet(url);
    if (!r.ok) return { ...brief, status: 'not_fetched', nameGuess: nameFromUrl(url), note: `${new URL(url).hostname} does not allow automated reads (${r.skipped || 'blocked'}). Add the business's own website link to scan it.` };
    return { ...brief, status: 'read', title: (r.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim().slice(0, 90), note: 'Social page read for the title only; add the business website for a score.' };
  }
  const home = await politeGet(url);
  if (!home.ok) return { ...brief, status: 'not_fetched', note: `site not read (${home.skipped || 'error'})` };
  const pages = [home]; const links = [...home.html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  for (const kindRe of [/contact/i, /about/i]) {
    const href = links.find((h) => kindRe.test(h) && !/^(mailto|tel|javascript):|\.(css|js|png|jpe?g|svg|ico|woff2?)(\?|$)/i.test(h)); if (!href) continue;
    try { const u = new URL(href, home.finalUrl); if (normDomain(u.href) === normDomain(home.finalUrl)) { const p = await politeGet(u.href); if (p.ok) pages.push(p); } } catch {}
  }
  const html = pages.map((p) => p.html).join('\n'); const sig = extractSignals(html); const text = strip(html).toLowerCase();
  const title = ((home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const business = title.split(/[|\-–:]/).map((s) => s.trim()).filter(Boolean).pop() || normDomain(home.finalUrl);
  const nm = classifyNiche(title + ' ' + business, niches) || classifyNiche(text.slice(0, 1500), niches);
  const phone = sig.phones[0] || ''; const zip = sig.zips[0] || '';
  const lead = { business, niche: nm?.name || '', package: nm?.package || 'both', nicheCount: 1, phone, phoneConfirmed: !!normPhone(phone), zip, zipVerified: !!zip, website: home.finalUrl,
    provenance: [{ source: 'business_website', url: home.finalUrl, date: brief.scannedAt, fields: ['phone', 'signals'] }], signals: sig, nicheInName: !!nm && new RegExp(niches.find((n) => n.name === nm.name)?.kw || '$^', 'i').test(business), nicheOnSite: nm ? new RegExp(niches.find((n) => n.name === nm.name).kw, 'i').test(text) : false };
  const r = scoreLead(lead, excl); r.gates = r.gates.filter((g) => g !== 'zip_unverified'); r.solid = r.gates.length === 0;
  return { ...brief, status: 'read', business, niche: lead.niche || null, phone: phone || null, zip: zip || null, emails: sig.emails, score: r.score, gates: r.gates, solid: r.solid, why: r.why, tags: { multiLocation: lead.multiLocation || null, missedCallProxy: lead.missedCallProxy, soleProprietorHint: lead.soleProprietorHint }, evidence: { siteTitle: title, pagesRead: pages.map((p) => p.finalUrl), hasBooking: sig.bookingTool, hasChat: sig.chatWidget, answeringService: sig.answeringService, afterHours: sig.afterHoursClaim, estimateRequests: sig.freeEstimate }, note: 'Score is the sourcing rubric; confirm the phone is a business line and scrub it yourself before dialing. The state check (NJ/TN only) is not applied to a single scan.' };
}
