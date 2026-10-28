import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service | OmniSDR',
  description: 'Terms of service for OmniSDR, including text messaging and AI call terms.',
};

export default function TermsPage() {
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
            Terms of Service
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
            <p>These terms are an agreement between you and OmniSDR, a Tennessee general partnership (&quot;OmniSDR&quot;, &quot;we&quot;, &quot;us&quot;), 713 Harpeth Knoll Court, Nashville, TN 37221. They apply when you use omnisdr.com or receive calls or texts we send. By using the website, or by staying opted in to texts, you agree to them.</p>
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">1. What OmniSDR does</h2>
            <p>OmniSDR answers phone calls, replies to requests by text and email, sends follow-up messages, and books appointments for small businesses (&quot;Clients&quot;), using AI voice and messaging technology.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. Business clients</h2>
            <p>A Client&apos;s use of our services is governed by the OmniSDR Master Services Agreement, its Compliance Addendum and the Client&apos;s Order Form. If those conflict with these terms, they control for that Client.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. Text messaging terms</h2>
            <p>These terms cover the texts OmniSDR sends for a Client, and any texts OmniSDR sends about its own services.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Program.</strong> Texts about a request you made to the business named in the text: replies, follow-ups, appointment details and related offers, as you agreed when you opted in.</li>
              <li><strong>Consent.</strong> You opt in by checking an optional, unchecked box on the business&apos;s form, or by texting the business first. Consent is not a condition of purchase.</li>
              <li><strong>Frequency.</strong> Message frequency varies. For follow-ups about a request, at most 4 texts over 7 days unless you reply.</li>
              <li><strong>Cost.</strong> Message and data rates may apply.</li>
              <li><strong>Stop.</strong> Reply STOP (or STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT) at any time. You will get one confirmation and no further texts from that business. Reply START to opt back in.</li>
              <li><strong>Help.</strong> Reply HELP, or email support@omnisdr.com.</li>
              <li><strong>Carriers.</strong> Carriers are not liable for delayed or undelivered messages.</li>
              <li><strong>Privacy.</strong> See our Privacy Policy at omnisdr.com/privacy. Mobile numbers and text opt-in data are never shared with third parties for marketing.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. AI calls and recordings</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Calls may be answered or placed by an AI assistant, and the call says so at the start.</li>
              <li>Calls may be recorded and transcribed, as described in our Privacy Policy.</li>
              <li>If you need a person, ask the assistant to transfer you or to take a message.</li>
              <li>In an emergency, call 911. Our services are not an emergency service.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Using the website</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Don&apos;t misuse the website. That includes trying to break its security, scraping it, overloading it, or using it to break the law.</li>
              <li>The website, our brand and our content belong to OmniSDR or its licensors. You may view them for your own use.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. No warranties</h2>
            <p>The website and its content are provided &quot;as is.&quot; We don&apos;t promise they will always be available or error-free. Information on the website is general, not professional advice.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. Limits on liability</h2>
            <p>To the extent the law allows, OmniSDR is not liable for indirect or consequential losses from using the website or receiving our messages. Our total liability to a website visitor or message recipient under these terms is limited to $100. These limits don&apos;t reduce rights you have by law that can&apos;t be waived. They don&apos;t apply to Clients, whose limits are in the Master Services Agreement.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">8. Law and disputes</h2>
            <p>Tennessee law governs these terms. Disputes go to the state or federal courts in Davidson County, Tennessee, unless the law gives you a right to bring them elsewhere.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">9. Changes</h2>
            <p>We may update these terms by posting a new version here with a new effective date.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">10. Contact</h2>
            <p>OmniSDR, 713 Harpeth Knoll Court, Nashville, TN 37221 · support@omnisdr.com</p>
          </section>

        </div>
      </main>
    </div>
  );
}
