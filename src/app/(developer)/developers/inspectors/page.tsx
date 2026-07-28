import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/role-ui';
import {
  Database,
  Terminal,
  History,
  ArrowLeftRight,
  Users2,
  Scale,
  Landmark,
  Layers,
  ArrowRight,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

const INSPECTORS = [
  {
    name: 'events',
    href: '/developers/inspectors/events',
    title: 'Event Explorer',
    description: 'Every domain event with sequence, aggregate ID, type, version, payload, and timestamp. Filter, paginate, and expand any row to inspect the full payload.',
    icon: Database,
    accent: 'emerald',
  },
  {
    name: 'commands',
    href: '/developers/inspectors/commands',
    title: 'Command Explorer',
    description: 'The command registry — every command type the runtime accepts, its schema, description, and recent invocations.',
    icon: Terminal,
    accent: 'teal',
  },
  {
    name: 'replay',
    href: '/developers/inspectors/replay',
    title: 'Replay Explorer',
    description: 'Reconstruct the system state at any point in time. Replay events up to a sequence number, compare with current state.',
    icon: History,
    accent: 'cyan',
  },
  {
    name: 'settlement',
    href: '/developers/inspectors/settlement',
    title: 'Settlement Actors',
    description: 'Active and recent settlement contracts — workflow stages, escrow status, LP assignments, stage timeline per settlement.',
    icon: ArrowLeftRight,
    accent: 'violet',
  },
  {
    name: 'council',
    href: '/developers/inspectors/council',
    title: 'Economic Council',
    description: 'Recent council sessions — strategies debated, weighted consensus scores, director opinions and rationale.',
    icon: Users2,
    accent: 'orange',
  },
  {
    name: 'constitution',
    href: '/developers/inspectors/constitution',
    title: 'Constitution',
    description: 'All economic invariants and their current pass/fail status, plus recent violations with severity and detail.',
    icon: Scale,
    accent: 'amber',
  },
  {
    name: 'ledger',
    href: '/developers/inspectors/ledger',
    title: 'Economic Ledger',
    description: 'The canonical balance sheet — assets, liabilities, equity, solvency ratios, accounts, and journal entries.',
    icon: Landmark,
    accent: 'rose',
  },
  {
    name: 'treasury-lp',
    href: '/developers/inspectors/treasury-lp',
    title: 'Treasury & LP',
    description: 'Treasury reserves by country, twin token supply, solvency. Liquidity provider network — positions, bandwidth, reputation.',
    icon: Layers,
    accent: 'emerald',
  },
] as const;

const accentMap: Record<string, { bg: string; hover: string }> = {
  emerald: { bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', hover: 'hover:border-emerald-500/40 hover:bg-emerald-500/5' },
  teal: { bg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400', hover: 'hover:border-teal-500/40 hover:bg-teal-500/5' },
  cyan: { bg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', hover: 'hover:border-cyan-500/40 hover:bg-cyan-500/5' },
  violet: { bg: 'bg-violet-500/10 text-violet-600 dark:text-violet-400', hover: 'hover:border-violet-500/40 hover:bg-violet-500/5' },
  orange: { bg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400', hover: 'hover:border-orange-500/40 hover:bg-orange-500/5' },
  amber: { bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', hover: 'hover:border-amber-500/40 hover:bg-amber-500/5' },
  rose: { bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', hover: 'hover:border-rose-500/40 hover:bg-rose-500/5' },
};

export default async function InspectorsIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inspectors"
        description="Read-only views into the runtime kernel — events, commands, replay, settlement, council, constitution, ledger, treasury, and LPs."
      />

      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent">
        <CardContent className="p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold">The kernel is observable</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every subsystem in <code className="rounded bg-muted px-1 py-0.5 text-xs">src/runtime/</code> exposes
                its internal state. These inspectors read directly from the runtime singleton — no snapshots, no
                polling, no caching. What you see is the live, in-memory truth.
              </p>
            </div>
            <div className="shrink-0 rounded-lg border bg-card/50 px-4 py-3 text-xs">
              <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                Subsystems exposed
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{INSPECTORS.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {INSPECTORS.map((insp) => {
          const Icon = insp.icon;
          const accent = accentMap[insp.accent];
          return (
            <Link
              key={insp.name}
              href={insp.href}
              className={`group rounded-xl border bg-card p-5 transition-colors ${accent.hover}`}
            >
              <div className="flex items-center justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent.bg}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <div className="mt-4 text-base font-semibold">{insp.title}</div>
              <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {insp.description}
              </div>
              <div className="mt-3 font-mono text-[10px] text-muted-foreground">
                /developers/inspectors/{insp.name}
              </div>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to read from the runtime</CardTitle>
          <CardDescription>
            Every inspector hits an API endpoint that imports the runtime singleton.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="max-h-64 overflow-y-auto rounded-lg border bg-muted/50 p-4 text-xs leading-relaxed">
{`import { runtime } from '@/runtime';

// The runtime is a frozen kernel — only READ from it.
const events = await runtime.eventStore.readAll(0, 100);
const report = runtime.invariants.report();
const balance = runtime.ledger.getBalanceSheet();
const decisions = runtime.council.getDecisions();
const actors = runtime.settlementOrchestrator.list();
const accounts = await runtime.treasury.list();
const lps = runtime.lpRuntime.listLPs();
const commands = runtime.commands.types();`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
