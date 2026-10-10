import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify as verifySignature } from 'node:crypto';
import test from 'node:test';
import { boundedText, createTokenVerifier, FIREBASE_JWKS_URL } from '../workers/firebase.ts';
import { createImportFirebase, encodeFields } from '../workers/importFirebase.ts';

function streamed(chunks: Uint8Array[], headers?: HeadersInit, cancelled?: () => void) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]); else controller.close(); },
    cancel() { cancelled?.(); },
  }), { headers });
}

test('bounded text retains byte limits and fatal UTF-8 for one or many chunks', async () => {
  const bytes = new TextEncoder().encode('Пластик 🧵');
  assert.equal(await boundedText(streamed([bytes]), bytes.length), 'Пластик 🧵');
  assert.equal(await boundedText(streamed([...bytes].map(byte => Uint8Array.of(byte))), bytes.length), 'Пластик 🧵');
  assert.equal(await boundedText(streamed([]), 1), '');
  assert.equal(await boundedText(new Response(null), 1), '');
  await assert.rejects(boundedText(streamed([bytes], { 'Content-Length': String(bytes.length) }), bytes.length - 1), { status: 413 });
  let cancelled = false;
  await assert.rejects(boundedText(streamed([bytes.slice(0, 3), bytes.slice(3), Uint8Array.of(0)], undefined, () => { cancelled = true; }), bytes.length - 1), { status: 413 });
  assert.ok(cancelled, 'An untrusted stream exceeding the limit is cancelled.');
  for (const chunks of [[Uint8Array.of(0xff)], [Uint8Array.of(0xf0), Uint8Array.of(0x9f)]]) {
    await assert.rejects(boundedText(streamed(chunks), 10), TypeError);
  }
});

test('JWT imports only requested public keys, reuses resolved keys and honors refresh, TTL and every claim', async t => {
  const oldPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const newPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicKey = (pair: typeof oldPair, kid: string) => ({ ...pair.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' });
  let clock = 1_790_000_000, requests = 0;
  let jwks = [publicKey(oldPair, 'old'), { kid: 'unused', kty: 'RSA', alg: 'RS256', use: 'sig' }];
  const imported: string[] = [];
  const importKey = crypto.subtle.importKey.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'importKey', async (format: KeyFormat, data: JsonWebKey | BufferSource,
    algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
    if (format === 'jwk') {
      imported.push((data as JsonWebKey & { kid: string }).kid);
      return importKey(format, data as JsonWebKey, algorithm, extractable, usages);
    }
    return importKey(format, data as BufferSource, algorithm, extractable, usages);
  });
  const verify = createTokenVerifier(async url => {
    assert.equal(String(url), FIREBASE_JWKS_URL); requests++;
    return Response.json({ keys: jwks }, { headers: { 'Cache-Control': 'max-age=300' } });
  }, () => new Date(clock * 1000));
  const token = (pair = oldPair, kid = 'old', changes: Record<string, unknown> = {}) => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const claims = { sub: 'user-a', aud: 'kilo-g', iss: 'https://securetoken.google.com/kilo-g', exp: clock + 3600,
      iat: clock, auth_time: clock, email_verified: true, ...changes };
    const payload = head + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
    return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), pair.privateKey).toString('base64url');
  };
  assert.equal(await verify(token(), 'kilo-g'), 'user-a');
  assert.deepEqual(await verify(token(), 'kilo-g', undefined, true), { uid: 'user-a', authTime: clock }, 'RSA verification never supplies an unchecked account state.');
  assert.equal(await verify(token(oldPair, 'old', { sub: 'user-b' }), 'kilo-g'), 'user-b');
  assert.deepEqual(imported, ['old'], 'An inactive malformed JWK is never imported; no identity is cached.');
  assert.equal(requests, 1);
  await assert.rejects(verify(token(oldPair, 'missing'), 'kilo-g'), { status: 401 });
  assert.equal(requests, 1, 'An unknown kid cannot force immediate repeated fetches.');
  clock += 60;
  jwks = [publicKey(oldPair, 'old'), publicKey(newPair, 'new')];
  assert.equal(await verify(token(newPair, 'new'), 'kilo-g'), 'user-a');
  assert.equal(requests, 2); assert.deepEqual(imported, ['old', 'new']);
  assert.equal(await verify(token(), 'kilo-g'), 'user-a');
  assert.deepEqual(imported, ['old', 'new', 'old']);
  for (const changes of [{ aud: 'foreign' }, { iss: 'https://evil.example' }, { exp: clock }, { iat: clock + 1 },
    { auth_time: clock + 1 }, { sub: 'other/path' }, { email_verified: false }]) {
    await assert.rejects(verify(token(oldPair, 'old', changes), 'kilo-g'));
  }
  await assert.rejects(verify(token(newPair, 'old'), 'kilo-g'), { status: 401 });
  clock += 300;
  jwks = [publicKey(newPair, 'new')];
  await assert.rejects(verify(token(), 'kilo-g'), { status: 401 });
  assert.equal(requests, 3, 'TTL expiration reloads the public set and retires removed keys.');
  assert.equal(await verify(token(newPair, 'new'), 'kilo-g'), 'user-a');
  assert.deepEqual(imported, ['old', 'new', 'old', 'new']);
});

