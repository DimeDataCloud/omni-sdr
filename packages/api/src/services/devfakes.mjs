// Dev-server stand-ins (dev.mjs only; server.mjs never imports this file), so the whole acceptance journey runs on a
// laptop at $0 with no network: a deterministic model that follows each prompt's rules from its inputs, and a few
// fixture websites. They prove the plumbing (credits, gate, citations, versions), not the quality of a real model:
// that is what the eval sets (packages/ai/evals) are for.
//
//   OMNI_DEV_MODEL=rules     use rulesModel() instead of the off model
//   OMNI_DEV_FIXTURES=1      fetch pages from FIXTURE_SITES instead of the network

const between = (text, tag) => {
  const m = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text);
  return m ? JSON.parse(m[1].replace(/\\u003c/g, '<')) : null;
};

export function rulesModel() {
  return {
    name: 'dev-rules',
    async generate({ system, messages, grounded }) {
      const text = messages.at(-1)?.text ?? '';
      const out = (o) => ({ text: JSON.stringify(o), model: 'dev-rules', usage: null, ...(grounded ? { sources: [{ uri: 'https://rival-one.example/', title: 'Rival One' }] } : {}) });
      if (system.startsWith('You write short cold emails')) {
        const facts = between(text, 'facts') ?? [];
        const n = Number(/write (\d+) email/.exec(text)?.[1] ?? 1);
        if (!facts.length) return out({ emails: [] });
        const first = { subject: 'A note about your front desk', body: `Hi,\n\n${facts[0].sentence} Would a short call about after-hours calls be useful?`, cites: [facts[0].id] };
        const follow = (i) => ({ subject: 'Re: A note about your front desk', body: i === 1 ? 'Bringing this back up in case it got buried. Worth a reply?' : 'Last note from me on this. Happy to share more whenever it suits.', cites: [] });
        return out({ emails: [first, ...Array.from({ length: n - 1 }, (_, i) => follow(i + 1))] });
      }
      if (system.startsWith('You help a small business describe its ideal customer')) {
        const rows = between(text, 'clients') ?? [];
        const group = (f, kind) => Object.entries(rows.reduce((m, r) => (r[f] ? { ...m, [r[f]]: [...(m[r[f]] ?? []), r.row] } : m), {}))
          .map(([value, rs]) => ({ kind, value, rows: rs }));
        return out({ name: 'Past-client profile', summary: 'Drawn from the past clients given.', traits: [...group('industry', 'industry'), ...group('title', 'title'), ...group('city', 'region')] });
      }
      if (system.startsWith('You help a small business find its direct competitors')) {
        const b = between(text, 'business') ?? {};
        const known = new Set(b.known_competitors ?? []);
        return out({ suggestions: ['rival-one.example', 'rival-two.example'].filter((d) => !known.has(d)).slice(0, 1)
          .map((d) => ({ name: d.split('.')[0].replace('-', ' '), website: `https://${d}`, reason: 'Sells after-hours phone answering to the same kind of business in the same area' })) });
      }
      if (system.startsWith('You write a battlecard')) {
        const pages = between(text, 'pages') ?? [];
        const quote = (p) => p.text.split(/(?<=[.!?])\s+/).find((s) => s.length >= 8 && s.length <= 200) ?? p.text.slice(0, 120);
        const st = (p) => ({ text: quote(p), cite: p.id, quote: quote(p) });
        return out({ targets: pages.slice(0, 1).map(st), claims: pages.slice(0, 2).map(st), pricing: pages.filter((p) => /\$\d/.test(p.text)).slice(0, 1).map(st),
          strengths: [], weaknesses: [], where_we_win: pages.slice(-1).map(st), objection_handlers: [] });
      }
      return { text: 'Model calls run on the dev rules model here; agent chat has nothing scripted.', model: 'dev-rules', usage: null };
    },
  };
}

export const FIXTURE_SITES = {
  'https://rival-one.example/': '<title>Rival One</title><h1>After-hours answering for dental offices.</h1><p>Plans start at $199 per month.</p><a href="/pricing">Pricing</a>',
  'https://rival-one.example/pricing': '<p>Starter plan: $199 per month for 200 calls.</p><p>Overage is billed per call.</p>',
  'https://rival-two.example/': '<h1>Virtual receptionists for clinics.</h1><p>Live operators answer every call.</p>',
  'https://rival-three.example/': '<h1>Answering service for home services.</h1><p>Book jobs while you work.</p>',
  'https://brightline-dental.example/': '<title>Brightline Family Dental</title><p>Family dentistry in Nashville.</p>'
    + '<a href="https://calendly.com/brightline">Book online</a><form><input type="email"><textarea></textarea></form>',
};

export async function fixtureFetch(url) {
  const key = url.endsWith('/') || /\.[a-z]+\/[a-z]/i.test(url) ? url : `${url}/`;
  const body = FIXTURE_SITES[key];
  if (!body) throw new Error('fixture: no such site');
  return { url: key, status: 200, body, truncated: false, contentType: 'text/html' };
}
