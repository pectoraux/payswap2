'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  API_DOC_GROUPS,
  AUTH_LABELS,
  type EndpointDoc,
  type EndpointGroup,
  type HttpMethod,
} from '@/lib/api-docs-data';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  BookOpen,
  Search,
  ChevronRight,
  Copy,
  Check,
  Lock,
  Server,
  Terminal,
  Code2,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

const methodTone: Record<HttpMethod, string> = {
  GET: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  POST: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30',
  PATCH: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
  DELETE: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
};

const authTone: Record<string, string> = {
  session: 'text-muted-foreground',
  merchant: 'text-emerald-600 dark:text-emerald-400',
  admin: 'text-violet-600 dark:text-violet-400',
  lp: 'text-amber-600 dark:text-amber-400',
  treasury: 'text-teal-600 dark:text-teal-400',
  public: 'text-muted-foreground',
};

type Lang = 'curl' | 'node' | 'python';

const LANG_TABS: { id: Lang; label: string; icon: React.ReactNode }[] = [
  { id: 'curl', label: 'curl', icon: <Terminal className="h-3.5 w-3.5" /> },
  { id: 'node', label: 'Node', icon: <Code2 className="h-3.5 w-3.5" /> },
  { id: 'python', label: 'Python', icon: <Code2 className="h-3.5 w-3.5" /> },
];

function flattenEndpoints(): Array<EndpointDoc & { groupId: string; groupLabel: string }> {
  const out: Array<EndpointDoc & { groupId: string; groupLabel: string }> = [];
  for (const g of API_DOC_GROUPS) {
    for (const e of g.endpoints) {
      out.push({ ...e, groupId: g.id, groupLabel: g.label });
    }
  }
  return out;
}

