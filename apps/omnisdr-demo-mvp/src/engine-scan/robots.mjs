// Pure robots.txt parsing (no Node APIs), shared by the engine and the portal Worker.
export function parseRobots(txt) {
  const groups = []; let cur = null;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const m = line.match(/^([a-z\-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', p: v });
  }
  return groups;
}
export function robotsAllows(groups, pathname) {
  const pick = groups.find((g) => g.agents.some((a) => a !== '*' && 'omnisdr-research'.includes(a))) || groups.find((g) => g.agents.includes('*'));
  if (!pick) return true;
  let best = null;
  for (const r of pick.rules) {
    if (r.p === '') continue;
    const re = new RegExp('^' + r.p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathname) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}
