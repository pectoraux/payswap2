'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { type SimulationScenario, type SavedScenario } from '@/kernel';
import { flag } from './format';
import { Library, Save, Upload, Play, Trash2, CheckCircle2, XCircle, Loader2, FlaskConical } from 'lucide-react';

interface Props {
  currentScenario: SimulationScenario;
  saved: SavedScenario[];
  onLoad: (s: SimulationScenario) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  onRegress: () => void;
  regressResults: { scenarioId: string; name: string; passed: boolean; drift: { costPercent: number; settlementTimeMs: number; riskScore: number } }[] | null;
  saving: boolean;
  regressing: boolean;
}

export function ScenarioLibraryPanel({ currentScenario, saved, onLoad, onSave, onDelete, onRegress, regressResults, saving, regressing }: Props) {
  const [showSaved, setShowSaved] = useState(false);
  const regressMap = new Map((regressResults ?? []).map((r) => [r.scenarioId, r]));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Library className="h-4 w-4 text-emerald-500" /> Scenario Library
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={onSave} disabled={saving} className="h-7 text-xs">
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />} Save
            </Button>
            <Button variant="outline" size="sm" onClick={onRegress} disabled={regressing || saved.length === 0} className="h-7 text-xs">
              {regressing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FlaskConical className="mr-1 h-3 w-3" />} Regress
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowSaved((s) => !s)} className="h-7 text-xs">
              {saved.length} saved
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {regressResults && (
          <div className="mb-3 rounded-lg border bg-muted/20 p-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Regression results</div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" /> {regressResults.filter((r) => r.passed).length} passed</span>
              <span className="flex items-center gap-1 text-rose-600"><XCircle className="h-3 w-3" /> {regressResults.filter((r) => !r.passed).length} drifted</span>
            </div>
          </div>
        )}

        {showSaved && (
          <ScrollArea className="max-h-72">
            <div className="space-y-1.5">
              {saved.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted-foreground">No saved scenarios yet. Run a simulation and click Save.</div>
              ) : (
                saved.map((s) => {
                  const regress = regressMap.get(s.id);
                  return (
                    <div key={s.id} className="flex items-center gap-2 rounded-lg border bg-muted/20 p-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium">{s.name}</span>
                          <Badge variant="outline" className="text-[8px]">{s.category}</Badge>
                        </div>
                        <div className="truncate text-[9px] text-muted-foreground">
                          {flag(s.scenario.transaction.buyer.country)} → {flag(s.scenario.transaction.merchant.country)} · {s.scenario.transaction.amount} {s.scenario.transaction.currency} · {s.baselineMetrics.costPercent}% · risk {s.baselineMetrics.riskScore.toFixed(2)}
                        </div>
                        {regress && (
                          <div className={`text-[9px] ${regress.passed ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {regress.passed ? '✓ baseline matched' : `drift: cost ${regress.drift.costPercent > 0 ? '+' : ''}${regress.drift.costPercent}%, risk ${regress.drift.riskScore > 0 ? '+' : ''}${regress.drift.riskScore}`}
                          </div>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onLoad(s.scenario)} title="Load"><Upload className="h-3 w-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => onDelete(s.id)} title="Delete"><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        )}
        {!showSaved && (
          <div className="text-[11px] text-muted-foreground">
            Current scenario: <span className="font-medium text-foreground">{currentScenario.name}</span>. Save it as a regression test, or run regression across all saved scenarios to detect kernel drift.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
