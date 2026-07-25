'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Layers, ArrowRight, Shield, Zap, Globe, CreditCard, BarChart3, Code2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow">
              <Layers className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight">PaySwap</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Link href="/waitlist">Get Started <ArrowRight className="ml-1.5 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-teal-500/10" />
        <div className="relative mx-auto max-w-4xl px-4 py-24 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-4 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Now accepting early access partners
            </div>
            <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
              Cross-border payments,<br /><span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">settled.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Accept payments, manage payouts, and settle across borders. PaySwap is a protocol-layer financial network built on a frozen 7-primitive kernel — designed for regulated cross-border settlement.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Link href="/waitlist">Join the waitlist <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">Everything you need to accept payments</h2>
            <p className="mt-2 text-muted-foreground">From checkout to settlement, in one platform.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: <CreditCard className="h-6 w-6" />, title: 'Accept Payments', desc: 'QR codes, payment links, hosted checkout, and embedded widgets.' },
              { icon: <ArrowRight className="h-6 w-6" />, title: 'Manage Payouts', desc: 'Bank transfers, mobile money, and on-chain withdrawals.' },
              { icon: <Shield className="h-6 w-6" />, title: 'Compliance Built-in', desc: 'AML, KYC, KYB, sanctions screening, and SAR filing.' },
              { icon: <BarChart3 className="h-6 w-6" />, title: 'Analytics & Reports', desc: 'Real-time dashboards, financial reports, and exports.' },
              { icon: <Code2 className="h-6 w-6" />, title: 'Developer API', desc: 'REST API, webhooks, SDKs, and a full sandbox.' },
              { icon: <Globe className="h-6 w-6" />, title: 'Multi-currency', desc: 'GHS, KES, NGN, USD, ZAR, UGX, TZS — and growing.' },
            ].map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}>
                <div className="rounded-xl border border-emerald-500/10 bg-card p-6 transition-colors hover:border-emerald-500/30">
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{f.icon}</div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t bg-card py-16">
        <div className="mx-auto max-w-4xl px-4">
          <div className="grid grid-cols-2 gap-8 text-center sm:grid-cols-4">
            {[
              { value: '7', label: 'Frozen kernel primitives' },
              { value: '20+', label: 'Protocol modules' },
              { value: '13', label: 'Provider connectors' },
              { value: '99.9%', label: 'Settlement SLA target' },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">{s.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2"><Layers className="h-4 w-4" /> PaySwap</div>
          <div>© 2026 PaySwap. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
}