test('concurrent cold verifications own their fetches and late older responses cannot roll back rotated keys', async () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clock = 1_790_000_000;
  const token = (signer: typeof pair, kid: string) => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const payload = head + '.' + Buffer.from(JSON.stringify({ sub: 'concurrent', aud: 'kilo-g', iss: 'https://securetoken.google.com/kilo-g',
      exp: clock + 3600, iat: clock, auth_time: clock, email_verified: true })).toString('base64url');
    return payload + '.' + sign('RSA-SHA256', Buffer.from(payload), signer.privateKey).toString('base64url');
  };
  const oldToken = token(pair, 'old'), newToken = token(rotated, 'new');
  const resolve: ((response: Response) => void)[] = [];
  const verify = createTokenVerifier(async () => new Promise<Response>(done => resolve.push(done)), () => new Date(clock * 1000));
  const first = verify(oldToken, 'kilo-g'), second = verify(newToken, 'kilo-g');
  assert.equal(resolve.length, 2, 'No in-flight fetch or response body is borrowed from another request.');
  const oldKey = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'old', alg: 'RS256', use: 'sig' };
  const newKey = { ...rotated.publicKey.export({ format: 'jwk' }), kid: 'new', alg: 'RS256', use: 'sig' };
  resolve[1](Response.json({ keys: [oldKey, newKey] })); assert.equal(await second, 'concurrent');
  resolve[0](Response.json({ keys: [oldKey] })); assert.equal(await first, 'concurrent');
  assert.deepEqual(await Promise.all([verify(oldToken, 'kilo-g'), verify(newToken, 'kilo-g')]), ['concurrent', 'concurrent']);
  assert.equal(resolve.length, 2, 'The late older response cannot replace the current set or trigger another fetch.');
});

function remoteToken(changes: Record<string, unknown> = {}, headerChanges: Record<string, unknown> = {}) {
  const clock = 1_790_000_000;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'remote-fixture', ...headerChanges })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ sub: 'remote-user', aud: 'kilo-g', iss: 'https://securetoken.google.com/kilo-g',
    exp: clock + 3600, iat: clock, auth_time: clock - 20, email_verified: true, ...changes })).toString('base64url');
  return header + '.' + claims + '.fixture_signature';
}
const remoteApiKey = 'AIza' + 'x'.repeat(35);
const remoteClock = () => new Date(1_790_000_000_000);

