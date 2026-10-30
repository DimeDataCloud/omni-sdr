import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Data Processing | OmniSDR',
  description: 'How OmniSDR handles data processing for business clients.',
};

export default function DPAPage() {
  return (
    <div className="min-h-screen w-full relative overflow-x-hidden flex flex-col items-center justify-start font-sans antialiased text-[#111111] bg-[#f5f3ef] selection:bg-[#a3ffb1] selection:text-[#111111]">
      <nav className="w-full max-w-4xl px-6 py-8 flex justify-between items-center z-10">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-[#111111]">
          OmniSDR
        </Link>
        <Link href="/" className="text-xs font-semibold text-[#111111]/70 hover:text-[#111111] transition-colors py-1.5 px-3 rounded-full hover:bg-black/5">
          &larr; Back to Home
        </Link>
      </nav>

      <main className="w-full max-w-4xl px-6 pb-20 z-10 relative">
        <header className="mb-10 text-center md:text-left">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[#111111] mb-3">
            Data Processing for Clients
          </h1>
          <p className="text-sm font-medium text-gray-500">Effective date: October 31, 2026</p>
        </header>

        <div
          className="rounded-3xl p-8 md:p-12 space-y-8 text-sm leading-relaxed text-[#2a2a2a]"
          style={{
            background: 'rgba(253, 251, 248, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.7)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.04)'
          }}
        >
          <p>Businesses using OmniSDR&apos;s services receive a full Data Processing Exhibit (Exhibit A) as part of our Master Services Agreement. That signed agreement — not this page — is the controlling legal document.</p>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">Summary</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Roles:</strong> you (the client) are the controller; OmniSDR is your service provider and processor.</li>
              <li><strong>AI disclosure:</strong> every call and text starts by identifying your business and stating the caller is speaking with an AI assistant.</li>
              <li><strong>No training:</strong> we do not use your data to train AI models.</li>
              <li><strong>Sub-processors:</strong> a current list is provided with your agreement.</li>
              <li><strong>Your duties:</strong> you are the caller of record and are responsible for consent, do-not-call compliance, and the accuracy of your approved scripts. See our AI Calling, Texting and Recording Compliance Addendum.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">Get the full agreement</h2>
            <p>Contact support{"@"}omnisdr.com to receive our Master Services Agreement, Compliance Addendum, and Data Processing Exhibit.</p>
          </section>

        </div>
      </main>
    </div>
  );
}
