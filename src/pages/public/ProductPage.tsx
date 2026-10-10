import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Layers } from 'lucide-react';
import { PublicNavbar } from '../../components/layout/PublicNavbar.tsx';
import { Footer } from '../../components/layout/Footer.tsx';
import { Button } from '../../components/common/Button.tsx';
import { setPageMetadata } from '../../components/common/RouteMetadata.tsx';
import type { PublicCatalogProduct } from '../../domain/catalogSeo.ts';
import { catalogProductStructuredData, PUBLIC_CATALOG_TEXT_LIMITS } from '../../domain/catalogSeo.ts';
import { normalizeOfferProductUrl } from '../../domain/companyOfferValidation.ts';
import { formatNumberUk, formatUah } from '../../domain/formatters.ts';

interface ProductResponse {
  product: PublicCatalogProduct | null;
  status: 200 | 404 | 503;
  path: string;
}

export function parseProductResponse(value: unknown, path: string): ProductResponse | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  if (response.path !== path || ![200, 404, 503].includes(response.status as number)) return null;
  if (response.status !== 200) return response.product === null
    ? { product: null, status: response.status as 404 | 503, path } : null;
  if (!response.product || typeof response.product !== 'object') return null;
  const product = response.product as Record<string, unknown>;
  if (Object.entries(PUBLIC_CATALOG_TEXT_LIMITS).some(([key, max]) => typeof product[key] !== 'string' || (product[key] as string).length > max)
    || product.path !== path || !product.id || !product.name || typeof product.inStock !== 'boolean'
    || !['spoolWeightGrams', 'diameterMm', 'priceUah', 'pricePerKg'].every(key => typeof product[key] === 'number' && Number.isFinite(product[key]) && (product[key] as number) > 0)
    || Number(product.spoolWeightGrams) < 1 || Number(product.spoolWeightGrams) > 100000 || Number(product.diameterMm) < 0.1 || Number(product.diameterMm) > 10
    || Number(product.priceUah) > 10000000 || Number(product.pricePerKg) > 10000000000
    || (product.updatedAt !== undefined && (typeof product.updatedAt !== 'string' || product.updatedAt.length > 40
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(product.updatedAt)
      || !Number.isFinite(Date.parse(product.updatedAt))))) return null;
  let storeUrl: string;
  try {
    storeUrl = normalizeOfferProductUrl(product.storeUrl);
  } catch { return null; }
  return {
    status: 200, path,
    product: {
      path, id: product.id as string, name: product.name as string, brand: product.brand as string,
      type: product.type as string, colorName: product.colorName as string, packagingLabel: product.packagingLabel as string,
      storeName: product.storeName as string, storeUrl, description: product.description as string,
      profileNozzle: product.profileNozzle as string, profileBed: product.profileBed as string,
      spoolWeightGrams: product.spoolWeightGrams as number, diameterMm: product.diameterMm as number,
      priceUah: product.priceUah as number, pricePerKg: product.pricePerKg as number, inStock: product.inStock,
      ...(product.updatedAt === undefined ? {} : { updatedAt: product.updatedAt as string }),
    },
  };
}

function initialProduct(path: string): ProductResponse | null {
  try {
    return parseProductResponse(JSON.parse(document.getElementById('catalog-product-data')?.textContent || 'null'), path);
  } catch { return null; }
}