test('remote account lookup delegates signature verification without RSA or JWKS and keeps live revocation', async t => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const parts = remoteToken().split('.');
  const signed = parts[0] + '.' + parts[1];
  parts[2] = sign('RSA-SHA256', Buffer.from(signed), pair.privateKey).toString('base64url');
  const token = parts.join('.');
  const tampered = token.slice(0, signed.length + 1) + (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  t.mock.method(crypto.subtle, 'importKey', () => { throw new Error('Remote verification must not import RSA keys.'); });
  t.mock.method(crypto.subtle, 'verify', () => { throw new Error('Remote verification must not run RSA locally.'); });
  let requests = 0;
  const user = { localId: 'remote-user', emailVerified: true, disabled: false, validSince: '0' };
  const verify = createTokenVerifier(async (input, init) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, 'https://identitytoolkit.googleapis.com/v1/accounts:lookup');
    assert.equal(url.searchParams.get('key'), remoteApiKey);
    assert.equal(url.searchParams.get('fields'), 'users(localId,emailVerified,disabled,validSince)');
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    const payload = JSON.parse(init?.body as string);
    assert.deepEqual(Object.keys(payload), ['idToken'], 'Never send privileged localId, email or tenant selectors.');
    const [head, claims, signature] = payload.idToken.split('.');
    if (!verifySignature('RSA-SHA256', Buffer.from(head + '.' + claims), pair.publicKey, Buffer.from(signature, 'base64url'))) {
      return Response.json({ error: { message: 'INVALID_ID_TOKEN' } }, { status: 400 });
    }
    return Response.json({ users: [{ ...user }] });
  }, remoteClock);
  assert.equal(await verify(token, 'kilo-g', remoteApiKey), 'remote-user');
  assert.deepEqual(await verify(token, 'kilo-g', remoteApiKey, true), { uid: 'remote-user', authTime: 1_789_999_980, validSince: 0 });
  await assert.rejects(verify(tampered, 'kilo-g', remoteApiKey), { status: 401 });
  user.disabled = true;
  await assert.rejects(verify(token, 'kilo-g', remoteApiKey), { status: 403 });
  user.disabled = false; user.emailVerified = false;
  await assert.rejects(verify(token, 'kilo-g', remoteApiKey), { status: 403 });
  user.emailVerified = true; user.validSince = '1790000000';
  await assert.rejects(verify(token, 'kilo-g', remoteApiKey), { status: 401 });
  user.validSince = '1789999980';
  assert.equal(await verify(token, 'kilo-g', remoteApiKey), 'remote-user');
  assert.equal(requests, 7, 'No identity or access result survives a request.');
});

test('remote verification rejects project, header and time claims before any Google request', async () => {
  let requests = 0;
  const verify = createTokenVerifier(async () => { requests++; throw new Error('Unexpected fetch'); }, remoteClock);
  for (const changes of [{ aud: 'foreign' }, { iss: 'https://evil.example' }, { exp: 1_790_000_000 }, { exp: 1_789_999_999 },
    { iat: -1 }, { iat: 1_790_000_001 }, { iat: 1.5 }, { auth_time: -1 }, { auth_time: 1_790_000_001 },
    { iat: 1_789_999_970 }, { sub: '' }, { sub: 'other/path' }, { sub: 'x'.repeat(129) }]) {
    await assert.rejects(verify(remoteToken(changes), 'kilo-g', remoteApiKey), { status: 401 });
  }
  for (const changes of [{ alg: 'none' }, { kid: '' }, { kid: 'x'.repeat(201) }]) {
    await assert.rejects(verify(remoteToken({}, changes), 'kilo-g', remoteApiKey), { status: 401 });
  }
  await assert.rejects(verify(remoteToken({ email_verified: false }), 'kilo-g', remoteApiKey), { status: 403 });
  await assert.rejects(verify(remoteToken(), 'kilo-g', ''), { status: 503 }, 'An invalid configured key cannot silently fall back to RSA.');
  assert.equal(requests, 0);
});

