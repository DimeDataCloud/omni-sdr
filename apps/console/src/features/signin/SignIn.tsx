// G5: the screens before a workspace exists, for the real API only (the demo never shows them).
//   SignInPage   email → a one-time link (Identity Platform email-link sign-in)
//   FinishPage   the link lands here; asks for the email again only on another device
//   Onboarding   signed in with no org: owner or agency (POST /v1/orgs). An invite link skips this.
//   InvitePage   /invite/:token, signed in → POST /v1/invites/accept
// Every message here is plain text; nothing from a URL is rendered as HTML.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MailCheck } from 'lucide-react';
import { Banner, Button, Field, Input, Segmented } from '@/components/ui';
import { finish, linkParams, pendingEmail, sendLink, SignInError } from '@/lib/auth';
import { account } from '@/lib/api/http';
import { ApiError } from '@/lib/api';

const msg = (e: unknown) => e instanceof SignInError || e instanceof ApiError ? e.message : 'Something went wrong. Try again.';

function Frame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="ambient grid min-h-dvh place-items-center px-4 py-10">
      <main className="card w-full max-w-sm p-6" aria-labelledby="signin-h">
        <img src="/logo-mark-small.svg" alt="" width={32} height={32} className="mb-4" />
        <h1 id="signin-h" className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </main>
    </div>
  );
}

const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export function SignInPage({ next = '/' }: { next?: string }) {
  const [email, setEmail] = useState(pendingEmail() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const submit = async () => {
    if (!validEmail(email)) { setErr('Enter a valid email address.'); return; }
    setBusy(true); setErr(null);
    try { await sendLink(email.trim(), next); setSent(email.trim()); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <Frame title="Check your email" subtitle={<>We sent a sign-in link to <span className="font-medium text-ink">{sent}</span>. It works once and expires in an hour.</>}>
        <p className="flex items-center gap-2 text-sm text-muted"><MailCheck className="size-4" aria-hidden />Open it on this device to sign straight in.</p>
        <Button variant="ghost" className="mt-4" onClick={() => setSent(null)}>Use a different email</Button>
      </Frame>
    );
  }
  return (
    <Frame title="Sign in to Omni-SDR" subtitle="We’ll email you a one-time link. No password.">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
        <Field label="Work email" error={err}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} type="email" autoComplete="email" inputMode="email"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus maxLength={254} placeholder="you@company.com" />}</Field>
        <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy}>Email me a link</Button>
      </form>
      <p className="mt-4 text-sm text-muted"><a className="underline" href="/?demo=1">Explore the demo</a> instead.</p>
    </Frame>
  );
}

export function FinishPage({ onDone }: { onDone: (next: string) => void }) {
  const params = useRef(linkParams(window.location.href)).current;
  // The one-time code stays out of the address bar, history and any later page view once it's been read.
  useEffect(() => { if (params) window.history.replaceState(null, '', window.location.pathname); }, [params]);
  const [email, setEmail] = useState(pendingEmail() ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tried = useRef(false);
  const go = async (address: string) => {
    if (!params) return;
    setBusy(true); setErr(null);
    try { await finish(address.trim(), params.oobCode); onDone(params.next); } catch (e) { setErr(msg(e)); setBusy(false); }
  };
  // Same device: the email is remembered, so the link signs in without a question.
  useEffect(() => { if (params && pendingEmail() && !tried.current) { tried.current = true; void go(pendingEmail()!); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!params) return <SignInPage />;
  if (busy && !err) return <Frame title="Signing you in…"><p className="text-sm text-muted">One moment.</p></Frame>;
  return (
    <Frame title="Confirm your email" subtitle="You opened the link on a different device or browser. Type the address it was sent to.">
      <form onSubmit={(e) => { e.preventDefault(); if (validEmail(email)) void go(email); else setErr('Enter a valid email address.'); }} noValidate>
        <Field label="Email" error={err}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid} type="email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} autoFocus maxLength={254} />}</Field>
        <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy}>Sign in</Button>
      </form>
      {err && <p className="mt-3 text-sm"><a className="underline" href="/">Ask for a new link</a></p>}
    </Frame>
  );
}

export function Onboarding({ email, onCreated }: { email: string; onCreated: () => void }) {
  const [type, setType] = useState<'owner' | 'agency'>('owner');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (!name.trim()) { setErr('Name your business.'); return; }
    setBusy(true); setErr(null);
    try { await account.createOrg({ orgName: name.trim(), accountType: type }); onCreated(); } catch (e) { setErr(msg(e)); setBusy(false); }
  };
  return (
    <Frame title="Set up your account" subtitle={<>Signed in as <span className="font-medium text-ink">{email}</span>. Joining a team? Open the invite link you were sent.</>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate className="space-y-4">
        <Segmented id="account-type" label="Account type" value={type} onChange={setType}
          options={[{ value: 'owner', label: 'My business' }, { value: 'agency', label: 'An agency' }]} />
        <p className="text-sm text-muted">{type === 'owner' ? 'One business, one workspace.' : 'A workspace per client, with your team and your clients invited by role.'}</p>
        <Field label={type === 'owner' ? 'Business name' : 'Agency name'} error={err}>{(p) => <Input id={p.id} aria-describedby={p.describedBy} aria-invalid={p.invalid}
          value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />}</Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Create account</Button>
      </form>
    </Frame>
  );
}

export function InvitePage({ token, onAccepted }: { token: string; onAccepted: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return; once.current = true;
    account.acceptInvite(token).then(onAccepted, (e) => setErr(e instanceof ApiError && e.status === 403
      ? 'This invite is for a different email address, or it was already used.' : msg(e)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!err) return <Frame title="Joining…"><p className="text-sm text-muted">Accepting your invite.</p></Frame>;
  return (
    <Frame title="Couldn’t accept the invite">
      <Banner tone="warning" title={err} role="alert" />
      <p className="mt-4 text-sm text-muted">Ask whoever invited you for a new link, or <a className="underline" href="/">continue</a>.</p>
    </Frame>
  );
}
