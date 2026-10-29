'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import DemoVideo from '@/components/DemoVideo';
import { AgencyIcon, ArrowIcon, CheckBadge, FunnelMark, InboundThread, OwnerIcon, TickIcon } from '@/components/WaitlistArt';
import s from '@/components/waitlist.module.css';

export default function OmniSdrLandingPage() {
  const [formData, setFormData] = useState<{
    name: string;
    email: string;
    accountType: 'owner' | 'agency';
    company: string;
    phone: string;
    location: string;
  }>({
    name: '',
    email: '',
    accountType: 'owner',
    company: '',
    phone: '',
    location: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [discountCode, setDiscountCode] = useState('');

  const nameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email) return;

    setIsSubmitting(true);
    setStatus('idle');
    setErrorMessage('');

    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setStatus('success');
        setDiscountCode(data.accessCode || data.discountCode || 'OMNI-VIP-ACCESS');
        setFormData({ name: '', email: '', accountType: 'owner', company: '', phone: '', location: '' });
      } else {
        setStatus('error');
        setErrorMessage(data.error || 'Could not secure your discount. Please try again.');
      }
    } catch {
      setStatus('error');
      setErrorMessage('Could not connect to the server. Please try again later.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const scrollToForm = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    }, reduce ? 0 : 600);
  };

  return (
    <div className={s.page}>
      <header className={s.bar}>
        <span className={s.brand}><FunnelMark className={s.brandMark} />Omni SDR</span>
        <a href="#join" className={s.barCta} onClick={(e) => { e.preventDefault(); scrollToForm(); }}>Join the waitlist</a>
      </header>

      <div className={s.main}>
        <section className={s.hero} aria-labelledby="hero-title">
          <h1 id="hero-title" className={s.title}>
            <span className={s.titleA}>Every message answered.</span>{' '}
            <span className={s.titleB}>Every good lead <span className={s.mark}>handed off</span>.</span>
          </h1>
          <p className={s.lede}>
            The buffer between your first touch and your closer: Omni answers every message, qualifies the person, and hands the good ones to your closer, ready to book.
          </p>
        </section>

        {/* One thread down the page: the funnel's spout becomes a pipe into the form, and on into the demo */}
        <div className={s.flow}>
          <InboundThread />
          <div className={`${s.pipe} ${s.pipeIn}`} aria-hidden="true">
            <span className={s.pipeFlow}><span className={s.fillBar} /><span className={s.pulse} /></span>
            <span className={`${s.collar} ${s.collarBottom}`} />
            <span className={s.handoff}>
              <span className={s.handoffDot} />
              <span className={s.handoffLong}>Qualified · handed to your closer</span>
              <span className={s.handoffShort}>Handed off</span>
            </span>
          </div>

          {/* Lead capture */}
          <section id="join" ref={formRef} className={s.card} aria-labelledby="join-title">
            <div className={s.cardHead}>
              <h2 id="join-title" className={s.cardTitle}>Get Your Discount</h2>
              <p className={s.cardSub}>Secure your spot and lock in early pricing.</p>
            </div>

            <form onSubmit={handleSubmit}>
              <div className={s.fields}>
                {/* Name (Required) */}
                <div className={s.full}>
                  <label htmlFor="name" className={s.label}>Name <span aria-hidden="true">*</span></label>
                  <div className={s.control}>
                    <input
                      ref={nameInputRef}
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className={`${s.input} ${s.withOk}`}
                      placeholder="Alex Smith"
                    />
                    <TickIcon className={s.ok} />
                  </div>
                </div>

                {/* Email (Required) */}
                <div className={s.full}>
                  <label htmlFor="email" className={s.label}>Email <span aria-hidden="true">*</span></label>
                  <div className={s.control}>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className={`${s.input} ${s.withOk}`}
                      placeholder="alex@example.com"
                    />
                    <TickIcon className={s.ok} />
                  </div>
                </div>

                {/* Company Name (Optional) */}
                <div>
                  <label htmlFor="company" className={s.label}>Company <span className={s.opt}>(Optional)</span></label>
                  <input
                    type="text"
                    id="company"
                    name="company"
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    className={s.input}
                    placeholder="Acme Inc."
                  />
                </div>

                {/* Phone Number (Optional) */}
                <div>
                  <label htmlFor="phone" className={s.label}>Phone <span className={s.opt}>(Optional)</span></label>
                  <input
                    type="tel"
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className={s.input}
                    placeholder="(555) 000-0000"
                  />
                </div>

                {/* Location (Optional) */}
                <div className={s.full}>
                  <label htmlFor="location" className={s.label}>Location <span className={s.opt}>(Optional)</span></label>
                  <input
                    type="text"
                    id="location"
                    name="location"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    className={s.input}
                    placeholder="e.g., San Francisco, CA"
                  />
                </div>

                {/* Account Type Selector (Owner vs Agency): a sliding thumb marks the pick */}
                <div className={s.full}>
                  <span id="account-type" className={s.label}>I am an:</span>
                  <div role="group" aria-labelledby="account-type" className={s.seg} data-v={formData.accountType}>
                    <span className={s.thumb} aria-hidden="true" />
                    <button
                      type="button"
                      aria-pressed={formData.accountType === 'owner'}
                      onClick={() => setFormData({ ...formData, accountType: 'owner' })}
                      className={s.segBtn}
                    >
                      <OwnerIcon className={s.segIcon} />
                      <span>Owner</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={formData.accountType === 'agency'}
                      onClick={() => setFormData({ ...formData, accountType: 'agency' })}
                      className={s.segBtn}
                    >
                      <AgencyIcon className={s.segIcon} />
                      <span>Agency</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className={s.submit}>
                {isSubmitting ? 'Securing Discount...' : 'Get Your Discount'}
                {!isSubmitting && <ArrowIcon className={s.arrow} />}
              </button>

              {/* Status Messages: one live region that stays mounted, so screen readers announce what appears in it */}
              <div aria-live="polite">
                {status === 'success' && (
                  <div className={s.success}>
                    <div className={s.successHead}>
                      <CheckBadge className={s.badge} />
                      <span>Early Access & Discount Locked!</span>
                    </div>
                    <p className={s.successText}>Thank you! Your spot is secured. You are locked in for our exclusive early-access discount when we launch.</p>
                    <div className={s.pass}>VIP Pass: {discountCode}</div>
                  </div>
                )}

                {status === 'error' && (
                  <div className={s.error}>
                    {errorMessage}
                  </div>
                )}
              </div>
            </form>
          </section>

          <div className={`${s.pipe} ${s.pipeOut}`} aria-hidden="true">
            <span className={`${s.collar} ${s.collarTop}`} />
            <span className={s.pipeFlow}><span className={s.fillBar} /></span>
            <span className={`${s.collar} ${s.collarBottom}`} />
          </div>

          {/* See Omni in Action: the animated demo; its last chapter sends people back up to the form */}
          <section aria-labelledby="demo-heading" className={`${s.card} ${s.demoCard} ${s.reveal}`}>
            <h2 id="demo-heading" className={s.demoTitle}>See Omni in Action</h2>
            <DemoVideo onCta={scrollToForm} />
          </section>
        </div>

        {/* Footer */}
        <footer className={s.footer}>
          <p className={s.copy}>&copy; {new Date().getFullYear()} Omni SDR. All rights reserved.</p>
          <ul className={s.links}>
            <li><Link href="/privacy">Privacy Policy</Link></li>
            <li><Link href="/terms">Terms of Service</Link></li>
            <li><Link href="/anti-spam">Anti-Spam Policy</Link></li>
            <li><Link href="/security">Security Architecture</Link></li>
          </ul>
        </footer>
      </div>
    </div>
  );
}
