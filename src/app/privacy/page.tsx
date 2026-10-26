import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | Omni SDR',
  description: 'Privacy Policy and Zero-Training AI data protection standards for Omni SDR.',
};

export default function PrivacyPage() {
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
            Privacy Policy
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
            <h2 className="text-xl font-bold text-[#111111]">1. Overview & Commitment</h2>
            <p>Omni SDR ("we", "our", or "us"), operating at <strong>omnisdr.com</strong>, is committed to safeguarding the privacy and security of your personal data. This Privacy Policy details how we collect, process, store, and protect information when you visit our website, join our early-access waitlist, or use our enterprise AI SDR platform services.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Contact & Account Data:</strong> Name, professional email address, company name, phone number, and business location provided when requesting early access or registering an account.</li>
              <li><strong>Outreach & Evidence Data:</strong> Public digital footprint data and business signals gathered strictly on behalf of customers for verifiable outbound engagement.</li>
              <li><strong>Technical Telemetry:</strong> Anonymized browser metadata, IP addresses, session timestamps, and device headers used exclusively for rate limiting, bot protection, and security auditing.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. AI Processing & Foundation Models</h2>
            <p>Omni SDR is engineered with a strict <strong>Zero-Training Enterprise Guarantee</strong>:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>Customer data, prospect information, and message drafts processed through our AI gateway are <strong>never</strong> used to train, retrain, or improve foundational commercial AI models (Google Gemini API).</li>
              <li>All generative tasks run within private, enterprise-tier Google Cloud boundaries governed by SOC 2, ISO 27001, and HIPAA-compliant data agreements.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Data Storage & Multi-Tenant Isolation</h2>
            <p>We deploy modern defense-in-depth data architecture:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Storage:</strong> Assets and records are encrypted at rest with AES-256 via Google Cloud Storage and private Cloud SQL PostgreSQL instances.</li>
              <li><strong>Tenant Isolation:</strong> Data boundaries are cryptographically enforced at the database level using Postgres Row-Level Security (RLS). Cross-tenant queries are structurally refused by database triggers.</li>
              <li><strong>Edge Shielding:</strong> All internet traffic terminates via Cloudflare edge networks with strict TLS 1.3 encryption and automated DDoS mitigation.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Sharing & Disclosures</h2>
            <p>We never sell, rent, or monetize your personal information. Data is shared strictly with essential infrastructure sub-processors under confidentiality obligations:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Cloud Infrastructure:</strong> Google Cloud Platform (Compute, Storage, Database)</li>
              <li><strong>Security & Network:</strong> Cloudflare (Edge DNS, WAF, Workers)</li>
              <li><strong>Billing:</strong> Stripe (PCI-DSS Level 1 payment processing)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. Your Rights (GDPR & CCPA/CPRA)</h2>
            <p>You maintain the right to access, rectify, port, or request permanent deletion of your personal data at any time. To exercise your rights or request removal from our waitlist or databases, email us at <a href="mailto:privacy@omnisdr.com" className="font-bold underline text-[#111111]">privacy@omnisdr.com</a>. We respond to all verified requests within 30 days.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. Contact Information</h2>
            <p>For inquiries regarding this policy or data practices, contact:</p>
            <p className="font-mono text-xs bg-black/5 p-4 rounded-xl border border-black/10">
              Omni SDR Legal & Privacy Operations<br />
              713 Harpeth Knoll Court<br />
              Nashville, Tennessee 37221<br />
              Website: https://omnisdr.com<br />
              Email: privacy@omnisdr.com
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
