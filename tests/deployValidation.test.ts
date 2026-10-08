import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../scripts/deploy-validation.ts';

const config = { name: 'kilo-g', vars: { FIREBASE_PROJECT_ID: 'kilo-g' }, assets: { binding: 'ASSETS', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'ANALYTICS_DB', database_id: 'a2bcb470-785c-44f6-9b77-5dbd9702a9ca' }],
  ratelimits: [{ name: 'ANALYTICS_RATE_LIMIT', namespace_id: '129761', simple: { limit: 60, period: 60 } }] };

test('deployment rejects placeholder D1, mismatched Firebase and accidental paid CPU configuration', () => {
  assert.doesNotThrow(() => validateDeployment(config, 'kilo-g'));
  assert.throws(() => validateDeployment(config, 'demo-kilog'));
  assert.throws(() => validateDeployment({ ...config, d1_databases: [{ binding: 'ANALYTICS_DB', database_id: '00000000-0000-0000-0000-000000000000' }] }, 'kilo-g'));
  assert.throws(() => validateDeployment({ ...config, assets: { ...config.assets, run_worker_first: [] } }, 'kilo-g'));
  assert.throws(() => validateDeployment({ ...config, limits: { cpu_ms: 30_000 } }, 'kilo-g'));
});

test('deployment rejects missing or invalid native analytics rate limiter', () => {
  const limiter = config.ratelimits[0];
  for (const ratelimits of [[], [{ ...limiter, namespace_id: 'invalid' }],
    [{ ...limiter, simple: { limit: 0, period: 60 } }],
    [{ ...limiter, simple: { limit: 1.5, period: 60 } }],
    [{ ...limiter, simple: { limit: 60, period: 30 } }]]) {
    assert.throws(() => validateDeployment({ ...config, ratelimits }, 'kilo-g'), /ANALYTICS_RATE_LIMIT/);
  }
  assert.doesNotThrow(() => validateDeployment({ ...config,
    ratelimits: [{ ...limiter, simple: { limit: 1, period: 10 } }] }, 'kilo-g'));
});
