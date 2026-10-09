import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function validateDeployment(config: any, projectId: string, turnstileSiteKey: string): void {
  assert.equal(config?.name, 'kilo-g', 'Публікація цієї платформи дозволена лише в Worker kilo-g.');
  assert.equal(config.vars?.FIREBASE_PROJECT_ID, 'kilo-g', 'API має використовувати Firebase kilo-g.');
  assert.equal(projectId, config.vars.FIREBASE_PROJECT_ID, 'Проєкти Firebase сайту й API мають збігатися.');
  assert.equal(config.vars?.TURNSTILE_HOSTNAMES, 'web-dev.pp.ua,kilo-g.web-developer-den.workers.dev', 'Turnstile має дозволяти лише production-hostnames цього Worker.');
  assert.deepEqual(config.secrets?.required, ['TURNSTILE_SECRET_KEY', 'FIREBASE_IMPORT_SERVICE_ACCOUNT'], 'Worker потребує секрети TURNSTILE_SECRET_KEY і FIREBASE_IMPORT_SERVICE_ACCOUNT.');
  assert.ok(!Object.hasOwn(config.vars, 'FIREBASE_IMPORT_SERVICE_ACCOUNT'), 'Сервісний акаунт не може зберігатися у vars.');
  assert.deepEqual(config.queues?.producers, [{ binding: 'IMPORT_QUEUE', queue: 'kilog-imports' }], 'API потребує IMPORT_QUEUE.');
  const consumer = config.queues?.consumers?.[0];
  assert.ok(consumer?.queue === 'kilog-imports' && consumer.max_concurrency === 1 && consumer.max_batch_size === 1 && consumer.max_retries === 3, 'Черга імпорту має виконуватися послідовно з обмеженими повторами.');
  assert.ok(config.triggers?.crons?.includes('*/5 * * * *'), 'Потрібне відновлення черги кожні 5 хвилин.');
  assert.ok(!Object.hasOwn(config.vars, 'TURNSTILE_SECRET_KEY'), 'Приватний ключ Turnstile не може зберігатися у vars.');
  assert.match(turnstileSiteKey?.trim() || '', /^0x[A-Za-z0-9_-]{20,100}$/, 'Production потребує справжнього публічного sitekey Cloudflare Turnstile.');
  const database = config.d1_databases?.find((item: any) => item.binding === 'ANALYTICS_DB');
  assert.ok(database && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(database.database_id)
    && database.database_id !== '00000000-0000-0000-0000-000000000000', 'Створіть робочий D1 і замініть placeholder database_id перед публікацією.');
  assert.equal(config.assets?.binding, 'ASSETS', 'Worker потребує статичних assets.');
  assert.ok(Array.isArray(config.assets?.run_worker_first) && config.assets.run_worker_first.includes('/api/*'), 'API має запускатися перед SPA assets.');
  const rateLimit = config.ratelimits?.find((item: any) => item.name === 'ANALYTICS_RATE_LIMIT');
  assert.ok(rateLimit && typeof rateLimit.namespace_id === 'string' && /^\d+$/.test(rateLimit.namespace_id)
    && Number.isSafeInteger(rateLimit.simple?.limit) && rateLimit.simple.limit > 0
    && [10, 60].includes(rateLimit.simple?.period), 'API потребує ANALYTICS_RATE_LIMIT з числовим namespace_id, додатним цілим limit і period 10 або 60 секунд.');
  assert.ok(!config.limits?.cpu_ms || config.limits.cpu_ms <= 10, 'Ця конфігурація має залишатися в межах Workers Free.');
  const importLimit = config.ratelimits?.find((item: any) => item.name === 'IMPORT_RATE_LIMIT');
  assert.ok(importLimit && /^\d+$/.test(importLimit.namespace_id) && importLimit.simple?.limit === 30 && importLimit.simple.period === 60, 'API потребує IMPORT_RATE_LIMIT 30 запитів/60 секунд.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = 'wrangler.jsonc';
  const config = JSON.parse(await readFile(path, 'utf8'));
  const env = loadEnv('production', process.cwd(), 'VITE_');
  validateDeployment(config, env.VITE_FIREBASE_PROJECT_ID, env.VITE_TURNSTILE_SITE_KEY);
  console.log('Worker і Firebase узгоджені, D1 і Turnstile налаштовано.');
}
