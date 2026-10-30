import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy | OmniSDR',
  description: 'How OmniSDR collects, uses and shares personal information, including calls, texts and recordings.',
};

export default function PrivacyPage() {
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
            Privacy Policy
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
            <p>This policy explains how OmniSDR, a Tennessee general partnership (&quot;OmniSDR&quot;, &quot;we&quot;, &quot;us&quot;), 713 Harpeth Knoll Court, Nashville, TN 37221, collects, uses and shares personal information. It covers our website at omnisdr.com, the people who contact us, and the people our business clients ask us to answer, call or text.</p>
          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">1. Who we are and whose data this is</h2>
            <p>OmniSDR answers calls, sends texts and follow-up messages, and books appointments for small businesses (&quot;Clients&quot;), using AI voice and messaging technology.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>When you visit omnisdr.com, contact us, or are a Client,</strong> OmniSDR decides how your information is used.</li>
              <li><strong>When you call, text or fill in a form for one of our Clients,</strong> that Client decides how your information is used. We process it for the Client under a written agreement and only to provide our services to that Client. Questions or requests about that information are best sent to the Client. We will also pass on any request you send us.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">2. What we collect</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Contact details:</strong> name, phone number, email address, business name and address.</li>
              <li><strong>Calls:</strong> call recordings, transcripts, call times and lengths, and the phone numbers involved.</li>
              <li><strong>Texts and messages:</strong> message content, times, delivery status and replies, including STOP and HELP.</li>
              <li><strong>Consent records:</strong> what you agreed to, the exact wording shown, when, the page or form, and your IP address and browser details.</li>
              <li><strong>Requests:</strong> what you asked about and any appointment you booked.</li>
              <li><strong>Website data:</strong> IP address, browser and device type, pages viewed, and security logs.</li>
              <li><strong>Client account data:</strong> billing contact, plan and payment records. Card and bank details are handled by our payment processor; we do not store full card numbers.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">3. How we use it</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>To answer calls, reply to requests, send follow-up messages the person agreed to, and book appointments for our Clients.</li>
              <li>To honor opt-outs and keep consent and do-not-contact records.</li>
              <li>To run, secure and fix our services and website, and to prevent fraud and abuse.</li>
              <li>To bill Clients and keep business records.</li>
              <li>To meet legal obligations and respond to lawful requests.</li>
            </ul>
            <p>We do not sell personal information. We do not use Client call recordings, transcripts or messages to train AI models, and we use the no-training settings our providers offer. Our current providers and their settings are listed in Exhibit B of our Master Services Agreement, available from support{"@"}omnisdr.com.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">4. How AI processes your information</h2>
            <p>We use artificial intelligence to route, review, and act on information:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Lead routing:</strong> AI systems review incoming leads and inquiries to route them to the right team member, prioritize follow-up, and suggest next actions.</li>
              <li><strong>Call and message handling:</strong> AI voice assistants answer calls, transcribe conversations, and draft follow-up messages. A human reviews AI-drafted outreach before it is sent unless you have agreed to fully automated follow-up.</li>
              <li><strong>Data review:</strong> AI tools help our team review contact records, call summaries, and message threads to identify opportunities and ensure nothing is missed.</li>
              <li><strong>What AI does not do:</strong> AI does not make hiring, credit, housing, or other consequential decisions about individuals. AI outputs are reviewed by humans before any significant action is taken.</li>
              <li><strong>AI providers:</strong> we use third-party AI services (including language models) to process data. These providers are bound by contract not to train their models on your data. See §8 for the full list.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">5. Marketing to people who contact us</h2>
            <p>When you fill in a form on omnisdr.com (such as the waitlist), you agree to receive recurring marketing communications from OmniSDR by phone, text message (including by autodialer or prerecorded voice), email, and social media. Consent is not a condition of purchase.</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>What we send:</strong> product updates, launch announcements, special offers, and follow-up messages about our services.</li>
              <li><strong>How to opt out:</strong> reply STOP to any text to stop texts; click unsubscribe in any email; email support{"@"}omnisdr.com to stop all marketing contact. We honor opt-outs promptly.</li>
              <li><strong>Consent records:</strong> we store the exact consent wording you saw, the date and time, your IP address, and browser details, for at least 5 years.</li>
              <li><strong>We do not sell</strong> your contact information or share it with third parties for their own marketing.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">6. Text messaging</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>We send texts only for a Client to people who gave that Client the required consent, or who just contacted that Client and asked to hear back.</li>
              <li>Message frequency varies. Message and data rates may apply.</li>
              <li>Reply <strong>STOP</strong> to stop texts and <strong>HELP</strong> for help. After STOP you get one confirmation and no further texts from that business unless you opt in again.</li>
              <li><strong>No mobile information will be shared with third parties or affiliates for marketing or promotional purposes.</strong> Text messaging opt-in data and consent are not shared with any third party, except the service providers that deliver the messages for us.</li>
              <li>Carriers are not liable for delayed or undelivered messages.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">7. Calls and recordings</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>AI disclosure:</strong> calls may be answered by an AI voice assistant. The caller is told at the start of the call that they are speaking with an AI system, including the AI-generated nature of the voice where required by law (e.g., California).</li>
              <li>Calls may be recorded and transcribed. The caller is told this at the start of the call, and for Clients in states that require everyone&apos;s consent, before recording begins.</li>
              <li><strong>Outbound AI calls:</strong> we place AI-voice calls only to people who have given prior express consent. Each call identifies OmniSDR (or the Client on whose behalf we are calling) and provides a way to opt out or reach a human.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">8. Who we share it with</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>The Client</strong> whose calls or messages it relates to.</li>
              <li><strong>Service providers</strong> who help us run the services: telephone and texting carriers, voice AI and language-model providers, hosting, email, and payment processing. They are bound by contract to use the data only to provide services to us. The list is in Exhibit B of our Master Services Agreement, available from support{"@"}omnisdr.com.</li>
              <li><strong>Dime Data,</strong> which supplies our software platform and bills Clients on our behalf.</li>
              <li><strong>Authorities,</strong> when the law requires it, or to protect people&apos;s safety or our legal rights.</li>
              <li><strong>A buyer or successor entity,</strong> if OmniSDR&apos;s business is transferred, including when it becomes a limited liability company. That entity remains bound by this policy.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">9. How long we keep it</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Call recordings: 90 days by default. A Client can set from 30 to 365 days.</li>
              <li>Consent and opt-out records: 5 years, to prove consent and honor opt-outs.</li>
              <li>Other Client data: for the length of the Client&apos;s agreement plus 90 days, then deleted or returned to the Client.</li>
              <li>Billing records: as long as tax law requires.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">10. Security</h2>
            <p>We use encryption in transit, access controls, and logging. If a breach affects your information, we will notify the Client concerned, and you where the law requires.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">11. Your choices and rights</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>You can ask us to access, correct or delete information about you, or to stop contacting you. Email support{"@"}omnisdr.com.</li>
              <li>If your information was collected for a Client, we will forward your request to that Client and help them respond.</li>
              <li>Depending on your state, you may have further rights under its privacy law. We will not treat you differently for using them.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">12. Children</h2>
            <p>Our services are for businesses and adults. We do not knowingly collect information from children under 13.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">13. Changes</h2>
            <p>We will post changes here and update the effective date. If a change is material, we will tell Clients in advance.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-bold text-[#111111]">14. Contact</h2>
            <p>OmniSDR, 713 Harpeth Knoll Court, Nashville, TN 37221 · support{"@"}omnisdr.com</p>
          </section>

        </div>
      </main>
    </div>
  );
}
