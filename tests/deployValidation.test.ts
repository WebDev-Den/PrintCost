import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../scripts/deploy-validation.ts';

test('deployment rejects placeholder D1, mismatched Firebase and accidental paid CPU configuration', () => {
  const config = { name: 'kilo-g', vars: { FIREBASE_PROJECT_ID: 'kilo-g' }, assets: { binding: 'ASSETS', run_worker_first: ['/api/*'] },
    d1_databases: [{ binding: 'ANALYTICS_DB', database_id: 'a2bcb470-785c-44f6-9b77-5dbd9702a9ca' }] };
  assert.doesNotThrow(() => validateDeployment(config, 'kilo-g'));
  assert.throws(() => validateDeployment(config, 'demo-kilog'));
  assert.throws(() => validateDeployment({ ...config, d1_databases: [{ binding: 'ANALYTICS_DB', database_id: '00000000-0000-0000-0000-000000000000' }] }, 'kilo-g'));
  assert.throws(() => validateDeployment({ ...config, assets: { ...config.assets, run_worker_first: [] } }, 'kilo-g'));
  assert.throws(() => validateDeployment({ ...config, limits: { cpu_ms: 30_000 } }, 'kilo-g'));
});
