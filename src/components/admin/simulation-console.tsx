'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  CreditCard,
  ArrowDownToLine,
  ShieldAlert,
  AlertTriangle,
  Activity,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

interface ConsoleMessage {
  id: string;
  scenario: string;
  status: 'success' | 'info' | 'error';
  message: string;
  ts: Date;
}

interface Scenario {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  endpoint: string | null; // null = info-only (no API call)
  variant: 'default' | 'outline' | 'destructive';
  tone: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: 'payment',
    label: 'Process test payment',
    description: 'Creates a COMPLETED Payment record against the first merchant.',
    icon: <CreditCard className="h-4 w-4" />,
    endpoint: '/api/admin/simulate/payment',
    variant: 'default',
    tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'payout',
    label: 'Process test payout',
    description: 'Creates a COMPLETED Payout record for settlement testing.',
    icon: <ArrowDownToLine className="h-4 w-4" />,
    endpoint: '/api/admin/simulate/payout',
    variant: 'default',
    tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    id: 'aml',
    label: 'Generate AML alert',
    description: 'Creates an OPEN AMLAlert with a random type & severity.',
    icon: <ShieldAlert className="h-4 w-4" />,
    endpoint: '/api/admin/simulate/aml',
    variant: 'default',
    tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    id: 'lp-default',
    label: 'Simulate LP default',
    description: 'Simulates a liquidity provider missing a settlement window.',
    icon: <AlertTriangle className="h-4 w-4" />,
    endpoint: null,
    variant: 'outline',
    tone: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  {
    id: 'stress',
    label: 'Run stress test',
    description: 'Simulates a 10× traffic spike across all corridors.',
    icon: <Activity className="h-4 w-4" />,
    endpoint: null,
    variant: 'outline',
    tone: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  },
];

const INFO_MESSAGES: Record<string, string> = {
  'lp-default':
    'LP default scenario queued: marking LP_001 as DEFAULTED — collateral liquidation workflow would now run.',
  stress:
    'Stress test started: simulating 1,000 concurrent payments across 8 corridors for 60s. Results will be logged to the metrics dashboard.',
};

export function SimulationConsole() {
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const runScenario = async (s: Scenario) => {
    setPending(s.id);

    // Info-only scenarios — no API call.
    if (!s.endpoint) {
      const msg: ConsoleMessage = {
        id: `${s.id}-${Date.now()}`,
        scenario: s.label,
        status: 'info',
        message: INFO_MESSAGES[s.id] || 'Scenario simulated.',
        ts: new Date(),
      };
      setMessages((m) => [msg, ...m]);
      toast.success(s.label, {
        description: 'Scenario simulated (no DB write).',
      });
      setPending(null);
      return;
    }

    try {
      const res = await fetch(s.endpoint, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        const msg: ConsoleMessage = {
          id: `${s.id}-${Date.now()}`,
          scenario: s.label,
          status: 'error',
          message: data?.error || `Request failed (${res.status})`,
          ts: new Date(),
        };
        setMessages((m) => [msg, ...m]);
        toast.error(s.label, {
          description: data?.error || 'Scenario failed.',
        });
      } else {
        const msg: ConsoleMessage = {
          id: `${s.id}-${Date.now()}`,
          scenario: s.label,
          status: 'success',
          message: data?.message || 'Scenario completed.',
          ts: new Date(),
        };
        setMessages((m) => [msg, ...m]);
        toast.success(s.label, {
          description: data?.message || 'Scenario completed.',
        });
      }
    } catch (err) {
      const msg: ConsoleMessage = {
        id: `${s.id}-${Date.now()}`,
        scenario: s.label,
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error',
        ts: new Date(),
      };
      setMessages((m) => [msg, ...m]);
      toast.error(s.label, {
        description: 'Network error.',
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SCENARIOS.map((s) => (
          <div
            key={s.id}
            className="flex flex-col gap-3 rounded-lg border bg-card/50 p-4"
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${s.tone}`}
              >
                {s.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{s.label}</div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
              </div>
            </div>
            <Button
              variant={s.variant}
              size="sm"
              className="w-full"
              disabled={pending !== null}
              onClick={() => runScenario(s)}
            >
              {pending === s.id ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {pending === s.id ? 'Running…' : 'Run'}
            </Button>
          </div>
        ))}
      </div>

      {/* Activity log */}
      <div className="rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 border-b px-4 py-2.5">
          <Activity className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Simulation activity
          </span>
        </div>
        <div className="max-h-80 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                <Activity className="h-5 w-5 text-emerald-500" />
              </div>
              <h3 className="mt-3 text-sm font-semibold">No activity yet</h3>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                Run a scenario above to start the simulation log.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-2.5 rounded-md border bg-background px-3 py-2 text-xs"
                >
                  <span className="mt-0.5 shrink-0">
                    {m.status === 'success' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    ) : m.status === 'error' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                    ) : (
                      <Activity className="h-3.5 w-3.5 text-cyan-500" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{m.scenario}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(m.ts).toLocaleTimeString('en-US', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{m.message}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
