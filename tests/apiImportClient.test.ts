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

test('browser API forwards App Check and refuses to send without successful attestation', async () => {
  let calls = 0;
  const api = createApiImportClient(async () => 'session-token', () => {}, async (_url, init) => {
    calls++;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer session-token');
    assert.equal(headers.get('X-Firebase-AppCheck'), 'fixture.appcheck.signature');
    return Response.json({ key: null });
  }, async signal => { assert.ok(signal); return { 'X-Firebase-AppCheck': 'fixture.appcheck.signature' }; });
  await api.metadata();
  const denied = createApiImportClient(async () => 'session-token', () => {}, async () => { calls++; return Response.json({}); },
    async () => { throw new Error('Attestation refused'); });
  await assert.rejects(denied.rotate(), /Attestation refused/);
  assert.equal(calls, 1, 'Attestation failure never falls back to a request without App Check.');
});

test('history removal sends selected IDs with the current browser session and App Check', async () => {
  const ids = ['bd51a75f-a432-46a8-95ec-120c204609d2', 'bb9b8567-cf96-428e-afd2-b3a743751c41'];
  const result = { deletedIds: [ids[0]], unavailableIds: [ids[1]] };
  let calls = 0, sessionChecks = 0;
  const api = createApiImportClient(async () => 'session-token', () => { sessionChecks++; }, async (url, init) => {
    calls++;
    assert.equal(url, '/api/v1/imports'); assert.equal(init?.method, 'DELETE');
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { ids });
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer session-token');
    assert.equal(headers.get('X-Firebase-AppCheck'), 'fixture.appcheck.signature');
    assert.equal(headers.get('Content-Type'), 'application/json');
    return Response.json(result);
  }, async signal => { assert.ok(signal); return { 'X-Firebase-AppCheck': 'fixture.appcheck.signature' }; });
  assert.deepEqual(await api.deleteJobs(ids), result);
  assert.ok(sessionChecks >= 4, 'Session ownership is checked before credentials, before sending and before returning data.');

  let identity = 'original';
  const stale = createApiImportClient(async () => 'original-token', () => { assert.equal(identity, 'original'); }, async () => {
    calls++; return Response.json(result);
  }, async () => { identity = 'another-account'; return { 'X-Firebase-AppCheck': 'fixture.appcheck.signature' }; });
  await assert.rejects(stale.deleteJobs(ids));
  assert.equal(calls, 1, 'Changing accounts during attestation cannot send a deletion under the previous session.');
});
