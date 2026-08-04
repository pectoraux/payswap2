'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck, Loader2, Play, KeyRound, CheckCircle2, XCircle, AlertCircle, Award,
} from 'lucide-react';
import {
  type CertificationReport, type VerifyBadgeResult, type CertifyResult,
  levelColor, checkResultColor, postShowcase,
} from './shared';

const CATEGORIES = ['STRUCTURAL', 'SECURITY', 'PERFORMANCE', 'ECONOMIC', 'COMPLIANCE', 'OPERATIONAL'] as const;
const CAT_COLOR: Record<string, string> = {
  STRUCTURAL: 'border-sky-500/30 bg-sky-500/5 text-sky-600 dark:text-sky-400',
  SECURITY: 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400',
  PERFORMANCE: 'border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400',
  ECONOMIC: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  COMPLIANCE: 'border-violet-500/30 bg-violet-500/5 text-violet-600 dark:text-violet-400',
  OPERATIONAL: 'border-teal-500/30 bg-teal-500/5 text-teal-600 dark:text-teal-400',
};

export function CertificationTab({ reports }: { reports: CertificationReport[] | undefined }) {
  const [selectedId, setSelectedId] = useState<string | null>(reports?.[0]?.extensionId ?? null);
  const [liveReport, setLiveReport] = useState<CertifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<Record<string, VerifyBadgeResult>>({});
  const [verifying, setVerifying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedReport = liveReport?.report ?? reports?.find((r) => r.extensionId === selectedId);

  async function runCertify(extensionId: string) {
    setSelectedId(extensionId);
    setLoading(true); setError(null); setLiveReport(null);
    toast.loading('Running 15 certification checks…', { id: 'certify' });
    try {
      const r = await postShowcase<CertifyResult>({ action: 'certify', extensionId });
      setLiveReport(r);
      if (r.report.level === 'CERTIFIED') {
        toast.success(`${r.extension.name} v${r.extension.version} — CERTIFIED. ${r.report.passed}/${r.report.totalChecks} checks, score ${r.report.score}/100.`, { id: 'certify' });
      } else if (r.report.level === 'CONDITIONAL') {
        toast.warning(`${r.extension.name} — CONDITIONAL. ${r.report.passed}/${r.report.totalChecks} passed, ${r.report.failed} failed.`, { id: 'certify' });
      } else {
        toast.error(`${r.extension.name} — REJECTED. ${r.report.failed} critical checks failed.`, { id: 'certify' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'certify failed';
      setError(msg);
      toast.error(`Certification failed: ${msg}`, { id: 'certify' });
    } finally {
      setLoading(false);
    }
  }

  async function runVerify(extensionId: string) {
    setVerifying(extensionId);
    toast.loading('Verifying RSA-SHA256 badge signature…', { id: 'verify' });
    try {
      const r = await postShowcase<VerifyBadgeResult>({ action: 'verifyBadge', extensionId });
      setVerifyResult((p) => ({ ...p, [extensionId]: r }));
      if (r.valid) {
        toast.success('Badge signature valid — issued by PaySwap', { id: 'verify' });
      } else {
        toast.error(`Badge signature invalid — ${r.error ?? 'may be forged'}`, { id: 'verify' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'verify failed';
      setVerifyResult((p) => ({ ...p, [extensionId]: { ok: false, extensionId, valid: false, message: msg } }));
      toast.error(`Verification failed: ${msg}`, { id: 'verify' });
    } finally {
      setVerifying(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="mb-1 flex items-center gap-2">
        <Award className="h-4 w-4 text-emerald-500" />
        <h3 className="text-sm font-semibold">Certification suite</h3>
        <span className="text-xs text-muted-foreground">— 15 automated checks, cryptographically signed badges (RSA-SHA256). Re-run any extension live.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Extension list */}
        <Card className="border-emerald-500/10 lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Certified extensions</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[28rem] pr-3">
              <div className="space-y-2">
                {reports?.map((r) => (
                  <button
                    key={r.extensionId}
                    onClick={() => { setSelectedId(r.extensionId); setLiveReport(null); setError(null); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left transition-colors ${
                      selectedId === r.extensionId ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-border/60 hover:border-emerald-500/30 hover:bg-muted/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold">{r.extensionName}</div>
                      <div className="text-[10px] text-muted-foreground">v{r.version} · {r.passed}/{r.totalChecks} checks</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className={levelColor(r.level)}>{r.level}</Badge>
                      <span className="text-[10px] font-semibold tabular-nums">{r.score}/100</span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Selected report */}
        <Card className="border-emerald-500/10 lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                {selectedReport?.extensionName ?? 'Select an extension'}
              </CardTitle>
              {selectedReport && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm" variant="outline"
                    className="h-7 border-emerald-500/30 text-xs text-emerald-600 hover:bg-emerald-500/10"
                    onClick={() => runCertify(selectedReport.extensionId)}
                    disabled={loading}
                  >
                    {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                    {loading ? 'Running…' : 'Re-run 15 checks'}
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 text-xs"
                    onClick={() => runVerify(selectedReport.extensionId)}
                    disabled={verifying === selectedReport.extensionId}
                  >
                    {verifying === selectedReport.extensionId ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <KeyRound className="mr-1 h-3 w-3" />}
                    Verify badge
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-600">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            )}
            {liveReport?.message && (
              <div className="mb-3 rounded-md bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                {liveReport.message}
              </div>
            )}
            {verifyResult[selectedReport?.extensionId ?? ''] && (
              <div className={`mb-3 flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                verifyResult[selectedReport!.extensionId].valid
                  ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600'
                  : 'border-rose-500/30 bg-rose-500/5 text-rose-600'
              }`}>
                {verifyResult[selectedReport!.extensionId].valid
                  ? <CheckCircle2 className="h-4 w-4" />
                  : <XCircle className="h-4 w-4" />}
                {verifyResult[selectedReport!.extensionId].message}
              </div>
            )}

            {selectedReport ? (
              <>
                <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2">
                    <div className="text-lg font-bold text-emerald-600 tabular-nums">{selectedReport.passed}</div>
                    <div className="text-[10px] text-muted-foreground">passed</div>
                  </div>
                  <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-2">
                    <div className="text-lg font-bold text-rose-600 tabular-nums">{selectedReport.failed}</div>
                    <div className="text-[10px] text-muted-foreground">failed</div>
                  </div>
                  <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2">
                    <div className="text-lg font-bold text-amber-600 tabular-nums">{selectedReport.warnings}</div>
                    <div className="text-[10px] text-muted-foreground">warnings</div>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <div className="text-lg font-bold tabular-nums">{selectedReport.totalChecks}</div>
                    <div className="text-[10px] text-muted-foreground">total</div>
                  </div>
                </div>

                <Separator className="mb-3" />

                {/* Group checks by category */}
                {CATEGORIES.map((cat) => {
                  const checks = selectedReport.checks.filter((c) => c.category === cat);
                  if (checks.length === 0) return null;
                  return (
                    <div key={cat} className="mb-3">
                      <div className="mb-1.5 flex items-center gap-2">
                        <Badge variant="outline" className={CAT_COLOR[cat]}>{cat}</Badge>
                        <span className="text-[10px] text-muted-foreground">{checks.length} check{checks.length === 1 ? '' : 's'}</span>
                      </div>
                      <div className="space-y-1">
                        {checks.map((c) => (
                          <div key={c.id} className="flex items-start gap-2 rounded-md border border-border/50 bg-muted/20 px-2.5 py-1.5">
                            <Badge variant="outline" className={`mt-0.5 shrink-0 px-1.5 py-0 text-[9px] font-bold ${checkResultColor(c.result)}`}>
                              {c.result}
                            </Badge>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium">{c.name}</div>
                              <div className="text-[10px] leading-snug text-muted-foreground">{c.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* Badge */}
                <Separator className="my-3" />
                <div className="rounded-md border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-teal-500/5 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Award className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs font-semibold">Certification badge</span>
                    </div>
                    <Badge className={levelColor(selectedReport.level)}>{selectedReport.badge.level}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>fingerprint:</span>
                    <span className="truncate font-mono text-foreground">{selectedReport.badge.fingerprint.slice(0, 32)}…</span>
                    <span>signature:</span>
                    <span className="font-mono text-foreground">RSA-SHA256 ✓</span>
                    <span>issued:</span>
                    <span className="font-mono text-foreground">{new Date(selectedReport.badge.issuedAt).toISOString().slice(0, 10)}</span>
                    <span>expires:</span>
                    <span className="font-mono text-foreground">{new Date(selectedReport.badge.expiresAt).toISOString().slice(0, 10)}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                Select an extension to view its 15-check certification report.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
