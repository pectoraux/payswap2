'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { type ReasoningResultSummary } from '@/kernel';
import { Brain, AlertTriangle, TrendingUp, ShieldAlert, Banknote, Microscope, Coins, Scale, Network, Sparkles } from 'lucide-react';

const CATEGORY_ICON: Record<string, typeof Brain> = {
  optimization: Sparkles,
  explanation: Brain,
  anomaly_detection: AlertTriangle,
  treasury_strategy: Banknote,
  reserve_forecasting: TrendingUp,
  lp_recommendations: Coins,
  fraud_detection: ShieldAlert,
  insurance_recommendation: ShieldAlert,
  governance_recommendation: Scale,
  extension_recommendation: Network,
};

const CATEGORY_LABEL: Record<string, string> = {
  optimization: 'Optimization',
  explanation: 'Explanation',
  anomaly_detection: 'Anomaly Detection',
  treasury_strategy: 'Treasury Strategy',
  reserve_forecasting: 'Reserve Forecasting',
  lp_recommendations: 'LP Recommendations',
  fraud_detection: 'Fraud Detection',
  insurance_recommendation: 'Insurance Recommendation',
  governance_recommendation: 'Governance',
  extension_recommendation: 'Extensions',
};

export function ReasoningPanel({ results }: { results: ReasoningResultSummary[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-fuchsia-500" />
          Financial Reasoning Engine
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {results.map((r) => {
          const Icon = CATEGORY_ICON[r.category] ?? Brain;
          const conf = Math.round(r.confidence * 100);
          return (
            <div key={r.category} className="rounded-lg border bg-muted/20 p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <Icon className={`h-3 w-3 ${conf >= 80 ? 'text-emerald-500' : conf >= 50 ? 'text-amber-500' : 'text-rose-500'}`} />
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
                <Badge variant="outline" className={`text-[9px] ${conf >= 80 ? 'text-emerald-600' : conf >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{conf}%</Badge>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{r.summary}</div>
              <Progress value={conf} className="mt-1 h-0.5" />
              {r.recommendations.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {r.recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-1 text-[10px]">
                      <Badge variant="outline" className={`h-3 px-1 text-[7px] ${rec.priority === 'high' ? 'text-rose-600' : rec.priority === 'medium' ? 'text-amber-600' : 'text-sky-600'}`}>{rec.priority}</Badge>
                      <span className="font-medium">{rec.action}.</span>
                      <span className="text-muted-foreground">{rec.rationale}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
