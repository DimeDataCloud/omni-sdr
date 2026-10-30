import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Data Processing Agreement | OmniSDR',
  description: 'How OmniSDR processes personal data on behalf of business clients.',
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
            Data Processing Agreement
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
          <p>This Data Processing Agreement (&quot;DPA&quot;) forms part of the agreement between OmniSDR, a Tennessee general partnership (&quot;Processor&quot;), and the business client (&quot;Controller&quot;) receiving OmniSDR&apos;s AI receptionist and lead-response services.</p>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">1. Roles</h2>
            <p>Controller decides what personal data is collected and why. Processor processes it only on Controller&apos;s documented instructions and only to provide the services. For CCPA/CPRA purposes, Processor acts as a Service Provider and will not sell, share, or use personal data for its own purposes.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. What we process</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Contact details of Controller&apos;s customers and prospects (name, phone, email, address).</li>
              <li>Call recordings, transcripts, and metadata.</li>
              <li>Text message content, delivery records, and opt-out requests.</li>
              <li>Appointment and follow-up records.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. AI processing</h2>
            <p>Processor uses AI systems (voice agents, language models) to answer calls, draft messages, transcribe conversations, route leads, and summarize interactions. AI providers are bound by contract not to train models on Controller data. A current list of AI sub-processors is available on request from support{"@"}omnisdr.com.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Sub-processors</h2>
            <p>Processor uses sub-processors for telephony, texting, AI processing, hosting, and payment. Controller authorizes these sub-processors. Processor will notify Controller of material changes and remains liable for sub-processor acts as if performed directly.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Security</h2>
            <p>Processor uses encryption in transit and at rest, access controls, audit logging, and network security. Processor will notify Controller of a personal data breach without undue delay and cooperate in meeting Controller&apos;s notification obligations.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. Data subject rights</h2>
            <p>Processor will forward data subject requests (access, deletion, correction, opt-out) to Controller promptly and assist Controller in responding as required by law.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. Retention and deletion</h2>
            <p>Call recordings: 90 days by default (Controller may set 30–365 days). Other data: duration of the agreement plus 90 days, then deleted or returned to Controller. Consent and opt-out records: 5 years.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">8. International transfers</h2>
            <p>Data is processed in the United States. If data is transferred internationally, Processor will use appropriate safeguards (e.g., Standard Contractual Clauses).</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">9. Contact</h2>
            <p>OmniSDR, 713 Harpeth Knoll Court, Nashville, TN 37221 · support{"@"}omnisdr.com</p>
          </section>

        </div>
      </main>
    </div>
  );
}