test('remote verification fails closed for transport, upstream errors and malformed account responses', async () => {
  let reply: () => Response | Promise<Response> = () => Response.json({ users: [{ localId: 'remote-user', emailVerified: true }] });
  const verify = createTokenVerifier(async () => reply(), remoteClock);
  const check = (status: number) => assert.rejects(verify(remoteToken(), 'kilo-g', remoteApiKey), { status });
  assert.equal(await verify(remoteToken(), 'kilo-g', remoteApiKey), 'remote-user', 'Missing optional validSince uses the epoch.');
  for (const status of [400, 401, 403, 429, 500, 503, 302]) {
    reply = () => new Response(null, { status });
    await check(status === 400 || status === 401 ? 401 : status === 403 ? 403 : 503);
  }
  reply = () => { throw new Error('network failure'); }; await check(503);
  for (const body of ['{', 'x'.repeat(8193)]) { reply = () => new Response(body); await check(503); }
  for (const users of [[], [{ localId: 'wrong', emailVerified: true }],
    [{ localId: 'remote-user', emailVerified: true }, { localId: 'remote-user', emailVerified: true }]]) {
    reply = () => Response.json({ users }); await check(401);
  }
  for (const validSince of ['', '-1', '1.5', '9007199254740992', true]) {
    reply = () => Response.json({ users: [{ localId: 'remote-user', emailVerified: true, validSince }] }); await check(503);
  }
});

