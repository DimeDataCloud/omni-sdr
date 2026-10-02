// Facts from one homepage, deterministically (no model): the same HTML always gives the same facts.
// Each fact carries `text`, the one sentence a draft may use to cite it, so a claim says exactly what was observed
// and nothing stronger (the gate checks numbers; meaning is pinned here). Absence is stated as "on the homepage",
// never as "you don't offer", because a booking page can live elsewhere.

// Online booking and scheduling vendors, by the hostnames their widgets and links load from.
export const BOOKING_VENDORS = Object.freeze({
  'calendly.com': 'Calendly', 'zocdoc.com': 'Zocdoc', 'nexhealth.com': 'NexHealth', 'localmed.com': 'LocalMed',
  'opencare.com': 'Opencare', 'flexbook.me': 'Flex', 'patientpop.com': 'PatientPop', 'solutionreach.com': 'Solutionreach',
  'lighthouse360.com': 'Lighthouse 360', 'getweave.com': 'Weave', 'acuityscheduling.com': 'Acuity', 'squareup.com/appointments': 'Square Appointments',
  'setmore.com': 'Setmore', 'vagaro.com': 'Vagaro', 'mindbodyonline.com': 'Mindbody', 'booksy.com': 'Booksy', 'cal.com': 'Cal.com',
  'youcanbook.me': 'YouCanBookMe', 'simplybook.me': 'SimplyBook.me', 'schedulicity.com': 'Schedulicity', 'housecallpro.com': 'Housecall Pro',
  'servicetitan.com': 'ServiceTitan', 'jobber.com': 'Jobber', 'tebra.com': 'Tebra', 'modento.io': 'Modento', 'yapi.com': 'YAPI',
});
const BOOK_WORDS = /\b(book (an |your )?(appointment|online|now|a visit)|schedule (an |your )?(appointment|online|a visit)|request (an )?appointment)\b/i;

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function extractFacts(html, finalUrl) {
  const h = String(html ?? '');
  const lower = h.toLowerCase();
  const url = new URL(finalUrl);
  const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h) ?? [])[1] ?? '').slice(0, 200) || null;

  const hrefs = [...h.matchAll(/\b(?:href|src|action|data-url)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const vendorHit = Object.entries(BOOKING_VENDORS).find(([host]) => hrefs.some((x) => x.toLowerCase().includes(host)) || lower.includes(`//${host}`));
  const anchors = [...h.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1]));
  const bookLink = anchors.find((t) => BOOK_WORDS.test(t)) ?? null;
  const online = Boolean(vendorHit);

  const forms = [...h.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => m[0]);
  const contactForm = forms.some((f) => /type\s*=\s*["']?email|<textarea/i.test(f));
  const telLink = /href\s*=\s*["']tel:/i.test(h);

  return {
    site: { url: url.href, https: url.protocol === 'https:', title,
      text: url.protocol === 'https:' ? null : `Your homepage loads without HTTPS (${url.host}).` },
    booking: {
      online, vendor: vendorHit ? vendorHit[1] : null, book_link_text: bookLink,
      text: online ? `Your homepage offers online booking through ${vendorHit[1]}.`
        : bookLink ? `Your homepage has a "${bookLink.slice(0, 60)}" link but no online booking widget.`
          : 'Your homepage has no online booking.',
    },
    contact: { form: contactForm, phone_link: telLink,
      text: contactForm ? 'Your homepage has a contact form.' : 'Your homepage has no contact form.' },
  };
}
