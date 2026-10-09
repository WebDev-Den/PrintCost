import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../workers/index.ts';
import type { AnalyticsDatabase } from '../workers/analytics.ts';

test('Daily analytics cleanup and five-minute import maintenance run separately', async () => {
  for (const [cron, analytics, imports] of [['0 2 * * *', true, false], ['*/5 * * * *', false, true], ['unknown', false, false]] as const) {
    const queries: string[] = [], tasks: Promise<unknown>[] = [];
    const database: AnalyticsDatabase = {
      prepare(sql) {
        queries.push(sql);
        return {
          bind() { return this; },
          async all<T>() { return { results: [] as T[], meta: { changes: 1 }, success: true }; },
          async first<T>() { return null as T | null; },
        };
      },
      batch<T>(statements: ReturnType<AnalyticsDatabase['prepare']>[]) { return Promise.all(statements.map(statement => statement.all<T>())); },
    };
    await worker.scheduled({ cron }, {
      ANALYTICS_DB: database, FIREBASE_PROJECT_ID: 'demo-kilog', FIREBASE_IMPORT_SERVICE_ACCOUNT: 'unused',
      IMPORT_QUEUE: { async send() { assert.fail('An empty outbox must not dispatch anything.'); } },
    }, { waitUntil(promise) { tasks.push(promise); } });
    await Promise.all(tasks);
    assert.equal(queries.some(sql => sql.includes('maintenance')), analytics, cron);
    assert.equal(queries.some(sql => sql.includes('import_jobs')), imports, cron);
    if (cron === 'unknown') assert.equal(queries.length, 0);
  }
});
