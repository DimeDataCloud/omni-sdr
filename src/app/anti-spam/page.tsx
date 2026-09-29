import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Anti-Spam Policy | Omni SDR',
  description: 'Anti-Spam Policy and Zero-Tolerance Standards for Omni SDR.',
};

export default function AntiSpamPage() {
  return (
    <div className="min-h-screen w-full relative overflow-x-hidden flex flex-col items-center justify-start font-sans antialiased text-[#111111] bg-[#f5f3ef] selection:bg-[#a3ffb1] selection:text-[#111111]">
      <div 
        className="pointer-events-none absolute inset-0 z-0 opacity-100"
        style={{
          backgroundImage: `
            radial-gradient(circle at top right, #fdfbf7, transparent 70%),
            radial-gradient(circle at bottom left, #eae4d9, transparent 70%)
          `
        }}
      />

      <nav className="w-full max-w-4xl px-6 py-8 flex justify-between items-center z-10">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-[#111111]">
          Omni SDR
        </Link>
        <Link href="/" className="text-xs font-semibold text-[#111111]/70 hover:text-[#111111] transition-colors py-1.5 px-3 rounded-full hover:bg-black/5">
          &larr; Back to Home
        </Link>
      </nav>

      <main className="w-full max-w-4xl px-6 pb-20 z-10 relative">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#111111] mb-3">
            Anti-Spam Policy
          </h1>
          <p className="text-sm font-medium text-gray-500">Effective Date: September 28, 2026 · Zero-Tolerance Standard</p>
        </header>

        <div 
          className="rounded-3xl p-8 md:p-12 space-y-8 text-sm leading-relaxed text-[#2a2a2a]"
          style={{
            background: 'rgba(253, 251, 248, 0.75)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.7)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.04)'
          }}
        >
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">1. Strict Zero-Tolerance Spam Policy</h2>
            <p>Omni SDR enforces a zero-tolerance policy against unsolicited bulk commercial email ("spam"). Our infrastructure is engineered exclusively for high-relevance, evidence-grounded B2B communications that strictly adhere to international deliverability standards, including CAN-SPAM, CASL, and the EU General Data Protection Regulation (GDPR).</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Structural Platform Safeguards</h2>
            <p>Unlike conventional email automation tools, Omni SDR enforces compliance at the database kernel level:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Cryptographic Claims Verification:</strong> No message can be dispatched unless each assertion is verified against factual, immutable evidence captured from the prospect's public digital footprint. Hallucinated or deceptive claims are blocked by database constraints.</li>
              <li><strong>Global & Tenant Suppression:</strong> Any recipient who requests an unsubscribe, generates a hard bounce, or files a complaint is immediately and permanently suppressed across all sending lanes. Database triggers prevent accidental re-enrollment.</li>
              <li><strong>Daily Send Volume Throttling:</strong> Sending mailboxes are strictly throttled according to algorithmic warmup schedules and daily recipient caps to preserve domain reputation.</li>
              <li><strong>2024 Bulk Sender Protocol:</strong> Full compliance with mandatory SPF, DKIM, and DMARC alignment standards required by Google and Yahoo.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. Required Customer Conduct</h2>
            <p>Customers using Omni SDR must agree to:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Never import bought, rented, or scraped mass email lists with unknown deliverability validity.</li>
              <li>Verify all prospective business email addresses prior to enrollment.</li>
              <li>Ensure every message includes a clear, transparent explanation of why the recipient was contacted, a valid physical business address, and an automated one-click opt-out link.</li>
              <li>Promptly honor all requests to cease communication.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Reporting Abuse</h2>
            <p>If you have received an unsolicited or inappropriate communication originating through an Omni SDR customer workspace, please forward the complete message including full headers to:</p>
            <p className="font-mono text-xs bg-black/5 p-4 rounded-xl border border-black/10">
              Omni SDR Abuse & Deliverability Enforcement<br />
              Email: abuse@omnisdr.com<br />
              Action SLA: Reported senders are reviewed and placed on temporary sending holds within 2 hours.
            </p>
          </section>
        </div>

        <footer className="mt-12 text-center text-xs text-gray-400">
          &copy; 2026 Omni SDR. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
