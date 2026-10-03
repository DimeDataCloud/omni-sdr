'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { Sparkles, CheckCircle2, ArrowRight, User, Building2 } from 'lucide-react';
import DemoVideo from '@/components/DemoVideo';

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
  const headerRef = useRef<HTMLElement>(null);

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
    headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      nameInputRef.current?.focus({ preventScroll: true });
    }, 600);
  };

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden flex flex-col items-center justify-start font-sans antialiased text-[#111111] bg-[#f5f3ef] selection:bg-[#a3ffb1] selection:text-[#111111]">
      {/* Texture Gradients */}
      <div 
        className="pointer-events-none absolute inset-0 z-0 opacity-100"
        style={{
          backgroundImage: `
            radial-gradient(circle at top right, #fdfbf7, transparent 70%),
            radial-gradient(circle at bottom left, #eae4d9, transparent 70%)
          `
        }}
      />

      {/* Decorative Glow Blobs */}
      <div className="pointer-events-none absolute w-[500px] h-[500px] rounded-full bg-[#e0f8e3] top-[-10%] left-[-10%] blur-[80px] opacity-70 z-0" />
      <div className="pointer-events-none absolute w-[600px] h-[600px] rounded-full bg-[#fbf5eb] bottom-[-20%] right-[-10%] blur-[90px] opacity-80 z-0" />

      {/* Top Subtle Operator Navigation */}
      <nav className="w-full max-w-4xl px-6 pt-6 flex justify-between items-center z-10">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[#111111] animate-pulse" />
          <span className="text-xs font-semibold tracking-wider uppercase text-[#111111]/70">Omni-SDR Active</span>
        </div>
        <Link 
          href="/app" 
          className="text-xs font-semibold text-[#111111]/60 hover:text-[#111111] flex items-center gap-1.5 transition-colors py-1 px-3 rounded-full hover:bg-black/5"
        >
          <span>Operator Console</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </nav>

      <main className="w-full max-w-4xl px-6 py-10 md:py-16 flex flex-col items-center z-10 relative">
        {/* Header */}
        <header ref={headerRef} className="text-center mb-10 md:mb-12 w-full flex flex-col items-center">
          <img src="/logo.png" alt="Omni SDR Logo" className="w-32 h-auto mb-4 drop-shadow-md" />
          <h1 
            className="text-5xl md:text-6xl font-extrabold tracking-tight mb-5 text-[#111111]"
            style={{ textShadow: '0 1px 1px rgba(255,255,255,0.8)' }}
          >
            Omni SDR
          </h1>
          <p className="text-lg md:text-xl font-medium max-w-3xl mx-auto leading-relaxed text-[#333333]">
            The buffer between your first touch and your closer: Omni answers every message, qualifies the person, and hands the good ones to your closer, ready to book.
          </p>
        </header>

        {/* Lead Capture Glass Card */}
        <section 
          className="w-full max-w-xl rounded-3xl p-8 md:p-10 transition-all duration-300"
          style={{
            background: 'rgba(253, 251, 248, 0.70)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.7)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255, 255, 255, 0.4)'
          }}
        >
          <div className="text-center mb-8 flex flex-col items-center">
            <img src="/logo.png" alt="Omni SDR Form Logo" className="w-12 h-12 mb-4 rounded-xl object-cover shadow-sm ring-1 ring-black/5" />
            <h2 
              className="text-3xl font-semibold mb-2 text-[#111111]"
              style={{ textShadow: '0 1px 1px rgba(255,255,255,0.8)' }}
            >
              Get Your Discount
            </h2>
            <p className="text-sm font-medium text-gray-500">Secure your spot and lock in early pricing.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {/* Name (Required) */}
              <div className="col-span-1 md:col-span-2">
                <label htmlFor="name" className="block text-sm font-semibold mb-1 text-[#111111]">
                  Name <span className="text-[#111111]">*</span>
                </label>
                <input
                  ref={nameInputRef}
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-xl px-4 py-3 text-sm text-[#111111] transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                  }}
                  placeholder="Alex Smith"
                />
              </div>

              {/* Email (Required) */}
              <div className="col-span-1 md:col-span-2">
                <label htmlFor="email" className="block text-sm font-semibold mb-1 text-[#111111]">
                  Email <span className="text-[#111111]">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full rounded-xl px-4 py-3 text-sm text-[#111111] transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                  }}
                  placeholder="alex@example.com"
                />
              </div>

              {/* Company Name (Optional) */}
              <div>
                <label htmlFor="company" className="block text-sm font-semibold mb-1 text-[#111111]">
                  Company <span className="font-normal text-gray-400 text-xs ml-1">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="company"
                  name="company"
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  className="w-full rounded-xl px-4 py-3 text-sm text-[#111111] transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                  }}
                  placeholder="Acme Inc."
                />
              </div>

              {/* Phone Number (Optional) */}
              <div>
                <label htmlFor="phone" className="block text-sm font-semibold mb-1 text-[#111111]">
                  Phone <span className="font-normal text-gray-400 text-xs ml-1">(Optional)</span>
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full rounded-xl px-4 py-3 text-sm text-[#111111] transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                  }}
                  placeholder="(555) 000-0000"
                />
              </div>

              {/* Location (Optional) */}
              <div className="col-span-1 md:col-span-2">
                <label htmlFor="location" className="block text-sm font-semibold mb-1 text-[#111111]">
                  Location <span className="font-normal text-gray-400 text-xs ml-1">(Optional)</span>
                </label>
                <input
                  type="text"
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full rounded-xl px-4 py-3 text-sm text-[#111111] transition-all duration-200"
                  style={{
                    background: 'rgba(255, 255, 255, 0.55)',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                  }}
                  placeholder="e.g., San Francisco, CA"
                />
              </div>

              {/* Account Type Selector (Owner vs Agency) */}
              <div className="col-span-1 md:col-span-2">
                <label className="block text-sm font-semibold mb-2 text-[#111111]">
                  I am an:
                </label>
                <div 
                  className="grid grid-cols-2 gap-3 p-1.5 rounded-2xl"
                  style={{
                    background: 'rgba(0, 0, 0, 0.04)',
                    border: '1px solid rgba(0, 0, 0, 0.08)'
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, accountType: 'owner' })}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer"
                    style={{
                      backgroundColor: formData.accountType === 'owner' ? '#a3ffb1' : 'rgba(255, 255, 255, 0.45)',
                      color: formData.accountType === 'owner' ? '#111111' : '#555555',
                      fontWeight: formData.accountType === 'owner' ? 700 : 500,
                      boxShadow: formData.accountType === 'owner' ? '0 2px 10px rgba(163, 255, 177, 0.45)' : 'none',
                      border: formData.accountType === 'owner' ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(0, 0, 0, 0.06)'
                    }}
                  >
                    <User className="h-4 w-4" />
                    <span>Owner</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, accountType: 'agency' })}
                    className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer"
                    style={{
                      backgroundColor: formData.accountType === 'agency' ? '#a3ffb1' : 'rgba(255, 255, 255, 0.45)',
                      color: formData.accountType === 'agency' ? '#111111' : '#555555',
                      fontWeight: formData.accountType === 'agency' ? 700 : 500,
                      boxShadow: formData.accountType === 'agency' ? '0 2px 10px rgba(163, 255, 177, 0.45)' : 'none',
                      border: formData.accountType === 'agency' ? '1px solid rgba(0, 0, 0, 0.12)' : '1px solid rgba(0, 0, 0, 0.06)'
                    }}
                  >
                    <Building2 className="h-4 w-4" />
                    <span>Agency</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full font-bold py-4 px-6 rounded-xl transition-all duration-300 disabled:opacity-60 cursor-pointer shadow-md"
                style={{
                  backgroundColor: '#a3ffb1',
                  color: '#111111',
                  boxShadow: '0 4px 15px rgba(163, 255, 177, 0.5), inset 0 1px 0 rgba(255,255,255,0.6)',
                }}
              >
                {isSubmitting ? 'Securing Discount...' : 'Get Your Discount'}
              </button>
            </div>

            {/* Status Messages */}
            {status === 'success' && (
              <div className="mt-4 p-5 bg-[#e5fcf2] border border-[#a3ffb1] rounded-2xl text-green-900 text-sm font-medium shadow-sm flex flex-col gap-2 items-center text-center">
                <div className="flex items-center gap-2 font-bold text-base text-emerald-950">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span>Early Access & Discount Locked!</span>
                </div>
                <p>Thank you! Your spot is secured. You are locked in for our exclusive early-access discount when we launch.</p>
                <div className="mt-2 inline-block px-4 py-1.5 rounded-lg bg-emerald-100 border border-emerald-300 font-mono font-bold text-emerald-800 tracking-wider">
                  VIP Pass: {discountCode}
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-medium text-center shadow-sm">
                {errorMessage}
              </div>
            )}
          </form>
        </section>

        {/* See Omni in Action: the animated demo; its last chapter sends people back up to the form */}
        <section
          aria-labelledby="demo-heading"
          className="w-full max-w-xl rounded-3xl p-5 md:p-8 mt-8"
          style={{
            background: 'rgba(253, 251, 248, 0.65)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.6)',
            boxShadow: '0 15px 35px rgba(0, 0, 0, 0.04), inset 0 0 0 1px rgba(255, 255, 255, 0.3)'
          }}
        >
          <h2
            id="demo-heading"
            className="text-3xl font-semibold mb-5 text-center text-[#111111]"
            style={{ textShadow: '0 1px 1px rgba(255,255,255,0.8)' }}
          >
            See Omni in Action
          </h2>
          <DemoVideo onCta={scrollToForm} />
        </section>

        {/* Footer */}
        <footer className="mt-14 text-gray-400 text-sm font-medium text-center space-y-3">
          <p>&copy; {new Date().getFullYear()} Omni SDR. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-semibold text-gray-500">
            <Link href="/privacy" className="hover:text-[#111111] transition-colors underline-offset-4 hover:underline">Privacy Policy</Link>
            <span className="text-gray-300">•</span>
            <Link href="/terms" className="hover:text-[#111111] transition-colors underline-offset-4 hover:underline">Terms of Service</Link>
            <span className="text-gray-300">•</span>
            <Link href="/anti-spam" className="hover:text-[#111111] transition-colors underline-offset-4 hover:underline">Anti-Spam Policy</Link>
            <span className="text-gray-300">•</span>
            <Link href="/security" className="hover:text-[#111111] transition-colors underline-offset-4 hover:underline">Security Architecture</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
