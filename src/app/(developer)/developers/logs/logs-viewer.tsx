'use client';

import * as React from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, Filter, ScrollText } from 'lucide-react';

interface LogEntry {
  id: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  source: string;
  action: string;
  message: string;
  result: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface Props {
  initialLogs: LogEntry[];
}

export type { LogEntry };

const LEVEL_TONE: Record<LogEntry['level'], string> = {
  INFO: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  WARN: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  ERROR: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function LogsViewer({ initialLogs }: Props) {
  const [logs, setLogs] = React.useState<LogEntry[]>(initialLogs);
  const [level, setLevel] = React.useState<string>('ALL');
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  // Debounce search.
  React.useEffect(() => {
    const t = setTimeout(() => {
      void reload();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, level]);

  async function reload() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (level !== 'ALL') params.set('level', level);
      if (query.trim()) params.set('q', query.trim());
      params.set('limit', '100');
      const res = await fetch(`/api/developer/logs?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (data.ok) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('[logs] reload failed:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="h-4 w-4 text-emerald-500" />
            Audit log
          </CardTitle>
          <CardDescription>
            Every authenticated action across the platform. Filter by level or search the message.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search action, source, or message…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="w-[140px]" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All levels</SelectItem>
                  <SelectItem value="INFO">INFO</SelectItem>
                  <SelectItem value="WARN">WARN</SelectItem>
                  <SelectItem value="ERROR">ERROR</SelectItem>
                </SelectContent>
              </Select>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ScrollText className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">No log entries</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Make an API call or run the simulator to populate the audit log.
              </p>
            </div>
          ) : (
            <ScrollArea className="max-h-[640px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Timestamp</th>
                    <th className="px-4 py-2 font-medium">Level</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                    <th className="px-4 py-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px] text-muted-foreground">
                        {fmtTime(l.createdAt)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_TONE[l.level]}`}>
                          {l.level}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px]">{l.source}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-[10px]">{l.action}</td>
                      <td className="px-4 py-2 text-[11px] text-muted-foreground">{l.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-[10px] text-muted-foreground">
        Showing the most recent {logs.length} entr{logs.length === 1 ? 'y' : 'ies'}.
      </p>

      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Refreshing…
            </>
          ) : (
            'Refresh'
          )}
        </Button>
      </div>
    </div>
  );
}
