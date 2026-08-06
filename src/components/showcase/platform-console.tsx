'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Layers, Network, Cpu, Package, Award, Truck, Activity, RefreshCw, Loader2, Zap, DollarSign,
} from 'lucide-react';
import { useShowcase, usePublicState } from '@/components/showcase/shared';
import { OverviewTab } from '@/components/showcase/overview-tab';
import { GraphTab } from '@/components/showcase/graph-tab';
import { ExtensionsTab, ExtensionsTabSkeleton } from '@/components/showcase/extensions-tab';
import { CertificationTab } from '@/components/showcase/certification-tab';
import { ParcelTab } from '@/components/showcase/parcel-tab';
import { LiveTab } from '@/components/showcase/live-tab';
import { SimulationTab } from '@/components/showcase/simulation-tab';
import { FinancialModelTab } from '@/components/showcase/financial-model-tab';
import { ThemeToggle } from '@/components/showcase/theme-toggle';

/**
 * The PaySwap Platform Console — a live, interactive view of the entire
 * platform: EKG, 5 reference extensions, certification suite, parcel-delivery
 * engine, resolve() planner, and live PSP/Stellar/Maps testing.
 *
 * Rendered inside the admin shell at /admin/console.
 */
export function PlatformConsole() {
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
    <div className="space-y-6">
      {/* Console header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
              <Layers className="h-4 w-4" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">Live Platform Console</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Interactive view of the running system — EKG, extensions, certifications, parcel delivery, and live PSP/Stellar/Maps tests.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pub && (
            <Badge variant="outline" className="border-emerald-500/30 px-2 py-1 text-[10px] text-emerald-600 dark:text-emerald-400">
              <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {pub.health.settlementSuccessRate}% settled
            </Badge>
          )}
          <ThemeToggle />
          <Button
            size="sm" variant="outline" onClick={handleRefresh} disabled={loading}
            className="h-8 text-xs"
          >
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Live stats strip */}
      <motion.div
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 px-4 py-2.5 text-xs text-muted-foreground"
      >
        <span className="font-semibold text-foreground">Live stats:</span>
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
      </motion.div>

      {/* Console body */}
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
            <TabsTrigger value="sim" className="gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" /> Simulation
            </TabsTrigger>
            <TabsTrigger value="finance" className="gap-1.5 text-xs">
              <DollarSign className="h-3.5 w-3.5" /> Financial Model
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 focus-visible:outline-none">
            {loading ? <OverviewSkeleton /> : <OverviewTab showcase={showcase} pub={pub} />}
          </TabsContent>
          <TabsContent value="graph" className="mt-4 focus-visible:outline-none">
            {loading ? <GraphSkeleton /> : <GraphTab showcase={showcase} />}
          </TabsContent>
          <TabsContent value="extensions" className="mt-4 focus-visible:outline-none">
            {loading ? <ExtensionsTabSkeleton /> : <ExtensionsTab extensions={showcase?.extensions} />}
          </TabsContent>
          <TabsContent value="certification" className="mt-4 focus-visible:outline-none">
            {loading ? <CertSkeleton /> : <CertificationTab reports={showcase?.certifications} />}
          </TabsContent>
          <TabsContent value="parcel" className="mt-4 focus-visible:outline-none">
            {loading ? <ParcelSkeleton /> : <ParcelTab showcase={showcase} />}
          </TabsContent>
          <TabsContent value="live" className="mt-4 focus-visible:outline-none">
            <LiveTab />
          </TabsContent>
          <TabsContent value="sim" className="mt-4 focus-visible:outline-none">
            <SimulationTab />
          </TabsContent>
          <TabsContent value="finance" className="mt-4 focus-visible:outline-none">
            <FinancialModelTab />
          </TabsContent>
        </Tabs>
      )}
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
