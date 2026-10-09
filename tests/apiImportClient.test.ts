import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiImportClient } from '../src/services/apiImportClient.ts';

test('API client uses bearer session, idempotency and blocks stale account responses', async () => {
  const calls: RequestInit[] = [];
  const api = createApiImportClient(async () => 'session-token', () => {}, async (url, init) => {
    assert.equal(url, '/api/v1/imports'); calls.push(init!); return Response.json({ id: 'job', status: 'queued' }, { status: 202 });
  });
  await api.submit({ offers: [] }, 'batch-id');
  assert.equal((calls[0].headers as Record<string, string>).Authorization, 'Bearer session-token');
  assert.equal((calls[0].headers as Record<string, string>)['Idempotency-Key'], 'batch-id');
  let identity = 'a';
  const stale = createApiImportClient(async () => 'a-token', () => { assert.equal(identity, 'a'); }, async () => { identity = 'b'; return Response.json({ key: 'secret' }); });
  await assert.rejects(stale.rotate());
});
test('API client explains quotas and does not mistake SPA HTML for a working API', async () => {
  const throttled = createApiImportClient(async () => 'token', () => {}, async () => Response.json({ error: { message: 'Ліміт' } }, { status: 429, headers: { 'Retry-After': '3600' } }));
  await assert.rejects(throttled.jobs(), /60 хв/);
  const html = createApiImportClient(async () => 'token', () => {}, async () => new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(html.metadata(), /ще не активовано/);
});
