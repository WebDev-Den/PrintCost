import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { boundedText, createTokenVerifier, FIREBASE_JWKS_URL } from '../workers/firebase.ts';

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
