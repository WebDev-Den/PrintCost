import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { IMPORT_LIMITS } from '../src/domain/apiImports.ts';

const hosts = new Set(['https://web-dev.pp.ua', 'https://kilo-g.web-developer-den.workers.dev']);
const outputPath = /^output\/[a-zA-Z0-9_-]+\.json$/;
const day = () => new Date().toISOString().slice(0, 10);
const repeat = (count, build) => Array.from({ length: count }, (_, index) => build(index));

export function createPlan(credentials = {}) {
  const host = credentials.host || 'https://web-dev.pp.ua';
  assert.ok(hosts.has(host));
  const report = `/api/analytics/report?companyId=all&from=${day()}&to=${day()}`;
  const session = credentials.firebaseIdToken ? { Authorization: 'Bearer ' + credentials.firebaseIdToken,
    ...(credentials.appCheckToken ? { 'X-Firebase-AppCheck': credentials.appCheckToken } : {}) } : null;
  const phases = [
    { name: 'static-assets-bypass', concurrency: 4, requests: repeat(24, index => ({ path: ['/', '/filaments', '/kilog-favicon.svg', '/theme-init.js'][index % 4], expected: [200] })) },
    { name: 'auth-guards', concurrency: 2, requests: repeat(12, index => ({ path: index % 4 === 3 ? report : index % 4 === 2 ? '/api/v1/api-key' : '/api/v1/imports',
      headers: index % 4 === 0 ? {} : { Authorization: 'Bearer ' + (index % 4 === 1 ? 'kg_api_' + 'x'.repeat(43) : 'malformed-session') }, expected: [401] })) },
    { name: 'analytics-validation-no-writes', concurrency: 4, requests: repeat(12, () => ({ path: '/api/analytics/events', method: 'POST',
      headers: { Origin: host, 'Content-Type': 'application/json' }, body: '{"events":[]}', expected: [400] })) },
  ];
  const skipped = [];
  if (session) {
    phases.push({ name: 'authenticated-reads', concurrency: 2, requests: repeat(8, index => ({ path: index % 2 ? '/api/v1/imports' : '/api/v1/api-key', headers: session, expected: [200] })) });
    phases.push({ name: 'analytics-authorized-report', concurrency: 2, requests: repeat(8, () => ({ path: report, headers: session, expected: [200] })) });
  } else skipped.push('Authenticated imports/key reads and analytics reports require a fresh session credential, never copied into results.');
  if (credentials.apiKey && !session) phases.push({ name: 'external-api-key-reads', concurrency: 2, requests: repeat(8, () => ({
    path: '/api/v1/imports', headers: { Authorization: 'Bearer ' + credentials.apiKey }, expected: [200],
  })) });
  if (credentials.boundary) {
    assert.ok(session || credentials.apiKey, 'A real authorized credential is required for boundary requests.');
    const { payloadPath, proofPath } = credentials.boundary;
    assert.match(payloadPath, outputPath); assert.match(proofPath, outputPath);
    const body = fs.readFileSync(payloadPath, 'utf8');
    const value = JSON.parse(body), proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    assert.equal((value.offers?.length || 0) + (value.companies?.length || 0), 100, 'Boundary fixture must contain 100 records.');
    assert.equal(Buffer.byteLength(body), IMPORT_LIMITS.bytes, `Boundary fixture must be exactly ${IMPORT_LIMITS.bytes / 1024} KiB.`);
    assert.match(proof.jobId, /^[0-9a-f-]{36}$/); assert.match(proof.idempotencyKey, /^[A-Za-z0-9_-]{1,128}$/);
    assert.equal(proof.payloadSha256, createHash('sha256').update(body).digest('hex'), 'Fixture bytes must match the previously accepted job proof.');
    const headers = { ...(credentials.apiKey ? { Authorization: 'Bearer ' + credentials.apiKey } : session),
      'Content-Type': 'application/json', 'Idempotency-Key': proof.idempotencyKey };
    phases.push({ name: 'boundary-existing-job-replays', concurrency: 2, requests: repeat(4, () => ({ path: '/api/v1/imports', method: 'POST', headers, body, expected: [202], expectedJobId: proof.jobId })) });
    phases.push({ name: 'boundary-overlimit-no-jobs', concurrency: 1, requests: [
      { path: '/api/v1/imports', method: 'POST', headers, body: body + ' ', expected: [413] },
      { path: '/api/v1/imports', method: 'POST', headers, body: JSON.stringify({ offers: Array.from({ length: 101 }, () => ({})) }), expected: [422] },
    ] });
  } else skipped.push(`${IMPORT_LIMITS.items}-record / ${IMPORT_LIMITS.bytes / 1024}-KiB accepted replay and overlimit requests require an existing accepted fixture proof. No import is created automatically.`);
  assert.ok(phases.reduce((total, phase) => total + phase.requests.length, 0) <= 120);
  assert.ok(phases.every(({ concurrency }) => concurrency >= 1 && concurrency <= 4));
  return { host, phases, skipped };
}

