import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Security Architecture | Omni SDR',
  description: 'Enterprise security architecture, multi-tenant isolation, and data governance standards for Omni SDR.',
};

export default function SecurityPage() {
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
            Security Architecture
          </h1>
          <p className="text-sm font-medium text-gray-500">Enterprise Defense-in-Depth Specification</p>
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
            <h2 className="text-xl font-bold text-[#111111]">1. Multi-Tenant Database Isolation (RLS)</h2>
            <p>Omni SDR operates with structural multi-tenant isolation. All customer workspaces are partitioned by unique organizational UUIDs and governed by forced PostgreSQL <strong>Row-Level Security (RLS)</strong> policies. Cross-tenant leakage is physically impossible at the database kernel level.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Cryptographic Envelope Encryption</h2>
            <p>Sensitive credentials, tokens, and OAuth keys are never stored in plaintext:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>All secrets are protected using <strong>Google Cloud KMS Envelope Encryption</strong> with automated key rotation.</li>
              <li>Only isolated execution worker microservices operating with restricted least-privilege IAM roles possess access to decrypt authorization credentials.</li>
              <li>Web client browsers never communicate directly with upstream model providers or database instances.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. Zero-Restricted-Scope Regulatory Architecture</h2>
            <p>Omni SDR intentionally routes inbound mail processing and outbound verification through hardened Cloudflare Workers rather than requesting broad, invasive Google Workspace `gmail.readonly` scopes. This eliminates third-party token vulnerabilities and preserves customer data sovereignty.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Immutable Audit Trails & Hold Mechanisms</h2>
            <p>Every administrative action, message approval, and credit ledger transition is recorded in an immutable, append-only audit log. In the event of deliverability anomalies or security triggers, emergency <strong>Hold Breakers</strong> immediately halt outbound lanes across organizations, workspaces, or specific mailboxes within milliseconds.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Vulnerability Reporting</h2>
            <p>We actively collaborate with the security research community. If you discover a potential vulnerability, report it immediately to:</p>
            <p className="font-mono text-xs bg-black/5 p-4 rounded-xl border border-black/10">
              Omni SDR Security Response Team<br />
              Email: security@omnisdr.com<br />
              PGP Key available upon request. Responsible disclosures receive prioritized triage.
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
