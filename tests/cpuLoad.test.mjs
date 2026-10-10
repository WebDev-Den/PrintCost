import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPlan, runPlan } from '../scripts/cpu-load-test.mjs';
import { IMPORT_LIMITS } from '../src/domain/apiImports.ts';

test('bounded load harness caps concurrency, redacts credentials and stops on authorization failure', async () => {
  const publicPlan = createPlan();
  assert.equal(publicPlan.phases.reduce((total, { requests }) => total + requests.length, 0), 48);
  assert.equal(publicPlan.skipped.length, 2);
  const payloadPath = 'output/cpu-load-selfcheck-payload.json', proofPath = 'output/cpu-load-selfcheck-fixture.json';
  const value = { offers: Array.from({ length: IMPORT_LIMITS.items }, (_, index) => ({ externalId: 'fixture-' + index, description: 'x'.repeat(100) })) };
  const serialized = JSON.stringify(value), bytes = IMPORT_LIMITS.bytes;
  assert.ok(Buffer.byteLength(serialized) < bytes);
  const body = serialized + ' '.repeat(bytes - Buffer.byteLength(serialized));
  const jobId = '11111111-1111-4111-a111-111111111111';
  fs.mkdirSync('output', { recursive: true });
  fs.writeFileSync(payloadPath, body);
  fs.writeFileSync(proofPath, JSON.stringify({ jobId, idempotencyKey: 'selfcheck-known-existing-job', payloadSha256: createHash('sha256').update(body).digest('hex') }));
  try {
    const plan = createPlan({ firebaseIdToken: 'selfcheck-session-secret', appCheckToken: 'selfcheck-attestation-secret',
      apiKey: 'selfcheck-api-secret', boundary: { payloadPath, proofPath } });
    assert.equal(plan.phases.reduce((total, { requests }) => total + requests.length, 0), 70);
    let inFlight = 0, peak = 0;
    const fetcher = async (url, request) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      const path = new URL(url).pathname;
      let status = !path.startsWith('/api/') ? 200 : path === '/api/analytics/events' ? 400 : request.headers?.Authorization?.includes('selfcheck') ? 200 : 401;
      if (path === '/api/v1/imports' && request.method === 'POST') status = Buffer.byteLength(request.body) > bytes ? 413 : JSON.parse(request.body).offers.length > 100 ? 422 : 202;
      --inFlight;
      return Response.json({ id: jobId }, { status, headers: { 'CF-Ray': 'abcdef1234567890-WAW', 'Cache-Control': path.startsWith('/api/') ? 'no-store' : 'public' } });
    };
    const result = await runPlan(plan, fetcher, async () => {});
    assert.equal(result.passed, true); assert.equal(result.requests.length, 70); assert.ok(peak <= 4);
    const apiOnly = await runPlan(createPlan({ apiKey: 'selfcheck-api-secret', boundary: { payloadPath, proofPath } }), fetcher, async () => {});
    assert.equal(apiOnly.passed, true); assert.equal(apiOnly.requests.length, 62);
    assert.equal(apiOnly.summary['boundary-existing-job-replays'].requests, 4, 'API-key-only plans retain proven boundary replays.');
    const proof = JSON.stringify(result);
    assert.ok(!/selfcheck-(?:session|attestation|api)-secret/.test(proof), 'Credentials must not leak into proofs.');
    assert.ok(result.requests.every(({ rayId }) => rayId === 'abcdef1234567890'));
    await assert.rejects(runPlan({ ...plan, host: 'https://other.example.com' }, fetcher));
    await assert.rejects(runPlan({ ...plan, phases: [{ concurrency: 5, requests: [{}] }] }, fetcher));
    await assert.rejects(runPlan({ ...plan, phases: [{ concurrency: 4, requests: Array(121).fill({}) }] }, fetcher));
    const stopped = await runPlan(plan, async (url, request) => new URL(url).pathname === '/api/v1/api-key' && request.headers?.Authorization?.includes('selfcheck') ? new Response('{}', { status: 403 }) : fetcher(url, request), async () => {});
    assert.equal(stopped.passed, false); assert.ok(stopped.aborted); assert.ok(stopped.requests.length < 70);
  } finally {
    fs.unlinkSync(payloadPath); fs.unlinkSync(proofPath);
  }
});

