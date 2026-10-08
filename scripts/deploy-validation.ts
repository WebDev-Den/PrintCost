import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function validateDeployment(config: any, projectId: string): void {
  assert.equal(config?.name, 'kilo-g', 'Публікація цієї платформи дозволена лише в Worker kilo-g.');
  assert.equal(config.vars?.FIREBASE_PROJECT_ID, 'kilo-g', 'API має використовувати Firebase kilo-g.');
  assert.equal(projectId, config.vars.FIREBASE_PROJECT_ID, 'Проєкти Firebase сайту й API мають збігатися.');
  const database = config.d1_databases?.find((item: any) => item.binding === 'ANALYTICS_DB');
  assert.ok(database && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(database.database_id)
    && database.database_id !== '00000000-0000-0000-0000-000000000000', 'Створіть робочий D1 і замініть placeholder database_id перед публікацією.');
  assert.equal(config.assets?.binding, 'ASSETS', 'Worker потребує статичних assets.');
  assert.ok(Array.isArray(config.assets?.run_worker_first) && config.assets.run_worker_first.includes('/api/*'), 'API має запускатися перед SPA assets.');
  assert.ok(!config.limits?.cpu_ms || config.limits.cpu_ms <= 10, 'Ця конфігурація має залишатися в межах Workers Free.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = 'wrangler.jsonc';
  const config = JSON.parse(await readFile(path, 'utf8'));
  validateDeployment(config, loadEnv('production', process.cwd(), 'VITE_').VITE_FIREBASE_PROJECT_ID);
  console.log('Worker і Firebase узгоджені, D1 налаштовано.');
}
