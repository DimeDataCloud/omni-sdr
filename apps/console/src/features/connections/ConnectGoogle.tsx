// Gmail connect, the console's half (docs/claude/SENDER-PLAN.md §2). Real API only.
//
//   startGoogleConnect(scope)   POST …/mailboxes/google/start → Google's consent page. The workspace and the state are
//                               kept in this tab's sessionStorage, because Google returns only `code` and `state`.
//   ConnectGooglePage           Google redirects to /connect/google?code=…&state=… (or ?error=…). The code leaves the
//                               address bar at once; it goes only to POST …/mailboxes/google/finish, which checks the
//                               state against this person and workspace before spending it.
//
// A state that doesn't match the one this tab started is refused here before any call: Google's redirect can be
// opened by anyone, and a code from someone else's consent must never reach this person's workspace.
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Banner, Button } from '@/components/ui';
import { Frame } from '@/features/signin/SignIn';
import { mailboxes, type Mailbox } from '@/lib/api/http';
import { ApiError, type Scope } from '@/lib/api';

export const CONNECT_PATH = '/connect/google';
const PENDING = 'omni.connect.google';

interface Pending { orgId: string; workspaceId: string; state: string }

export async function startGoogleConnect(scope: Scope) {
  const { url } = await mailboxes.startGoogle(scope);
  const u = new URL(url);
  if (u.origin !== 'https://accounts.google.com') throw new ApiError(502, 'bad_redirect', 'The connect link wasn’t Google’s. Nothing was opened.');
  const state = u.searchParams.get('state') ?? '';
  try { sessionStorage.setItem(PENDING, JSON.stringify({ orgId: scope.orgId, workspaceId: scope.workspaceId, state } satisfies Pending)); } catch { /* private mode: the page below says to start again */ }
  window.location.assign(u.href);
}

function takePending(): Pending | null {
  try {
    const raw = sessionStorage.getItem(PENDING);
    sessionStorage.removeItem(PENDING);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p.orgId === 'string' && typeof p.workspaceId === 'string' && typeof p.state === 'string' ? p : null;
  } catch { return null; }
}

/** Google's answer, read once. Plain text only; nothing from the URL is rendered except as text. */
function readRedirect() {
  const p = new URLSearchParams(window.location.search);
  return { code: p.get('code'), state: p.get('state'), error: p.get('error') };
}

const ERRORS: Record<string, string> = {
  access_denied: 'You didn’t allow sending, so nothing was connected.',
  scope_extra: 'Google granted more than send-only access, so Omni-SDR refused it. Nothing was stored.',
  scope_missing: 'Google didn’t grant permission to send, so nothing was connected.',
  wrong_user: 'This connect was started by someone else, or in another workspace.',
  expired_state: 'The connect took longer than 10 minutes. Start again.',
  bad_state: 'This connect link isn’t valid. Start again.',
  not_configured: 'Gmail connect isn’t switched on for this server yet.',
};

export function ConnectGooglePage({ signedIn }: { signedIn: boolean }) {
  const got = useRef(readRedirect()).current;
  const pending = useRef<Pending | null | undefined>(undefined);
  if (pending.current === undefined) pending.current = takePending();
  // The one-time code stays out of the address bar, history and any later page view once it's been read.
  useEffect(() => { window.history.replaceState(null, '', CONNECT_PATH); }, []);
  const [done, setDone] = useState<Mailbox | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const once = useRef(false);
  const p = pending.current;
  const back = p ? `/w/${encodeURIComponent(p.workspaceId)}/connections` : '/';

  useEffect(() => {
    if (once.current) return; once.current = true;
    if (got.error) { setErr(ERRORS[got.error] ?? 'Google didn’t connect the mailbox.'); return; }
    if (!signedIn) { setErr('Sign in, then connect Gmail again from Connections.'); return; }
    if (!got.code || !got.state || !p || p.state !== got.state) { setErr('This connect wasn’t started in this tab. Start again from Connections.'); return; }
    mailboxes.finishGoogle({ orgId: p.orgId, workspaceId: p.workspaceId }, { code: got.code, state: got.state }).then(setDone, (e) => {
      const code = e instanceof ApiError ? String((e.details as { code?: string } | undefined)?.code ?? e.code) : '';
      setErr(ERRORS[code] ?? (e instanceof ApiError ? e.message : 'Something went wrong. Start again from Connections.'));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (done) {
    return (
      <Frame title="Gmail connected" subtitle={<>Omni-SDR can send approved messages from <span className="font-medium text-ink">{done.address}</span>, up to {done.dailyCap} a day to start.</>}>
        <p className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 className="size-4 text-success" aria-hidden />Send-only. It can’t read your mail.</p>
        <Button variant="primary" className="mt-4 w-full" onClick={() => window.location.replace(back)}>Back to Connections</Button>
      </Frame>
    );
  }
  if (!err) return <Frame title="Connecting Gmail…"><p className="text-sm text-muted">One moment.</p></Frame>;
  return (
    <Frame title="Gmail wasn’t connected">
      <Banner tone="warning" title={err} role="alert" />
      <Button variant="secondary" className="mt-4 w-full" onClick={() => window.location.replace(back)}>Back to Connections</Button>
    </Frame>
  );
}