test('external API-key reads use imports only, redact proofs and stop on rejected access', async () => {
  const apiKey = 'selfcheck-external-api-secret', plan = createPlan({ apiKey });
  const external = plan.phases.find(({ name }) => name === 'external-api-key-reads');
  assert.ok(external); assert.equal(external.requests.length, 8); assert.equal(external.concurrency, 2);
  assert.equal(plan.phases.reduce((total, { requests }) => total + requests.length, 0), 56);
  assert.ok(external.requests.every(spec => spec.path === '/api/v1/imports' && (!spec.method || spec.method === 'GET') &&
    spec.headers.Authorization === 'Bearer ' + apiKey && spec.expected.length === 1 && spec.expected[0] === 200));
  assert.ok(!plan.phases.some(({ requests }) => requests.some(spec => spec.path === '/api/v1/api-key' && spec.expected.includes(200))),
    'API-key metadata requires a browser session and cannot be treated as an API-key success.');
  assert.ok(!createPlan({ apiKey, firebaseIdToken: 'selfcheck-session' }).phases.some(({ name }) => name === 'external-api-key-reads'));
  const fetcher = async (url, request) => {
    const pathname = new URL(url).pathname, suppliedKey = request.headers?.Authorization === 'Bearer ' + apiKey;
    if (suppliedKey) assert.equal(pathname, '/api/v1/imports');
    return new Response(apiKey, { status: suppliedKey || !pathname.startsWith('/api/') ? 200 : pathname === '/api/analytics/events' ? 400 : 401 });
  };
  const result = await runPlan(plan, fetcher, async () => {});
  assert.equal(result.passed, true); assert.equal(result.requests.length, 56);
  assert.equal(result.summary['external-api-key-reads'].requests, 8);
  assert.ok(!JSON.stringify(result).includes(apiKey), 'Neither request headers nor upstream bodies may leak into the result.');
  const stopped = await runPlan(plan, async (url, request) => request.headers?.Authorization === 'Bearer ' + apiKey
    ? new Response(apiKey, { status: 403 }) : fetcher(url, request), async () => {});
  assert.equal(stopped.passed, false); assert.ok(stopped.aborted);
  assert.equal(stopped.summary['external-api-key-reads'].requests, 2, 'Only the initial bounded pair is sent after authorization rejection.');
  assert.ok(!JSON.stringify(stopped).includes(apiKey));
});

test('CLI creates a redacted public plan and output directory without sending requests', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kilog-cpu-load-'));
  const output = path.join(directory, 'output', 'cpu-load-plan.json');
  const credentials = path.join(directory, 'output', 'cpu-load-selfcheck-credentials.json'), apiKey = 'selfcheck-cli-api-secret';
  try {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cpu-load-test.mjs', import.meta.url)), 'plan'], { cwd: directory });
    assert.equal(run.status, 0, run.stderr.toString());
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).maximumRequests, 48);
    fs.writeFileSync(credentials, JSON.stringify({ apiKey }));
    const keyed = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cpu-load-test.mjs', import.meta.url)), 'plan',
      'output/cpu-load-plan.json', 'output/cpu-load-selfcheck-credentials.json'], { cwd: directory });
    assert.equal(keyed.status, 0, keyed.stderr.toString());
    const serialized = fs.readFileSync(output, 'utf8'), publicPlan = JSON.parse(serialized);
    assert.equal(publicPlan.maximumRequests, 56);
    assert.deepEqual(publicPlan.phases.find(({ name }) => name === 'external-api-key-reads'), { name: 'external-api-key-reads', concurrency: 2, requests: 8 });
    assert.ok(!serialized.includes(apiKey) && !keyed.stdout.toString().includes(apiKey), 'CLI plans and console metadata must exclude API keys.');
  } finally {
    if (fs.existsSync(credentials)) fs.unlinkSync(credentials);
    if (fs.existsSync(output)) fs.unlinkSync(output);
    if (fs.existsSync(path.dirname(output))) fs.rmdirSync(path.dirname(output));
    fs.rmdirSync(directory);
  }
});
