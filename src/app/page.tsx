'use client';

import Link from 'next/link';
import { motion, type Variants } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Layers, ArrowRight, ShieldCheck, CreditCard, ArrowDownToLine, QrCode,
  BarChart3, Lock, Code2, CheckCircle2, Globe2, Zap,
} from 'lucide-react';

const features = [
  {
    icon: CreditCard,
    title: 'Accept Payments',
    description: 'Cards, mobile money, bank transfers and stablecoin rails — unified behind one API with idempotency and webhooks.',
  },
  {
    icon: ArrowDownToLine,
    title: 'Manage Payouts',
    description: 'Single or batch payouts to banks, MoMo wallets, or on-chain addresses with FX optimisation and proof of delivery.',
  },
  {
    icon: QrCode,
    title: 'QR Payments',
    description: 'Generate dynamic QR codes for in-store checkout. Trackable, refundable, and reconciled in real time.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    description: 'Live dashboards for revenue, corridor mix, top customers, settlement latency and FX cost — exported as CSV or API.',
  },
  {
    icon: ShieldCheck,
    title: 'Compliance',
    description: 'KYC, KYB, sanctions screening, AML alerts and SAR workflows built-in. Every action lands in an immutable audit log.',
  },
  {
    icon: Code2,
    title: 'Developer API',
    description: 'REST + webhooks with test keys, sandbox ledger, mock connectors and a deterministic replay engine for regressions.',
  },
];

const stats = [
  { label: 'Frozen kernel primitives', value: '7' },
  { label: 'Protocol modules', value: '20+' },
  { label: 'Corridor connectors', value: '14' },
  { label: 'Deterministic replays', value: '∞' },
];

