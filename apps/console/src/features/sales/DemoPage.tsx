// Rep portal, demo launcher (DESIGN-frontend-4-sales-portal, screen 3). The cap remaining is not shown: the demo Worker owns
// that number and this console cannot read it, so the page says to check on the day instead of showing a made-up count.
import { ExternalLink } from 'lucide-react';
import { useWorkspace } from '@/lib/session';
import { salesAccess } from './access';
import { DEMO_DONT, DEMO_LIMITS, DEMO_SAY, DEMO_STEPS } from './playbookData';
import { Banner, Card, NoAccess, Page, PageHeader } from '@/components/ui';

const DEMO_URL = 'https://demo.omnisdr.com/tryme';

export default function DemoPage() {
  const { role } = useWorkspace();
  if (!salesAccess(role).portal) return <Page><NoAccess what="the sales portal" /></Page>;
  return (
    <Page>
      <PageHeader title="Run the demo" subtitle="Try me is a demonstration on sample data, not a client service." />
      <Banner tone="warning" title="Test it the same day">Open the demo on your own screen before every prospect call. The daily limit is shared, and the console cannot show how much is left.</Banner>
      <Card className="grid gap-3 p-4">
        <a className="inline-flex items-center gap-2 font-medium underline" href={DEMO_URL} target="_blank" rel="noreferrer">Open Try me<ExternalLink className="size-4" aria-hidden /></a>
        <p className="text-sm text-muted">It asks for the demo password first. The password is Christian&apos;s to give out.</p>
        <h2 className="font-medium">In front of a prospect</h2>
        <ol className="list-decimal pl-5 text-sm">{DEMO_STEPS.map((s) => <li key={s}>{s}</li>)}</ol>
        <p className="text-sm">Say: &quot;{DEMO_SAY}&quot;</p>
      </Card>
      <Card className="grid gap-2 p-4">
        <h2 className="font-medium">If it is at its limit or paused</h2>
        <p className="text-sm">{DEMO_LIMITS}</p>
        <p className="text-sm text-muted">{DEMO_DONT}</p>
      </Card>
    </Page>
  );
}
