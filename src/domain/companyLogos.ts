import type { Timestamp } from 'firebase/firestore';

export const COMPANY_LOGO_SIZE = 128;
export const COMPANY_LOGO_INPUT_LIMIT = 2 * 1024 * 1024;
export const COMPANY_LOGO_DATA_URL_LIMIT = 131094;
export const COMPANY_LOGO_PNG_PREFIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACA';

export interface CompanyLogo {
  companyId: string; imageDataUrl: string | null; version: number;
  createdBy: string; createdAt: Timestamp; updatedBy: string; updatedAt: Timestamp;
}

export function validateCompanyLogoImage(image: unknown): string | null {
  if (image === null) return null;
  // Rules mirror these bounds; native browser decoding verifies the complete uploaded image.
  if (typeof image !== 'string' || image.length < 82 || image.length > COMPANY_LOGO_DATA_URL_LIMIT ||
      !image.startsWith(COMPANY_LOGO_PNG_PREFIX) ||
      !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/.test(image)) {
    throw new Error('Логотип має бути PNG 128 × 128 розміром до 96 КіБ. Оберіть зображення повторно.');
  }
  return image;
}
