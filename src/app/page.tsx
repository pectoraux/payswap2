'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Layers, ArrowRight, Network, Cpu, Package, Award, Truck, Activity, RefreshCw, Loader2, Zap,
} from 'lucide-react';
import { useShowcase, usePublicState } from '@/components/showcase/shared';
import { OverviewTab } from '@/components/showcase/overview-tab';
import { GraphTab } from '@/components/showcase/graph-tab';
import { ExtensionsTab, ExtensionsTabSkeleton } from '@/components/showcase/extensions-tab';
import { CertificationTab } from '@/components/showcase/certification-tab';
import { ParcelTab } from '@/components/showcase/parcel-tab';
import { LiveTab } from '@/components/showcase/live-tab';
import { ThemeToggle } from '@/components/showcase/theme-toggle';

export default function PlatformConsolePage() {
  const { data: showcase, loading, error, refetch } = useShowcase();
  const { data: pub } = usePublicState();
  const [tab, setTab] = useState('overview');

  const handleRefresh = () => {
    toast.loading('Refreshing platform data…', { id: 'refresh' });
    refetch();
    setTimeout(() => {
      toast.success('Platform data refreshed', { id: 'refresh' });
    }, 1200);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">PaySwap</span>
              <span className="text-[10px] text-muted-foreground">Economic Computation Platform</span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            {pub && (
              <Badge variant="outline" className="hidden border-emerald-500/30 px-2 py-1 text-[10px] text-emerald-600 dark:text-emerald-400 sm:inline-flex">
                <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                {pub.health.settlementSuccessRate}% settled
              </Badge>
            )}
            <ThemeToggle />
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
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 left-1/2 h-[28rem] w-[28rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
          <div className="absolute top-20 right-0 h-[22rem] w-[22rem] rounded-full bg-teal-500/10 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(16,185,129,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(16,185,129,0.15) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at top, black, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at top, black, transparent 70%)',
            }}
          />
        </div>
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }} className="mx-auto max-w-3xl text-center"
          >
            <Badge variant="outline" className="mb-4 border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-600 dark:text-emerald-400">
              <Zap className="h-3 w-3" /> Live platform console — explore the running system
            </Badge>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              An economic computation platform,{' '}
              <span className="bg-gradient-to-r from-emerald-500 to-teal-400 bg-clip-text text-transparent">
                fully observable.
              </span>
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm text-muted-foreground sm:text-base">
              Everything below is live — the Economic Knowledge Graph, the certification suite, the parcel-delivery
              engine and the formal invariants are all running right now. Run <code className="rounded bg-muted px-1 py-0.5 text-xs">prove()</code>,
              re-certify an extension, or plan a multi-hop delivery route.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {[
                `${showcase?.ekg.overview.nodeCount ?? '—'} graph nodes`,
                `${showcase?.extensions.length ?? '—'} certified extensions`,
                `${showcase?.ekg.overview.capabilityCount ?? '—'} capabilities`,
                `${pub?.health.globalScore.toFixed(1) ?? '—'} health score`,
              ].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t}
                </span>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Console */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {error ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/5 p-12 text-center">
            <p className="text-sm font-medium text-rose-600">Failed to load platform data</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={handleRefresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <div className="mb-6 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <TabsList className="h-auto flex-wrap gap-1 bg-muted/50 p-1">
                <TabsTrigger value="overview" className="gap-1.5 text-xs">
                  <Activity className="h-3.5 w-3.5" /> Overview
                </TabsTrigger>
                <TabsTrigger value="graph" className="gap-1.5 text-xs">
                  <Network className="h-3.5 w-3.5" /> Economic Graph
                </TabsTrigger>
                <TabsTrigger value="extensions" className="gap-1.5 text-xs">
                  <Package className="h-3.5 w-3.5" /> Extensions
                </TabsTrigger>
                <TabsTrigger value="certification" className="gap-1.5 text-xs">
                  <Award className="h-3.5 w-3.5" /> Certification
                </TabsTrigger>
                <TabsTrigger value="parcel" className="gap-1.5 text-xs">
                  <Truck className="h-3.5 w-3.5" /> Parcel Delivery
                </TabsTrigger>
                <TabsTrigger value="live" className="gap-1.5 text-xs">
                  <Zap className="h-3.5 w-3.5" /> Live Testing
                </TabsTrigger>
              </TabsList>
              <Button
                size="sm" variant="ghost" onClick={handleRefresh} disabled={loading}
                className="h-8 text-xs text-muted-foreground"
              >
                {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>

            <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
              {loading ? <OverviewSkeleton /> : <OverviewTab showcase={showcase} pub={pub} />}
            </TabsContent>
            <TabsContent value="graph" className="mt-0 focus-visible:outline-none">
              {loading ? <GraphSkeleton /> : <GraphTab showcase={showcase} />}
            </TabsContent>
            <TabsContent value="extensions" className="mt-0 focus-visible:outline-none">
              {loading ? <ExtensionsTabSkeleton /> : <ExtensionsTab extensions={showcase?.extensions} />}
            </TabsContent>
            <TabsContent value="certification" className="mt-0 focus-visible:outline-none">
              {loading ? <CertSkeleton /> : <CertificationTab reports={showcase?.certifications} />}
            </TabsContent>
            <TabsContent value="parcel" className="mt-0 focus-visible:outline-none">
              {loading ? <ParcelSkeleton /> : <ParcelTab showcase={showcase} />}
            </TabsContent>
            <TabsContent value="live" className="mt-0 focus-visible:outline-none">
              <LiveTab />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Footer (sticky to bottom) */}
      <footer className="mt-auto border-t border-border/60 bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <div>
                <div className="text-sm font-bold">PaySwap</div>
                <div className="text-[11px] text-muted-foreground">Economic computation for the real economy</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> All systems operational
              </span>
              <span>Built in Accra · Lagos · Nairobi</span>
              <span>© {new Date().getFullYear()} PaySwap</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  );
}
function GraphSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
      <Skeleton className="h-80 w-full rounded-xl lg:col-span-3" />
    </div>
  );
}
function CertSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Skeleton className="h-96 w-full rounded-xl lg:col-span-2" />
      <Skeleton className="h-96 w-full rounded-xl lg:col-span-3" />
    </div>
  );
}
function ParcelSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  );
}