export default function DeveloperDocsPage() {
  const allEndpoints = React.useMemo(() => flattenEndpoints(), []);
  const [activeId, setActiveId] = React.useState<string>(allEndpoints[0]?.id ?? '');
  const [query, setQuery] = React.useState('');

  const filteredGroups: EndpointGroup[] = React.useMemo(() => {
    if (!query.trim()) return API_DOC_GROUPS;
    const q = query.trim().toLowerCase();
    return API_DOC_GROUPS.map((g) => ({
      ...g,
      endpoints: g.endpoints.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          g.label.toLowerCase().includes(q),
      ),
    })).filter((g) => g.endpoints.length > 0);
  }, [query]);

  const active =
    allEndpoints.find((e) => e.id === activeId) ?? allEndpoints[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-card to-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10">
            <BookOpen className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight">API reference</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              The PaySwap REST API is organized around{' '}
              <span className="font-medium text-foreground">REST</span>, accepts{' '}
              <span className="font-medium text-foreground">JSON</span> request
              bodies, returns <span className="font-medium text-foreground">JSON</span>{' '}
              responses, and uses standard HTTP response codes.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/5">
                <Server className="h-3 w-3" />
                Base URL: <code className="font-mono">https://api.payswap.io</code>
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" />
                Bearer token auth
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Webhook className="h-3 w-3" />
                Webhooks signed with HMAC-SHA256
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* ───────── Sidebar ───────── */}
        <aside className="lg:col-span-3">
          <div className="lg:sticky lg:top-6 space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search endpoints…"
                className="h-9 pl-8"
              />
            </div>
            <Card className="overflow-hidden">
              <ScrollArea className="h-[calc(100vh-220px)] min-h-[300px]">
                <nav className="p-2">
                  {filteredGroups.length === 0 && (
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      No endpoints match &quot;{query}&quot;.
                    </div>
                  )}
                  {filteredGroups.map((g) => (
                    <div key={g.id} className="mb-3">
                      <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {g.label}
                      </div>
                      <ul className="space-y-0.5">
                        {g.endpoints.map((e) => {
                          const isActive = e.id === activeId;
                          return (
                            <li key={e.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveId(e.id);
                                  if (typeof window !== 'undefined') {
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                  }
                                }}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                                  isActive
                                    ? 'bg-emerald-500/10 text-foreground'
                                    : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                                }`}
                              >
                                <Badge
                                  variant="outline"
                                  className={`shrink-0 px-1 py-0 font-mono text-[9px] ${methodTone[e.method]}`}
                                >
                                  {e.method}
                                </Badge>
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {e.title}
                                </span>
                                {isActive && (
                                  <ChevronRight className="h-3 w-3 shrink-0 text-emerald-600" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </nav>
              </ScrollArea>
            </Card>
          </div>
        </aside>

        {/* ───────── Main content ───────── */}
        <section className="lg:col-span-9">
          {active && <EndpointDetail endpoint={active} />}
        </section>
      </div>
    </div>
  );
}

function EndpointDetail({
  endpoint,
}: {
  endpoint: EndpointDoc & { groupId?: string; groupLabel?: string };
}) {
  return (
    <motion.div
      key={endpoint.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-6"
    >
      {/* Endpoint header */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`px-2 py-1 font-mono text-[11px] ${methodTone[endpoint.method]}`}
            >
              {endpoint.method}
            </Badge>
            <code className="font-mono text-sm font-semibold">{endpoint.path}</code>
          </div>
          <CardTitle className="text-xl">{endpoint.title}</CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            {endpoint.description}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2 text-[11px]">
            <span className="text-muted-foreground">Auth:</span>
            <Badge variant="outline" className={`gap-1 ${authTone[endpoint.auth]}`}>
              <Lock className="h-3 w-3" />
              {AUTH_LABELS[endpoint.auth]}
            </Badge>
          </div>
        </CardHeader>
      </Card>

      {/* Parameters */}
      {endpoint.params.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parameters</CardTitle>
            <CardDescription>
              {endpoint.method === 'GET'
                ? 'Query parameters'
                : 'Body parameters (JSON)'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Name</th>
                    <th className="px-3 py-2 text-left font-semibold">Type</th>
                    <th className="px-3 py-2 text-left font-semibold">Required</th>
                    <th className="px-3 py-2 text-left font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {endpoint.params.map((p) => (
                    <tr key={p.name} className="align-top">
                      <td className="px-3 py-2">
                        <code className="font-mono text-xs font-medium">{p.name}</code>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {p.type}
                      </td>
                      <td className="px-3 py-2">
                        {p.required ? (
                          <Badge
                            variant="outline"
                            className="border-rose-500/30 bg-rose-500/5 px-1.5 py-0 text-[10px] text-rose-600 dark:text-rose-400"
                          >
                            required
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            optional
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <p>{p.description}</p>
                        {p.enum && p.enum.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {p.enum.map((v) => (
                              <code
                                key={v}
                                className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px]"
                              >
                                {v}
                              </code>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request example */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Request example</CardTitle>
          <CardDescription>
            Copy and paste — replace <code className="font-mono">psk_live_xxx</code>{' '}
            with your secret API key.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CodeTabs
            snippets={[
              { lang: 'curl', code: endpoint.curl },
              { lang: 'node', code: endpoint.node },
              { lang: 'python', code: endpoint.python },
            ]}
          />
        </CardContent>
      </Card>

      {/* Response examples */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Response</CardTitle>
          <CardDescription>
            Sample responses with HTTP status codes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {endpoint.responses.map((r) => (
            <ResponseBlock key={`${r.status}-${r.label}`} response={r} />
          ))}
        </CardContent>
      </Card>

      <Separator />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Need help? Email{' '}
          <a
            href="mailto:developers@payswap.io"
            className="font-medium text-emerald-600 hover:underline"
          >
            developers@payswap.io
          </a>
          .
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href="/developers/explorer">Try this in the API explorer →</Link>
        </Button>
      </div>
    </motion.div>
  );
}

function CodeTabs({
  snippets,
}: {
  snippets: { lang: Lang; code: string }[];
}) {
  const [active, setActive] = React.useState<Lang>('curl');
  const [copied, setCopied] = React.useState(false);

  const current = snippets.find((s) => s.lang === active) ?? snippets[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card/50">
      <div className="flex items-center justify-between border-b bg-muted/30 px-2 py-1">
        <div className="flex gap-0.5">
          {LANG_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActive(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                active === t.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={copy}
          className="h-7 gap-1.5 px-2 text-[11px]"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-600" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-[420px] overflow-auto p-4 text-[11px] leading-relaxed">
        <code className="font-mono text-foreground">{current.code}</code>
      </pre>
    </div>
  );
}

function ResponseBlock({
  response,
}: {
  response: { status: number; label: string; body: string };
}) {
  const tone =
    response.status >= 200 && response.status < 300
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400'
      : response.status >= 400 && response.status < 500
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400'
        : response.status >= 500
          ? 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400'
          : 'border-border bg-muted/30 text-muted-foreground';

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="outline" className={`font-mono text-[10px] ${tone}`}>
          {response.status}
        </Badge>
        <span className="text-xs font-medium text-muted-foreground">
          {response.label}
        </span>
      </div>
      <pre className="max-h-[300px] overflow-auto rounded-lg border bg-card/50 p-4 text-[11px] leading-relaxed">
        <code className="font-mono text-foreground">{response.body}</code>
      </pre>
    </div>
  );
}
