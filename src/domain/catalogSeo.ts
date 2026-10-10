import type { ConcreteFilamentSku } from './filamentsDirectory.ts';

export const PUBLIC_CATALOG_TEXT_LIMITS = { path: 4000, id: 240, name: 500, brand: 200, type: 80, colorName: 100, packagingLabel: 200, storeName: 200, storeUrl: 2000, description: 10000, profileNozzle: 200, profileBed: 200 } as const;

export interface PublicCatalogProduct {
  path: string;
  id: string;
  name: string;
  brand: string;
  type: string;
  colorName: string;
  spoolWeightGrams: number;
  diameterMm: number;
  packagingLabel: string;
  priceUah: number;
  pricePerKg: number;
  inStock: boolean;
  storeName: string;
  storeUrl: string;
  description: string;
  profileNozzle: string;
  profileBed: string;
  updatedAt?: string;
}

export function catalogProductPath(sku: Pick<ConcreteFilamentSku, 'offerId' | 'parentFilamentId' | 'id'>): string {
  return sku.offerId
    ? `/products/offer/${encodeURIComponent(sku.offerId)}`
    : `/products/filament/${encodeURIComponent(sku.parentFilamentId)}/${encodeURIComponent(sku.id)}`;
}

export function catalogProductStructuredData(product: PublicCatalogProduct) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    sku: product.id,
    url: `https://web-dev.pp.ua${product.path}`,
    description: product.description,
    brand: { '@type': 'Brand', name: product.brand },
    color: product.colorName,
    material: product.type,
    offers: {
      '@type': 'Offer',
      url: product.storeUrl,
      priceCurrency: 'UAH',
      price: product.priceUah.toFixed(2),
      availability: `https://schema.org/${product.inStock ? 'InStock' : 'OutOfStock'}`,
      seller: { '@type': 'Organization', name: product.storeName },
    },
  };
}
