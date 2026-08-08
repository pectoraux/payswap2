import { describe, test, expect } from 'bun:test';
import { matchSanctionsName } from '@/trust/sanctions-screener';
import { sanctionsService } from '@/protocol/compliance/sanctions';
import { amlPipeline } from '@/trust/aml-pipeline';
import { sarManager } from '@/trust/sar-manager';
import { loadSanctionsList } from '@/trust/sanctions-list-loader';
import * as complianceTypes from '@/protocol/compliance/types';

describe('P3-4: canonical compliance stack wiring', () => {
  test('sanctions list loader loads the DEV fixture', () => {
    const list = loadSanctionsList();
    expect(list.length).toBeGreaterThan(0);
    // The fixture has 14 entries.
    expect(list.length).toBe(14);
    // KIM JONG UN should be in the list.
    expect(list.some((e) => e.name === 'KIM JONG UN')).toBe(true);
  });

  test('canonical matcher returns KIM JONG UN at score 100', () => {
    const matches = matchSanctionsName('KIM JONG UN', 85);
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.name).toBe('KIM JONG UN');
    expect(top.score).toBe(100);
  });

  test('wrapper delegates to canonical matcher (same answer)', () => {
    // Screen via the wrapper (legacy API).
    const result = sanctionsService.screenEntity('test_p3_4_wrapper', 'KIM JONG UN');
    expect(result.isClear).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    // The hit's matched name should be 'KIM JONG UN'.
    expect(result.hits[0].matchedName).toBe('KIM JONG UN');
    // Cleanup
    const hits = sanctionsService.getHits('test_p3_4_wrapper');
    for (const h of hits) sanctionsService.reviewHit(h.id, true);
  });

  test('canonical aml-pipeline + sar-manager modules are importable', () => {
    expect(typeof amlPipeline.persistAlert).toBe('function');
    expect(typeof amlPipeline.evaluate).toBe('function');
    expect(typeof sarManager.create).toBe('function');
    expect(typeof sarManager.file).toBe('function');
  });

  test('SAMPLE_SANCTIONS_ENTRIES no longer exported from protocol/compliance/types', () => {
    // The sample list has been moved to data/dev-sanctions-fixture.json.
    // Importing the module should NOT have a SAMPLE_SANCTIONS_ENTRIES export.
    expect((complianceTypes as Record<string, unknown>).SAMPLE_SANCTIONS_ENTRIES).toBeUndefined();
  });
});
