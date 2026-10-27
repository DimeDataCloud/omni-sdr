import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | OmniSDR',
  description: 'How OmniSDR collects, uses, stores, and shares personal information.',
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
          OmniSDR
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
          <p className="text-sm font-medium text-gray-500">Effective Date: October 2026</p>
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
            <h2 className="text-xl font-bold text-[#111111]">1. Overview</h2>
            <p>OmniSDR (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;), operating at <strong>omnisdr.com</strong>, explains here what personal information we collect when you visit our website, join our early-access waitlist, or use our platform, why we collect it, who handles it for us, and how to ask us to change or delete it. This page describes what we do today. We do not claim any security certification or audit that we do not hold.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Waitlist and contact details:</strong> name, email address, account type, and, if you choose to give them, company name, phone number, and location. We collect these when you ask for early access. We use them to save your place, to contact you about access and launch, and to answer your questions.</li>
              <li><strong>Account data:</strong> when you use the platform, the sign-in identity and workspace details needed to run your account.</li>
              <li><strong>Lead and prospect data for clients:</strong> when a client uses OmniSDR, we process the business contact details and public business information the client supplies or that we gather from public sources for that client, so that the client can run outreach and follow-up. See section 6.</li>
              <li><strong>Technical data:</strong> IP address, browser and device headers, and request times. We use them for rate limiting, bot protection, and security.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. AI Processing</h2>
            <p>Parts of the platform use a large language model to draft and classify text.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li>We use Google&rsquo;s Gemini API for model calls. Text sent for a task, such as a prospect&rsquo;s public business details or a draft message, goes to Google to be processed.</li>
              <li>We do not train our own models on client or prospect data.</li>
              <li>Our public demo uses made-up sample data only and never real prospect or customer data. The demo model tier may let the provider use what is submitted to it, which is why we send it sample data only.</li>
              <li>Google&rsquo;s own terms govern how it handles data sent to its API. We do not state or promise more than those terms provide.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. Storage and Security</h2>
            <p>How your data is stored and protected:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Waitlist details:</strong> saved in a private Google Cloud Storage bucket through an ingest service that only accepts new signups. Reading the data requires an authenticated administrator.</li>
              <li><strong>Platform data:</strong> stored in a Postgres database hosted by Neon. Each client&rsquo;s records are separated by Postgres row-level security, so one workspace cannot read another&rsquo;s.</li>
              <li><strong>Hosting and sign-in:</strong> our website and API run on Cloudflare (Pages, Workers, and Containers). Staff and client sign-in goes through Cloudflare Access. Traffic to our sites is encrypted in transit with TLS.</li>
              <li><strong>Mailbox access:</strong> if you connect Gmail, we use Google&rsquo;s OAuth. We ask only for the permission to send the messages you approve, and we keep the sign-in token sealed.</li>
              <li>No system is perfectly secure. We do not hold SOC 2, ISO 27001, or HIPAA certification, and nothing here should be read as saying we do.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Who We Share Data With</h2>
            <p>We do not sell or rent personal information, and we do not share it for advertising. We share it only with the service providers below, who process it for us to run the service:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Cloudflare:</strong> website and API hosting, DNS, sign-in (Access), bot checks (Turnstile), and inbound email routing.</li>
              <li><strong>Neon:</strong> Postgres database hosting for platform data.</li>
              <li><strong>Google:</strong> Cloud Storage and Cloud Run for waitlist signups, Secret Manager for service credentials, the Gemini API for model calls, the Places API for business lookups, and Gmail when a client connects their own mailbox.</li>
              <li><strong>ZeroBounce:</strong> email address verification before a client sends outreach.</li>
              <li>We may also disclose information if the law requires it.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. Our Role for Clients</h2>
            <p>When a client uses OmniSDR to contact prospects, the client decides whom to contact and why, and we act as a service provider (processor) for that client. We process prospect data only on the client&rsquo;s instructions, we do not sell it, and we do not combine it with data from other clients. A prospect who wants to stop receiving messages can use the unsubscribe link in any message or contact us, and we add them to the client&rsquo;s suppression list so they are not contacted again.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. How Long We Keep Data</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Waitlist details:</strong> until you ask us to delete them, or until we close the waitlist and tell you, whichever comes first.</li>
              <li><strong>Client and prospect data:</strong> for as long as the client&rsquo;s account is active, and deleted on the client&rsquo;s request or when the account ends.</li>
              <li><strong>Suppression records</strong> (people who opted out): kept so that we do not contact them again.</li>
              <li><strong>Technical logs:</strong> kept only as long as needed for security and abuse prevention.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">8. Your Choices and Rights</h2>
            <p>You can ask us to show you what we hold about you, correct it, give you a copy, or delete it, and you can opt out of further contact at any time. This applies whether you are on our waitlist, a client, or a prospect contacted for a client. Email <a href="mailto:privacy@omnisdr.com" className="font-bold underline text-[#111111]">privacy@omnisdr.com</a> or call 479-747-2076, 8 a.m. to 8 p.m. Central Time. We respond to verified requests promptly. California, EU and UK residents have these rights by law, and we honor them for everyone.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">9. Contact Information</h2>
            <p>For questions about this policy or your data:</p>
            <p className="font-mono text-xs bg-black/5 p-4 rounded-xl border border-black/10">
              OmniSDR Legal & Privacy Operations<br />
              713 Harpeth Knoll Court<br />
              Nashville, Tennessee 37221<br />
              Website: https://omnisdr.com<br />
              Email: privacy@omnisdr.com<br />
              Phone: 479-747-2076, 8 a.m. to 8 p.m. Central Time
            </p>
          </section>
        </div>

        <footer className="mt-12 text-center text-xs text-gray-400">
          &copy; 2026 OmniSDR. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
