import { PageHeader } from '@/components/page-header';
import { circuitBreakerRegistry } from '@/lib/circuit-breaker';
import {
  CircuitBreakersViewer,
  type CircuitBreakerStatsDTO,
} from './circuit-breakers-viewer';

export const dynamic = 'force-dynamic';

/**
 * /ops/circuit-breakers — Operations: Circuit Breakers console.
 *
 * Lists every circuit breaker the runtime is tracking (one per external
 * service: Stellar, Ethereum, USDC, Stripe, MoMo, banks, KYC, sanctions,
 * email, SMS, …). Lets ops force-reset all breakers once the underlying
 * service is healthy.
 */
export default async function CircuitBreakersPage() {
  const initial: CircuitBreakerStatsDTO[] = circuitBreakerRegistry.getAllStats();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Circuit Breakers"
        description="Monitor and reset circuit breakers protecting external service calls. Open breakers fail fast to prevent cascading failures."
      />
      <CircuitBreakersViewer initial={initial} />
    </div>
  );
}