test('service token refresh reuses one resolved signing key, rotates secrets and reads live access on every call', async t => {
  const project = 'kilo-g', uid = 'admin-fixture';
  const oldPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const newPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = (pair: typeof oldPair) => ({ project_id: project, client_email: 'import@' + project + '.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const oldSecret = JSON.stringify(account(oldPair)), newSecret = JSON.stringify(account(newPair));
  let clock = 1_790_000_000, imports = 0, signatures = 0, oauthCalls = 0, authCalls = 0, scopeCalls = 0;
  let currentPair = oldPair, disabled = false, blocked = false, admin = true, validSince = 0;
  const assertions: { iat: number; exp: number }[] = [];
  const importKey = crypto.subtle.importKey.bind(crypto.subtle);
  const sign = crypto.subtle.sign.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'importKey', async (format: KeyFormat, data: JsonWebKey | BufferSource,
    algorithm: AlgorithmIdentifier, extractable: boolean, usages: KeyUsage[]) => {
    if (format === 'jwk') return importKey(format, data as JsonWebKey, algorithm, extractable, usages);
    imports++; return importKey(format, data as BufferSource, algorithm, extractable, usages);
  });
  t.mock.method(crypto.subtle, 'sign', async (algorithm: AlgorithmIdentifier, key: CryptoKey, data: BufferSource) => {
    signatures++; return sign(algorithm, key, data);
  });
  const adapter = createImportFirebase(async (input, init) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      oauthCalls++;
      const assertion = new URLSearchParams(init?.body as string).get('assertion')!;
      const [header, claims, signature] = assertion.split('.');
      assert.ok(verifySignature('RSA-SHA256', Buffer.from(header + '.' + claims), currentPair.publicKey, Buffer.from(signature, 'base64url')));
      const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
      assert.equal(payload.iss, account(currentPair).client_email); assert.equal(payload.aud, url);
      assert.equal(payload.iat, clock); assert.equal(payload.exp, clock + 3600); assertions.push(payload);
      return Response.json({ access_token: 'fixture-token-' + oauthCalls, expires_in: 3600 });
    }
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-token-' + oauthCalls);
    if (url === 'https://identitytoolkit.googleapis.com/v1/projects/' + project + '/accounts:lookup?fields=users(localId,emailVerified,disabled,validSince)') {
      authCalls++; assert.deepEqual(JSON.parse(init?.body as string), { localId: [uid] });
      return Response.json({ users: [{ localId: uid, emailVerified: true, disabled, validSince: String(validSince) }] });
    }
    assert.equal(url, 'https://firestore.googleapis.com/v1/projects/' + project + '/databases/(default)/documents:batchGet');
    scopeCalls++;
    const { documents, mask } = JSON.parse(init?.body as string) as { documents: string[]; mask: { fieldPaths: string[] } };
    assert.deepEqual(mask.fieldPaths, ['adminUids', 'version', 'blocked', 'changeId', 'active', 'companyId']);
    assert.equal(documents.length, 4);
    return Response.json(documents.map(name => name.endsWith('/system/authorization')
      ? { found: { name, fields: encodeFields({ adminUids: admin ? [uid] : [], version: 1 }) } }
      : name.endsWith('/accountAccess/' + uid)
        ? { found: { name, fields: encodeFields({ blocked, changeId: 'fixture' }) } } : { missing: name }));
  }, () => new Date(clock * 1000));
  assert.equal((await adapter.scope(project, oldSecret, uid)).role, 'admin');
  assert.deepEqual([imports, signatures, oauthCalls, authCalls, scopeCalls], [1, 1, 1, 1, 1]);
  await adapter.scope(project, oldSecret, uid);
  assert.deepEqual([imports, signatures, oauthCalls, authCalls, scopeCalls], [1, 1, 1, 2, 2]);
  clock += 3540;
  await adapter.scope(project, oldSecret, uid);
  assert.deepEqual([imports, signatures, oauthCalls], [1, 2, 2], 'Refresh signs a new assertion without importing PKCS8 again.');
  assert.notEqual(assertions[0].iat, assertions[1].iat);
  currentPair = newPair;
  await adapter.scope(project, newSecret, uid);
  assert.deepEqual([imports, signatures, oauthCalls], [2, 3, 3], 'Changing the exact secret imports and signs with the new key.');
  currentPair = oldPair;
  await adapter.scope(project, oldSecret, uid);
  assert.deepEqual([imports, signatures, oauthCalls], [3, 4, 4], 'Only one resolved signing key is retained.');
  const invalidEmail = JSON.stringify({ ...account(oldPair), client_email: 'import@foreign.iam.gserviceaccount.com' });
  const malformedKey = JSON.stringify({ ...account(oldPair), private_key: 'invalid-pkcs8' });
  for (const [candidateProject, candidateSecret] of [[project, invalidEmail], [project, malformedKey],
    ['foreign-project', oldSecret], ['INVALID/project', oldSecret], [project, '{']]) {
    await assert.rejects(adapter.scope(candidateProject, candidateSecret, uid), { status: 503 });
  }
  assert.deepEqual([imports, signatures, oauthCalls], [3, 4, 4], 'Invalid service accounts cannot reuse another secret or project key.');
  validSince = clock - 1;
  assert.equal((await adapter.scope(project, oldSecret, uid)).validSince, validSince);
  blocked = true;
  await assert.rejects(adapter.scope(project, oldSecret, uid), { status: 403 });
  blocked = false; admin = false;
  await assert.rejects(adapter.scope(project, oldSecret, uid), { status: 403 });
  admin = true; disabled = true;
  await assert.rejects(adapter.scope(project, oldSecret, uid), { status: 403 });
  assert.deepEqual([imports, signatures, oauthCalls], [3, 4, 4]);
  assert.deepEqual([authCalls, scopeCalls], [9, 8], 'Account revocation and roles remain fresh despite resolved credential caches.');
});

