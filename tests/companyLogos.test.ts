import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPANY_LOGO_INPUT_LIMIT, COMPANY_LOGO_PNG_PREFIX, validateCompanyLogoImage } from '../src/domain/companyLogos.ts';
import { companyLogoDimensions, prepareCompanyLogo } from '../src/services/companyLogoImage.ts';

function png(width = 128, height = 128, size = 45) {
  const bytes = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString('base64')}`;
function webp(type: string, payload: Buffer) {
  const bytes = Buffer.alloc(20 + payload.length + payload.length % 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8); bytes.write(type, 12);
  bytes.writeUInt32LE(payload.length, 16); payload.copy(bytes, 20);
  return bytes;
}

test('logo data boundary mirrors nullable, fixed PNG128, canonical base64 and 96KiB Rules limits', () => {
  assert.equal(validateCompanyLogoImage(null), null);
  for (const size of [45, 46, 47, 98302, 98303, 98304]) assert.equal(validateCompanyLogoImage(dataUrl(png(128, 128, size))), dataUrl(png(128, 128, size)));
  for (const image of [undefined, '', true, {}, 'https://seller.example/logo.png', 'data:image/svg+xml;base64,PHN2Zy8+',
    dataUrl(png(127)), dataUrl(png(128, 127)), dataUrl(png(128, 128, 98305)), `${COMPANY_LOGO_PNG_PREFIX}AAAA`, dataUrl(png()) + '\n']) {
    assert.throws(() => validateCompanyLogoImage(image));
  }
  const canonical = dataUrl(png(128, 128, 46));
  assert.throws(() => validateCompanyLogoImage(canonical.slice(0, -3) + 'B=='), 'Nonzero padding bits rejected.');
});

test('image preflight reads PNG size before decoding and rejects huge or spoofed input', () => {
  assert.deepEqual(companyLogoDimensions(png(320, 180), 'image/png'), { width: 320, height: 180 });
  assert.throws(() => companyLogoDimensions(png(4097), 'image/png'), /4096/);
  assert.throws(() => companyLogoDimensions(png(0), 'image/png'));
  assert.throws(() => companyLogoDimensions(png(), 'image/jpeg'));
  assert.throws(() => companyLogoDimensions(Buffer.from('<svg/>'), 'image/png'));
  for (let length = 0; length < 24; length++) assert.throws(() => companyLogoDimensions(png().subarray(0, length), 'image/png'));
});

test('JPEG preflight scans bounded segments, including progressive dimensions, and rejects truncated scans', () => {
  const bytes = Buffer.from([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 8, 8, 0, 180, 1, 64, 1]);
  assert.deepEqual(companyLogoDimensions(bytes, 'image/jpeg'), { width: 320, height: 180 });
  for (let length = 0; length < bytes.length; length++) assert.throws(() => companyLogoDimensions(bytes.subarray(0, length), 'image/jpeg'));
  assert.throws(() => companyLogoDimensions(Buffer.from([255, 216, 255, 218]), 'image/jpeg'));
  const huge = Buffer.from(bytes); huge.writeUInt16BE(4097, 15);
  assert.throws(() => companyLogoDimensions(huge, 'image/jpeg'), /4096/);
});

test('WebP preflight supports VP8X, VP8L and VP8 dimensions and rejects RIFF length or chunk corruption', () => {
  const extended = Buffer.alloc(10); extended.writeUIntLE(319, 4, 3); extended.writeUIntLE(179, 7, 3);
  const lossless = Buffer.alloc(5); lossless[0] = 47; lossless.writeUInt32LE(319 | (179 << 14), 1);
  const lossy = Buffer.alloc(10); Buffer.from([157, 1, 42]).copy(lossy, 3); lossy.writeUInt16LE(320, 6); lossy.writeUInt16LE(180, 8);
  for (const bytes of [webp('VP8X', extended), webp('VP8L', lossless), webp('VP8 ', lossy)]) {
    assert.deepEqual(companyLogoDimensions(bytes, 'image/webp'), { width: 320, height: 180 });
    assert.throws(() => companyLogoDimensions(bytes.subarray(0, -1), 'image/webp'));
    const bad = Buffer.from(bytes); bad.writeUInt32LE(100, 16);
    assert.throws(() => companyLogoDimensions(bad, 'image/webp'));
  }
  extended.writeUIntLE(4096, 4, 3);
  assert.throws(() => companyLogoDimensions(webp('VP8X', extended), 'image/webp'), /4096/);
});

test('upload rejects empty, oversized and unsupported files before bitmap allocation', async () => {
  for (const file of [new File([], 'empty.png', { type: 'image/png' }),
    new File([new Uint8Array(COMPANY_LOGO_INPUT_LIMIT + 1)], 'huge.png', { type: 'image/png' }),
    new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }), new File(['invalid'], 'bad.png', { type: 'image/png' })]) {
    await assert.rejects(prepareCompanyLogo(file));
  }
});
