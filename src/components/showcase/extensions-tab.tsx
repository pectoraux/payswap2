'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Package, ShieldCheck, BadgeCheck, Cpu, Tag, Loader2,
} from 'lucide-react';
import { type ExtensionInfo, levelColor } from './shared';

function extIcon(cat: string): string {
  switch (cat) {
    case 'LOGISTICS': return '📦';
    case 'INVENTORY': return '📋';
    case 'LOYALTY': return '⭐';
    case 'ACCOUNTING': return '📒';
    case 'CRM': return '🤝';
    default: return '🧩';
  }
}

export function ExtensionsTab({ extensions }: { extensions: ExtensionInfo[] | undefined }) {
  if (!extensions) return null;
  return (
    <div className="space-y-4">
      <div className="mb-1 flex items-center gap-2">
        <Package className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-semibold">Reference extensions</h3>
        <span className="text-xs text-muted-foreground">— {extensions.length} first-party extensions built on the public SDK, each independently certified</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {extensions.map((ext) => (
          <Card key={ext.id} className="overflow-hidden border-emerald-500/10">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-lg">
                    {extIcon(ext.category)}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold leading-tight">{ext.name}</h4>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">v{ext.version}</span>
                      <span>·</span>
                      <span>{ext.publisher}</span>
                      {ext.publisherVerified && <BadgeCheck className="h-3 w-3 text-emerald-500" />}
                    </div>
                  </div>
                </div>
                <Badge className={levelColor(ext.certification.level)}>
                  <ShieldCheck className="mr-1 h-3 w-3" />
                  {ext.certification.level}
                </Badge>
              </div>

              <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{ext.description}</p>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">
                  <Cpu className="mr-1 h-2.5 w-2.5" /> {ext.capabilityCount} capabilities
                </Badge>
                <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{ext.license}</Badge>
                <Badge variant="outline" className="border-border px-1.5 py-0 text-[9px]">{ext.category}</Badge>
                {ext.tags.slice(0, 3).map((t) => (
                  <Badge key={t} variant="outline" className="border-border px-1.5 py-0 text-[9px] text-muted-foreground">
                    <Tag className="mr-1 h-2.5 w-2.5" />{t}
                  </Badge>
                ))}
              </div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Certification score</span>
                  <span className="font-semibold tabular-nums">{ext.certification.score}/100</span>
                </div>
                <Progress
                  value={ext.certification.score}
                  className="h-1.5 bg-muted [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-400"
                />
                <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="text-emerald-600 dark:text-emerald-400">{ext.certification.passed} passed</span>
                  {ext.certification.failed > 0 && <span className="text-rose-600">{ext.certification.failed} failed</span>}
                  {ext.certification.warnings > 0 && <span className="text-amber-600">{ext.certification.warnings} warnings</span>}
                  <span>· badge {ext.certification.badgeFingerprint}…</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function ExtensionsTabSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="border-emerald-500/10">
          <CardContent className="flex h-48 items-center justify-center p-5">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