export const ProductPage: React.FC = () => {
  const { pathname } = useLocation();
  const [response, setResponse] = useState(() => initialProduct(pathname));
  const initial = useRef(response);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const bootstrap = initial.current;
    initial.current = null;
    if (bootstrap?.path === pathname && retry === 0) return;
    const controller = new AbortController();
    setResponse(null);
    void fetch(`/api/catalog${pathname}`, { signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' } })
      .then(async result => {
        const next = parseProductResponse(await result.json(), pathname);
        if (!next || next.status !== result.status) throw new Error('Invalid catalog response');
        if (!controller.signal.aborted) setResponse(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setResponse({ product: null, status: 503, path: pathname });
      });
    return () => controller.abort();
  }, [pathname, retry]);

  const current = response?.path === pathname ? response : null;
  const product = current?.product;

  useEffect(() => {
    setPageMetadata({
      title: product ? `${product.name} | KILO·G` : current?.status === 404 ? 'Товар не знайдено | KILO·G' : 'Каталог пластиків | KILO·G',
      description: product ? (product.description.trim() || `${product.name}. ${product.type}, ${product.colorName}, ${product.spoolWeightGrams} г. ${formatUah(product.priceUah)}. Продавець: ${product.storeName}.`).slice(0, 180) : 'Каталог пластиків для 3D-друку KILO·G.',
      path: pathname, indexable: Boolean(product), type: product ? 'product' : 'website',
      structuredData: product ? catalogProductStructuredData(product) : undefined,
    });
  }, [product, current?.status, pathname]);

  return <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
    <PublicNavbar />
    <main className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      <NavLink to="/filaments" className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 hover:underline"><ArrowLeft size={16} aria-hidden="true" />Каталог пластиків</NavLink>
      {!current ? <p role="status" className="py-12 text-center text-neutral-500">Завантаження товару…</p>
        : !product ? <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 sm:p-8 space-y-4">
          <h1 className="text-2xl font-bold">{current.status === 404 ? 'Товар не знайдено' : 'Каталог тимчасово недоступний'}</h1>
          <p className="text-neutral-600 dark:text-neutral-400">{current.status === 404 ? 'Пропозицію видалено або вона ще не опублікована. Перегляньте інші матеріали в каталозі.' : 'Не вдалося завантажити пропозицію. Спробуйте ще раз.'}</p>
          {current.status === 503 && <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Спробувати ще раз</Button>}
        </section>
          : <article className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 sm:p-8 space-y-8">
            <header className="space-y-3">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">{product.brand} · {product.type}</p>
              <h1 className="text-2xl sm:text-3xl font-bold leading-tight break-words">{product.name}</h1>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">Продавець: {product.storeName}</p>
              <p className={`text-sm font-medium ${product.inStock ? 'text-emerald-700 dark:text-emerald-400' : 'text-neutral-500 dark:text-neutral-400'}`}>{product.inStock ? 'В наявності' : 'Немає в наявності'}</p>
            </header>
            <div className="grid sm:grid-cols-2 gap-8">
              <section className="space-y-4" aria-labelledby="product-characteristics">
                <h2 id="product-characteristics" className="text-lg font-semibold inline-flex items-center gap-2"><Layers size={18} className="text-emerald-600" aria-hidden="true" />Характеристики</h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <dt className="text-neutral-500 dark:text-neutral-400">Тип пластику</dt><dd>{product.type}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Виробник</dt><dd>{product.brand}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Колір</dt><dd>{product.colorName}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Вага</dt><dd>{formatNumberUk(product.spoolWeightGrams, 0)} г</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Діаметр</dt><dd>{formatNumberUk(product.diameterMm)} мм</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Упаковка</dt><dd>{product.packagingLabel}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Температура сопла</dt><dd>{product.profileNozzle || 'Не вказано'}</dd>
                  <dt className="text-neutral-500 dark:text-neutral-400">Температура столу</dt><dd>{product.profileBed || 'Не вказано'}</dd>
                </dl>
              </section>
              <section className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-4" aria-label="Ціна та продавець">
                <div><p className="text-sm text-neutral-600 dark:text-neutral-400">Ціна за упаковку</p><p className="mt-1 text-3xl font-bold font-mono">{formatUah(product.priceUah)}</p><p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{formatUah(product.pricePerKg)} / кг</p></div>
                <a href={product.storeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">До продавця<ExternalLink size={16} aria-hidden="true" /></a>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Купівля відбувається на сайті продавця. Перед замовленням перевірте ціну та наявність.</p>
                {product.updatedAt && <p className="text-xs text-neutral-500 dark:text-neutral-400">Оновлено: <time dateTime={product.updatedAt}>{new Date(product.updatedAt).toLocaleDateString('uk-UA')}</time></p>}
              </section>
            </div>
            {product.description && <section className="space-y-3"><h2 className="text-lg font-semibold">Про матеріал</h2><p className="whitespace-pre-wrap break-words leading-relaxed text-neutral-600 dark:text-neutral-400">{product.description}</p></section>}
            <div className="pt-5 border-t border-neutral-200 dark:border-neutral-800"><NavLink to="/app/calculator" className="text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline">Розрахувати собівартість 3D-друку →</NavLink></div>
          </article>}
    </main>
    <Footer />
  </div>;
};