export async function runPlan(plan, fetcher = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  assert.ok(hosts.has(plan.host));
  assert.ok(plan.phases.reduce((total, { requests }) => total + requests.length, 0) <= 120);
  assert.ok(plan.phases.every(({ concurrency }) => Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 4));
  const result = { startedAt: new Date().toISOString(), host: plan.host, maxConcurrency: 4, requests: [], skipped: plan.skipped,
    scope: 'Bounded HTTP test. HTTP latency is wall-clock only; CPU must be read separately from Cloudflare invocation logs and correlated by CF-Ray/request ID and deployed version.' };
  for (const phase of plan.phases) {
    for (let offset = 0; offset < phase.requests.length; offset += phase.concurrency) {
      const batch = await Promise.all(phase.requests.slice(offset, offset + phase.concurrency).map(async spec => {
        const sentAt = new Date().toISOString(), started = performance.now();
        try {
          const response = await fetcher(plan.host + spec.path, { method: spec.method || 'GET', headers: spec.headers,
            body: spec.body, redirect: 'error', signal: AbortSignal.timeout(25_000) });
          const bytes = await response.arrayBuffer();
          let jobMatches = true;
          if (spec.expectedJobId && response.status === 202) jobMatches = JSON.parse(new TextDecoder().decode(bytes)).id === spec.expectedJobId;
          return { phase: phase.name, method: spec.method || 'GET', path: spec.path.split('?')[0], sentAt, endedAt: new Date().toISOString(),
            status: response.status, expectedStatus: spec.expected, passed: spec.expected.includes(response.status) && jobMatches,
            wallMs: Math.round((performance.now() - started) * 100) / 100, responseBytes: bytes.byteLength,
            rayId: response.headers.get('CF-Ray')?.split('-')[0], noStore: /no-store/.test(response.headers.get('Cache-Control') || '') };
        } catch (error) {
          return { phase: phase.name, method: spec.method || 'GET', path: spec.path.split('?')[0], sentAt, passed: false, error: error.name };
        }
      }));
      result.requests.push(...batch);
      // Stop before another burst when an accepted fixture replay or authorization fails.
      if (batch.some(row => !row.passed && ['authenticated-reads', 'external-api-key-reads', 'analytics-authorized-report', 'boundary-existing-job-replays'].includes(row.phase))) {
        result.aborted = 'Required authorized scenario failed; further requests were not sent.';
        break;
      }
      await pause(300);
    }
    if (result.aborted) break;
    await pause(500);
  }
  result.endedAt = new Date().toISOString();
  result.passed = !result.aborted && result.requests.every(({ passed }) => passed);
  result.summary = Object.fromEntries(plan.phases.map(({ name }) => {
    const rows = result.requests.filter(({ phase }) => phase === name), latencies = rows.map(({ wallMs }) => wallMs).filter(Number.isFinite).sort((a, b) => a - b);
    return [name, { requests: rows.length, failures: rows.filter(({ passed }) => !passed).length, latencyP95Ms: latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)] ?? null,
      statuses: [...new Set(rows.map(({ status }) => status ?? 'transport-error'))] }];
  }));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] || 'plan', file = process.argv[3] || 'output/cpu-load-plan.json';
  assert.ok(['plan', 'run'].includes(mode)); assert.match(file, outputPath);
  const credentialsPath = process.argv[4];
  if (credentialsPath) assert.match(credentialsPath, outputPath);
  fs.mkdirSync('output', { recursive: true });
  const plan = createPlan(credentialsPath ? JSON.parse(fs.readFileSync(credentialsPath, 'utf8')) : {});
  const result = mode === 'run' ? await runPlan(plan) : { host: plan.host, phases: plan.phases.map(({ name, concurrency, requests }) => ({ name, concurrency, requests: requests.length })),
    skipped: plan.skipped, maximumRequests: plan.phases.reduce((total, { requests }) => total + requests.length, 0), cpuSource: 'Cloudflare native logs, not client wall-clock timing.' };
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ mode, passed: result.passed, requests: result.requests?.length || result.maximumRequests, summary: result.summary, skipped: result.skipped, file }));
  if (result.passed === false) process.exitCode = 1;
}
