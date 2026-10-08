import { COMPANY_LOGO_INPUT_LIMIT, COMPANY_LOGO_SIZE, validateCompanyLogoImage } from '../domain/companyLogos.ts';

const invalidImage = () => new Error('Некоректне зображення. Оберіть PNG, JPEG або WebP до 2 МБ.');
const ascii = (bytes: Uint8Array, offset: number, value: string) => [...value].every((char, i) => bytes[offset + i] === char.charCodeAt(0));

/** Read dimensions before decoding: a small compressed file can expand into a huge bitmap. */
export function companyLogoDimensions(bytes: Uint8Array, mime: string): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mime === 'image/png' && bytes.length >= 24 && bytes[0] === 137 && ascii(bytes, 1, 'PNG\r\n\x1a\n') &&
      view.getUint32(8) === 13 && ascii(bytes, 12, 'IHDR')) {
    width = view.getUint32(16); height = view.getUint32(20);
  } else if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    for (let count = 0; count < 256 && offset < bytes.length; count++) {
      if (bytes[offset++] !== 255) throw invalidImage();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0 || marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 216)) continue;
      if (offset + 2 > bytes.length) throw invalidImage();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalidImage();
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8) throw invalidImage();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
      }
      offset += length;
    }
  } else if (mime === 'image/webp' && bytes.length >= 20 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP') && view.getUint32(4, true) + 8 === bytes.length) {
    let offset = 12;
    for (let count = 0; count < 256 && offset + 8 <= bytes.length; count++) {
      const length = view.getUint32(offset + 4, true), payload = offset + 8;
      if (payload + length > bytes.length) throw invalidImage();
      if (ascii(bytes, offset, 'VP8X') && length >= 10) {
        width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
        height = 1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16); break;
      }
      if (ascii(bytes, offset, 'VP8L') && length >= 5 && bytes[payload] === 47) {
        const bits = view.getUint32(payload + 1, true);
        width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1; break;
      }
      if (ascii(bytes, offset, 'VP8 ') && length >= 10 && bytes[payload + 3] === 157 && bytes[payload + 4] === 1 && bytes[payload + 5] === 42) {
        width = view.getUint16(payload + 6, true) & 16383; height = view.getUint16(payload + 8, true) & 16383; break;
      }
      offset = payload + length + (length % 2);
    }
  }
  if (!width || !height) throw invalidImage();
  if (width > 4096 || height > 4096 || width * height > 16_777_216) throw new Error('Зображення завелике: максимальні розміри — 4096 × 4096.');
  return { width, height };
}

export async function prepareCompanyLogo(file: File): Promise<string> {
  if (!file.size || file.size > COMPANY_LOGO_INPUT_LIMIT || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw invalidImage();
  companyLogoDimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  if (typeof createImageBitmap !== 'function') throw new Error('Оновіть браузер, щоб завантажувати логотипи.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw invalidImage(); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096) throw invalidImage();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = COMPANY_LOGO_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не зміг підготувати логотип. Повторіть дію.');
    const scale = COMPANY_LOGO_SIZE / Math.max(bitmap.width, bitmap.height);
    const width = bitmap.width * scale, height = bitmap.height * scale;
    context.drawImage(bitmap, (COMPANY_LOGO_SIZE - width) / 2, (COMPANY_LOGO_SIZE - height) / 2, width, height);
    return validateCompanyLogoImage(canvas.toDataURL('image/png'))!;
  } finally { bitmap.close(); }
}