test('masked access reads omit company logos and keep manager state and deletion fresh', async () => {
  const project = 'kilo-g', uid = 'manager-fixture';
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const secret = JSON.stringify({ project_id: project, client_email: 'import@' + project + '.iam.gserviceaccount.com',
    private_key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
  const documents = new Map<string, Record<string, unknown>>([
    ['system/authorization', { adminUids: [], version: 7, bootstrapUid: 'irrelevant' }],
    ['accountAccess/' + uid, { blocked: false, changeId: 'access-a' }],
    ['memberships/' + uid, { active: true, companyId: 'company-a', version: 2, changeId: 'membership-a' }],
    ['companies/company-a', { status: 'active', logoDataUrl: 'x'.repeat(24 * 1024), allowedDomains: ['shop.example.com'] }],
  ]);
  let authCalls = 0, companyReads = 0;
  const adapter = createImportFirebase(async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') return Response.json({ access_token: 'fixture-token', expires_in: 3600 });
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      authCalls++;
      assert.equal(url.searchParams.get('fields'), 'users(localId,emailVerified,disabled,validSince)');
      return Response.json({ users: [{ localId: uid, emailVerified: true, validSince: '42' }] });
    }
    assert.equal(url.pathname.endsWith('/documents:batchGet'), true);
    const body = JSON.parse(init?.body as string) as { documents: string[]; mask: { fieldPaths: string[] } };
    if (body.documents.length === 1) {
      companyReads++;
      assert.deepEqual(body.mask.fieldPaths, ['status']);
    } else assert.deepEqual(body.mask.fieldPaths, ['adminUids', 'version', 'blocked', 'changeId', 'active', 'companyId']);
    const rows = body.documents.map(name => {
      const document = documents.get(name.split('/documents/')[1]);
      return document ? { found: { name, fields: encodeFields(Object.fromEntries(body.mask.fieldPaths
        .filter(field => Object.hasOwn(document, field)).map(field => [field, document[field]]))) } } : { missing: name };
    });
    assert.ok(JSON.stringify(rows).length < 2048, 'Scope reads exclude logo and unrelated company data.');
    return Response.json(rows.reverse());
  });
  const first = await adapter.scope(project, secret, uid);
  assert.equal(first.role, 'manager'); assert.equal(first.companyId, 'company-a'); assert.equal(first.validSince, 42);
  documents.get('memberships/' + uid)!.changeId = 'membership-b';
  assert.notEqual((await adapter.scope(project, secret, uid)).fingerprint, first.fingerprint);
  documents.get('companies/company-a')!.status = 'disabled';
  await assert.rejects(adapter.scope(project, secret, uid), { status: 403 });
  documents.get('companies/company-a')!.status = 'active';
  documents.set('accountDeletion/' + uid, { uid, startedAt: 'fixture' });
  await assert.rejects(adapter.scope(project, secret, uid), { status: 403 });
  assert.deepEqual([authCalls, companyReads], [4, 3], 'A masked deletion document with empty fields still denies access.');
  documents.delete('accountDeletion/' + uid);
  const identity = { uid, authTime: 100, validSince: 42 };
  const verifiedScope = await adapter.scope(project, secret, uid, undefined, true, identity);
  assert.equal(verifiedScope.validSince, 42);
  assert.deepEqual([authCalls, companyReads], [4, 4], 'A verified remote account skips only the duplicate privileged Auth lookup.');
  documents.set('accountAccess/' + uid, { blocked: true, changeId: 'fresh-block' });
  await assert.rejects(adapter.scope(project, secret, uid, undefined, true, identity), { status: 403 });
  documents.set('accountAccess/' + uid, { blocked: false, changeId: 'fresh-unblock' });
  documents.get('companies/company-a')!.status = 'disabled';
  await assert.rejects(adapter.scope(project, secret, uid, undefined, true, identity), { status: 403 });
  documents.get('companies/company-a')!.status = 'active';
  documents.get('memberships/' + uid)!.active = false;
  await assert.rejects(adapter.scope(project, secret, uid, undefined, true, identity), { status: 403 });
  assert.deepEqual([authCalls, companyReads], [4, 5], 'Current blocks, company and membership changes remain authoritative.');
  for (const invalid of [{ ...identity, uid: 'foreign' }, { ...identity, validSince: -1 },
    { ...identity, validSince: 101 }, { ...identity, authTime: NaN }]) {
    await assert.rejects(adapter.scope(project, secret, uid, undefined, true, invalid), { status: 401 });
  }
  documents.get('memberships/' + uid)!.active = true;
  assert.equal((await adapter.scope(project, secret, uid, undefined, true, { uid, authTime: 100 })).validSince, 42);
  assert.deepEqual([authCalls, companyReads], [5, 6], 'RSA-only identity lacks account state and must still read privileged Auth.');
});
