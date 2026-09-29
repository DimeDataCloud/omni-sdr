import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service | Omni SDR',
  description: 'Terms of Service and Customer Outreach Agreements for Omni SDR.',
};

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="text-sm font-medium text-gray-500">Effective Date: September 28, 2026 · Last Updated: September 2026</p>
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
            <h2 className="text-xl font-bold text-[#111111]">1. Acceptance of Terms</h2>
            <p>By accessing or using the Omni SDR platform, website (<strong>omnisdr.com</strong>), APIs, or joining our waitlist, you agree to be bound by these Terms of Service ("Terms"). If you represent an organization or agency, you warrant that you possess the authority to bind that entity.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Description of Service</h2>
            <p>Omni SDR provides an autonomous AI Sales Development Representative (SDR) platform enabling B2B consultants, operators, and growth agencies to research prospects, generate evidence-backed outreach sequences, execute approved multichannel communications, and manage meeting scheduling.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. Acceptable Use & Outbound Compliance</h2>
            <p>You agree to utilize Omni SDR in strict compliance with applicable domestic and international communication regulations, including the CAN-SPAM Act of 2003, TCPA, and GDPR:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>No Unsolicited Bulk Spam:</strong> All outbound campaigns must target bona fide business entities with legitimate B2B interest.</li>
              <li><strong>Mandatory Unsubscribe Mechanisms:</strong> Every email must incorporate functional, instantaneous one-click unsubscribe links.</li>
              <li><strong>Accurate Sender Identification:</strong> You may not disguise headers, spoof identity, or falsely represent sender credentials.</li>
              <li><strong>Cryptographic Claims Verification:</strong> You may not attempt to disable, circumvent, or falsify evidence claims gates enforced by the platform.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Accounts, Workspaces, and Human-in-the-Loop Review</h2>
            <p>Users are responsible for maintaining account confidentiality. Omni SDR provides configurable Trust Dial governance levels. Under Level 1 (Human-in-the-Loop), you acknowledge that outbound messages require explicit human approval prior to dispatch and that you maintain final editorial responsibility for approved communications.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Subscriptions, Credits, and Early-Bird Discounts</h2>
            <p>Subscription tiers, credit meters (Data, Action, Media), and overage rules are metered via atomic database ledgers. Early-bird discount vouchers issued during pre-launch registration grant qualifying discounts against standard subscription pricing upon commercial availability and are non-transferable.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. Intellectual Property & Evidence Ownership</h2>
            <p>You retain full ownership of all offer materials, customer data, and brand assets uploaded to your workspace. Omni SDR grants you a non-exclusive license to use generated copy, audit collateral, and outbound sequences created within your account boundaries.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, Omni SDR and its affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the platform, third-party mailbox deliverability, or calendar scheduling conflicts.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">8. Contact Information</h2>
            <p>Questions regarding these Terms should be directed to:</p>
            <p className="font-mono text-xs bg-black/5 p-4 rounded-xl border border-black/10">
              Omni SDR Legal Affairs<br />
              713 Harpeth Knoll Court<br />
              Nashville, Tennessee 37221<br />
              Website: https://omnisdr.com<br />
              Email: legal@omnisdr.com
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
