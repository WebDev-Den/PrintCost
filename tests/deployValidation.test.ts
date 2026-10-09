import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeployment } from '../scripts/deploy-validation.ts';

const sitekey = '0x4AAAAAAFR_dav3sbi3wfEO';
const config = { name: 'kilo-g', vars: { FIREBASE_PROJECT_ID: 'kilo-g', TURNSTILE_HOSTNAMES: 'web-dev.pp.ua,kilo-g.web-developer-den.workers.dev' },
  secrets: { required: ['TURNSTILE_SECRET_KEY'] }, assets: { binding: 'ASSETS', run_worker_first: ['/api/*'] },
  d1_databases: [{ binding: 'ANALYTICS_DB', database_id: 'a2bcb470-785c-44f6-9b77-5dbd9702a9ca' }],
  ratelimits: [{ name: 'ANALYTICS_RATE_LIMIT', namespace_id: '129761', simple: { limit: 60, period: 60 } }] };

test('deployment rejects placeholder D1, mismatched Firebase and accidental paid CPU configuration', () => {
  assert.doesNotThrow(() => validateDeployment(config, 'kilo-g', sitekey));
  assert.throws(() => validateDeployment(config, 'demo-kilog', sitekey));
  assert.throws(() => validateDeployment({ ...config, d1_databases: [{ binding: 'ANALYTICS_DB', database_id: '00000000-0000-0000-0000-000000000000' }] }, 'kilo-g', sitekey));
  assert.throws(() => validateDeployment({ ...config, assets: { ...config.assets, run_worker_first: [] } }, 'kilo-g', sitekey));
  assert.throws(() => validateDeployment({ ...config, limits: { cpu_ms: 30_000 } }, 'kilo-g', sitekey));
});

test('deployment rejects missing or invalid native analytics rate limiter', () => {
  const limiter = config.ratelimits[0];
  for (const ratelimits of [[], [{ ...limiter, namespace_id: 'invalid' }],
    [{ ...limiter, simple: { limit: 0, period: 60 } }],
    [{ ...limiter, simple: { limit: 1.5, period: 60 } }],
    [{ ...limiter, simple: { limit: 60, period: 30 } }]]) {
    assert.throws(() => validateDeployment({ ...config, ratelimits }, 'kilo-g', sitekey), /ANALYTICS_RATE_LIMIT/);
  }
  assert.doesNotThrow(() => validateDeployment({ ...config,
    ratelimits: [{ ...limiter, simple: { limit: 1, period: 10 } }] }, 'kilo-g', sitekey));
});

test('deployment rejects unsafe Turnstile hostnames, missing secrets and public secret storage', () => {
  for (const TURNSTILE_HOSTNAMES of [undefined, '', '*', 'localhost', '127.0.0.1', 'web-dev.pp.ua', 'web-dev.pp.ua,attacker.invalid']) {
    assert.throws(() => validateDeployment({ ...config, vars: { ...config.vars, TURNSTILE_HOSTNAMES } }, 'kilo-g', sitekey), /Turnstile/);
  }
  for (const secrets of [undefined, { required: [] }, { required: ['WRONG_SECRET'] }]) {
    assert.throws(() => validateDeployment({ ...config, secrets }, 'kilo-g', sitekey), /TURNSTILE_SECRET_KEY/);
  }
  assert.throws(() => validateDeployment({ ...config, vars: { ...config.vars, TURNSTILE_SECRET_KEY: 'private-key' } }, 'kilo-g', sitekey), /vars/);
});

test('deployment rejects absent and dummy public Turnstile sitekeys', () => {
  for (const invalid of ['', ' ', '1x00000000000000000000AA', '2x00000000000000000000AB', '1x00000000000000000000BB',
    '2x00000000000000000000BB', '3x00000000000000000000FF', 'sitekey', '0xshort', `${sitekey} invalid`]) {
    assert.throws(() => validateDeployment(config, 'kilo-g', invalid), /sitekey/);
  }
});
