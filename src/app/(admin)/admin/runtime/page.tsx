import { requireAdmin } from '@/lib/auth-guards';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe, Activity, Database, Cpu, Clock, Zap } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function RuntimePage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runtime Console"
        description="PaySwap Runtime — the execution runtime of a programmable financial network"
      />

      {/* Architecture Summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Runtime Version</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">v1.5</div>
            <p className="text-xs text-muted-foreground">Frozen Constitution</p>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge variant="secondary" className="text-xs">18 Primitives</Badge>
              <Badge variant="secondary" className="text-xs">15 Principles</Badge>
              <Badge variant="secondary" className="text-xs">4 Runtimes</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Compiler</CardTitle>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">9 Passes</div>
            <p className="text-xs text-muted-foreground">Pass pipeline</p>
            <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
              <div>resolve_identities → policy → compliance → fraud</div>
              <div>→ reserve_allocation → reserve_aware_routing</div>
              <div>→ liquidity → fx → settlement_planning</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Execution Pipeline</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">10 Stages</div>
            <p className="text-xs text-muted-foreground">Golden path proven</p>
            <div className="mt-2 text-xs text-muted-foreground">
              Receive → Validate → Reserve → Liquidity → Settlement → Ledger → Events → Projection → Inspector → Complete
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Primitives */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" /> Runtime Primitives
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Capability Graph', layer: 'L3', status: '✅', desc: 'Compiled projection' },
              { name: 'Reserve Ledger', layer: 'L3', status: '✅', desc: 'Event-derived projection' },
              { name: 'Reserve Market', layer: 'L4', status: '✅', desc: 'Pure read model' },
              { name: 'Liquidity Marketplace', layer: 'L3', status: '✅', desc: 'Event-derived order book' },
              { name: 'Route Graph + Routing', layer: 'L4', status: '✅', desc: 'Compiled + pure scoring' },
              { name: 'Financial Compiler', layer: 'L6', status: '✅', desc: '9-pass pipeline' },
              { name: 'Opportunity Discovery', layer: 'L9', status: '✅', desc: '12 analyzers' },
              { name: 'Recommendation Lifecycle', layer: 'L9', status: '✅', desc: '9-stage event-driven' },
              { name: 'Digital Twin', layer: 'L10', status: '✅', desc: 'Pure simulation' },
              { name: 'Execution Pipeline', layer: 'L7', status: '✅', desc: '10-stage executor' },
              { name: 'Simulator (sim=prod)', layer: 'L7', status: '✅', desc: 'Trace equivalence' },
              { name: 'Inspector', layer: 'L2', status: '✅', desc: 'Read-only provenance' },
              { name: 'API Gateway', layer: 'L1', status: '✅', desc: 'Auth, idempotency, rate limit' },
              { name: 'Scheduling Engine', layer: 'L1', status: '✅', desc: 'Retry, dead-letter' },
              { name: 'Event Store', layer: 'L1', status: '✅', desc: 'Append-only OCC' },
              { name: 'Runtime Clock', layer: 'L0', status: '✅', desc: 'Virtual time' },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.desc}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{p.layer}</Badge>
                  <span className="text-lg">{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* API Endpoints */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> Runtime API Endpoints
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { method: 'POST', path: '/api/runtime/payments/create', desc: 'Golden path: compile + execute payment' },
              { method: 'POST', path: '/api/runtime/compiler/compile', desc: 'Compile intent → ExecutionPlan' },
              { method: 'GET', path: '/api/runtime/capabilities', desc: 'List capabilities (compiled projection)' },
              { method: 'GET', path: '/api/runtime/reserves', desc: 'List reserves (event-derived)' },
              { method: 'GET', path: '/api/runtime/reserves/market', desc: 'Reserve market snapshot (pure read model)' },
              { method: 'GET', path: '/api/runtime/marketplace/offers', desc: 'Liquidity order book' },
              { method: 'GET', path: '/api/runtime/marketplace/quote', desc: 'Quote for a route' },
              { method: 'GET', path: '/api/runtime/marketplace/clear', desc: 'Clearing result (deterministic)' },
              { method: 'GET', path: '/api/runtime/routes', desc: 'Compiled routes' },
              { method: 'GET', path: '/api/runtime/routes/rank', desc: 'Ranked routes (decomposed scoring)' },
              { method: 'GET', path: '/api/runtime/discovery', desc: 'Opportunity discovery (12 analyzers)' },
              { method: 'GET', path: '/api/runtime/recommendations', desc: 'Recommendation lifecycle states' },
              { method: 'POST', path: '/api/runtime/recommendations/[id]/transition', desc: 'Transition lifecycle' },
              { method: 'POST', path: '/api/runtime/twin/simulate', desc: 'Digital Twin simulation' },
              { method: 'POST', path: '/api/runtime/simulator/compare', desc: 'Sim vs Prod trace equivalence' },
              { method: 'GET', path: '/api/runtime/inspector/network', desc: 'Network overview' },
              { method: 'GET', path: '/api/runtime/inspector/graphs/resource', desc: 'Resource graph' },
              { method: 'GET', path: '/api/runtime/inspector/graphs/economic', desc: 'Economic graph' },
              { method: 'GET', path: '/api/runtime/inspector/graphs/capability-route', desc: 'Capability/Route graph' },
              { method: 'POST', path: '/api/runtime/gateway/dispatch', desc: 'Gateway dispatch (auth+idempotency)' },
              { method: 'GET', path: '/api/runtime/scheduler/jobs', desc: 'Scheduled jobs' },
              { method: 'POST', path: '/api/runtime/scheduler/process', desc: 'Process due jobs' },
            ].map((api) => (
              <div key={api.path} className="flex items-center gap-3 rounded-lg border p-2 text-sm">
                <Badge variant={api.method === 'GET' ? 'secondary' : 'default'} className="w-16 justify-center font-mono text-xs">
                  {api.method}
                </Badge>
                <code className="text-xs flex-1">{api.path}</code>
                <span className="text-xs text-muted-foreground hidden md:inline">{api.desc}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Architecture Principles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Architectural Principles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              '1. Runtime First',
              '2. Intent Before Execution',
              '3. Explainability by Default',
              '4. One Runtime',
              '5. Event Truth',
              '6. Deterministic Replay',
              '7. Simulation Is Production',
              '8. Economic Safety',
              '9. Everything Is Inspectable',
              '10. Runtime Over Features',
              '11. Continuous Optimization',
              '12. Economic Operating System',
              '13. Economic Discovery & Network Evolution',
              '14. Financial Compilation',
              '15. Coordination',
            ].map((principle) => (
              <div key={principle} className="text-sm text-muted-foreground">{principle}</div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