const footerNav = [
  { heading: 'Product', links: ['Payments', 'Payouts', 'QR Codes', 'Analytics', 'API Reference'] },
  { heading: 'Company', links: ['About', 'Careers', 'Press', 'Partners', 'Contact'] },
  { heading: 'Resources', links: ['Documentation', 'Guides', 'Status', 'Changelog', 'Blog'] },
  { heading: 'Legal', links: ['Terms', 'Privacy', 'Compliance', 'Licenses', 'Security'] },
];

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <span className="text-sm font-bold tracking-tight">PaySwap</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#stats" className="hover:text-foreground">Platform</a>
            <a href="#footer" className="hover:text-foreground">Resources</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">
              <Link href="/waitlist">
                Get Started <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="absolute top-40 right-0 h-[28rem] w-[28rem] rounded-full bg-teal-500/10 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(16,185,129,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,185,129,0.15) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at top, black, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at top, black, transparent 70%)',
            }}
          />
        </div>

        <div className="mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            className="mx-auto flex max-w-3xl flex-col items-center text-center"
          >
            <motion.div variants={itemVariants}>
              <Badge
                variant="outline"
                className="mb-5 border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-600 dark:text-emerald-400"
              >
                <Zap className="h-3 w-3" />
                Protocol-layer financial infrastructure
              </Badge>
            </motion.div>

            <motion.h1
              variants={itemVariants}
              className="text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
            >
              Cross-border payments,{' '}
              <span className="bg-gradient-to-r from-emerald-500 to-teal-400 bg-clip-text text-transparent">
                settled.
              </span>
            </motion.h1>

            <motion.p
              variants={itemVariants}
              className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg"
            >
              Accept payments, manage payouts, and settle across borders with PaySwap&apos;s
              event-sourced settlement network — one API, every corridor, full audit trail.
            </motion.p>

            <motion.div variants={itemVariants} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">
                <Link href="/waitlist">
                  Get Started <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11">
                <Link href="/login">Sign in</Link>
              </Button>
            </motion.div>

            <motion.div
              variants={itemVariants}
              className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground"
            >
              {['SOC 2 ready', 'PSD2 aligned', 'Immutable audit log', '99.99% uptime target'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {t}
                </span>
              ))}
            </motion.div>
          </motion.div>

          {/* Floating dashboard preview */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto mt-16 max-w-4xl"
          >
            <Card className="overflow-hidden border-emerald-500/10 shadow-2xl">
              <CardContent className="p-0">
                <div className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-2.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <div className="ml-3 text-[11px] text-muted-foreground">payswap.io/dashboard</div>
                </div>
                <div className="grid gap-4 p-5 sm:grid-cols-3">
                  {[
                    { label: 'Revenue (30d)', value: 'GH₵ 184,920', trend: '+12.4%' },
                    { label: 'Transactions', value: '2,481', trend: '+8.1%' },
                    { label: 'Settled', value: '98.2%', trend: '+0.6%' },
                  ].map((s) => (
                    <div key={s.label} className="rounded-lg border bg-card p-4">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {s.label}
                      </div>
                      <div className="mt-1 text-xl font-semibold">{s.value}</div>
                      <div className="mt-1 text-[11px] text-emerald-500">{s.trend}</div>
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-5">
                  <div className="flex h-32 items-end gap-1.5 rounded-lg border bg-card p-4">
                    {[40, 55, 48, 62, 70, 58, 75, 80, 65, 88, 92, 78].map((h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t bg-gradient-to-t from-emerald-500/40 to-teal-400"
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-2xl text-center"
          >
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to move money
            </h2>
            <p className="mt-3 text-muted-foreground">
              From the first checkout to treasury rebalancing — PaySwap ships the full stack.
            </p>
          </motion.div>

          <motion.div
            variants={containerVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {features.map((f) => (
              <motion.div key={f.title} variants={itemVariants}>
                <Card className="h-full transition-colors hover:border-emerald-500/30">
                  <CardContent className="space-y-3 p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <f.icon className="h-5 w-5" />
                    </div>
                    <h3 className="text-base font-semibold">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section id="stats" className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-100px' }}
            transition={{ duration: 0.5 }}
            className="mx-auto max-w-2xl text-center"
          >
            <Badge variant="outline" className="mb-4 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Globe2 className="h-3 w-3" /> Built on a frozen kernel
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Engineered for deterministic settlement
            </h2>
            <p className="mt-3 text-muted-foreground">
              Every transaction flows through a frozen event-sourced kernel with full replay, audit
              and reconciliation built in.
            </p>
          </motion.div>

          <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
              >
                <Card className="border-emerald-500/10">
                  <CardContent className="space-y-1 p-6 text-center">
                    <div className="bg-gradient-to-r from-emerald-500 to-teal-400 bg-clip-text text-4xl font-bold text-transparent sm:text-5xl">
                      {s.value}
                    </div>
                    <div className="text-xs text-muted-foreground sm:text-sm">{s.label}</div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Trust strip */}
          <div className="mt-16 grid gap-4 sm:grid-cols-3">
            {[
              {
                icon: Lock,
                title: 'Non-custodial by design',
                body: 'MPC, HD wallets and hot/cold policies keep funds segregated and auditable.',
              },
              {
                icon: ShieldCheck,
                title: 'AML + sanctions built-in',
                body: 'Real-time screening, velocity rules, PEP checks and SAR case management.',
              },
              {
                icon: Zap,
                title: 'Sub-second finality',
                body: 'Pre-validated corridors settle in <800ms with proof of delivery.',
              },
            ].map((t) => (
              <div key={t.title} className="flex gap-3 rounded-xl border bg-card p-5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <t.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60 bg-gradient-to-b from-emerald-500/5 to-background">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="rounded-2xl border border-emerald-500/20 bg-card p-8 text-center shadow-xl sm:p-12"
          >
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ready to settle across borders?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
              Join the waitlist today. We&apos;re onboarding select merchants each week — every
              approved account ships with sandbox keys and a dedicated treasury contact.
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 bg-emerald-600 text-white hover:bg-emerald-700">
                <Link href="/waitlist">
                  Join the waitlist <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11">
                <Link href="/login">Sign in to your account</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer id="footer" className="border-t border-border/60 bg-background">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-1">
              <Link href="/" className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                  <Layers className="h-4 w-4" />
                </div>
                <span className="text-sm font-bold tracking-tight">PaySwap</span>
              </Link>
              <p className="mt-3 text-xs text-muted-foreground">
                Cross-border settlement infrastructure for the next wave of fintech.
              </p>
            </div>
            {footerNav.map((g) => (
              <div key={g.heading}>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.heading}
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {g.links.map((l) => (
                    <li key={l}>
                      <a href="#" className="text-muted-foreground hover:text-foreground">
                        {l}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <div>© {new Date().getFullYear()} PaySwap. All rights reserved.</div>
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                All systems operational
              </span>
              <span>Built in Accra · Lagos · Nairobi</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
