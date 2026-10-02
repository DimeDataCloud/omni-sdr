// What one business's own homepage tells us about it, for a found lead: a company name, an address to write to, and
// the text the fit score reads. Deterministic, no model. Evidence facts come from packages/enrich (extractFacts).
import { freeEmailChecks } from './catalog.mjs';

const strip = (s) => String(s ?? '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** mailto: addresses on the business's own domain; a named inbox before a role one (info@, office@). */
export function emailOn(html, host) {
  if (!host) return null;
  const found = [...String(html ?? '').matchAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)]
    .map((m) => { try { return decodeURIComponent(m[1]).trim().toLowerCase(); } catch { return null; } })
    .filter((e) => e && (e.endsWith(`@${host}`) || e.endsWith(`.${host}`)))
    .map((e) => freeEmailChecks(e)).filter((c) => c.status !== 'invalid');
  const pick = found.find((c) => !c.role) ?? found[0];
  return pick ? { email: pick.email, status: pick.status, role: pick.role } : null;
}

/** The name the site gives itself: the first part of its <title>, else its domain. */
export function companyFrom(title, host) {
  const t = String(title ?? '').split(/\s[|–—-]\s|\s·\s/)[0].trim().slice(0, 120);
  return t || host;
}

/** The words of the page the fit score reads (title, headings, first paragraphs), capped. */
export function siteText(html) {
  const h = String(html ?? '');
  const parts = [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i]
    .map((re) => strip((re.exec(h) ?? [])[1]));
  return [...parts, strip(h).slice(0, 2000)].join(' ').slice(0, 3000);
}

/** Run fn over items, at most `n` at a time, stopping new work once `deadline` (ms epoch) has passed. */
export async function pool(items, n, deadline, fn) {
  const out = new Array(items.length).fill(undefined);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      if (Date.now() > deadline) { out[k] = { late: true }; continue; }
      out[k] = await fn(items[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
