/**
 * Run the 120-day economic simulation.
 *
 * Usage: unset DATABASE_URL DIRECT_URL; bun run scripts/run-simulation.ts
 */

import { runSimulation } from '../src/simulation';

async function main() {
  const result = await runSimulation(120);

  if (result.allPassed) {
    console.log('\n✓ Simulation PASSED — the runtime kernel is stable under economic stress.');
    process.exit(0);
  } else {
    console.log('\n✗ Simulation FAILED — some checks did not pass.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
