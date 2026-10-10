import { createImportFirebase } from './importFirebase.ts';
import { ApiError } from './firebase.ts';
import type { ImportEnv } from './importApi.ts';
import type { AnalyticsEnv } from './analytics.ts';
import { createPublicCatalog, catalogId, type CatalogPage } from './publicCatalog.ts';
import { catalogProductStructuredData, PUBLIC_CATALOG_TEXT_LIMITS, type PublicCatalogProduct } from '../src/domain/catalogSeo.ts';
import { formatUah } from '../src/domain/formatters.ts';

const ORIGIN = 'https://web-dev.pp.ua';
interface HtmlElement { setInnerContent(content: string, options?: { html: boolean }): void; setAttribute(name: string, value: string): void; append(content: string, options?: { html: boolean }): void; remove(): void }
interface Rewriter { on(selector: string, handler: { element(element: HtmlElement): void }): Rewriter; transform(response: Response): Response }
declare const HTMLRewriter: { new(): Rewriter };
interface Context { waitUntil(promise: Promise<unknown>): void }
type CatalogEnv = ImportEnv & AnalyticsEnv;
interface Page { title: string; description: string; body: string; path: string; status?: number; product?: PublicCatalogProduct; standalone?: boolean; retryAfter?: number }
export function escapeHtml(value: unknown): string { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }
export function serializeJson(value: unknown): string { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')); }
const link = (path: string, label: string) => `<a class="text-emerald-700 dark:text-emerald-400 hover:underline" href="${escapeHtml(path)}">${escapeHtml(label)}</a>`;
function shell(content: string): string {
  return `<div class="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100"><header class="border-b border-neutral-200 dark:border-neutral-800 px-6 py-5"><nav class="flex flex-wrap gap-6" aria-label="Головна навігація">${link('/', 'KILO·G')}${link('/filaments', 'Каталог пластиків')}${link('/auth/login', 'Мій кабінет')}</nav></header><main class="max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-6">${content}</main><footer class="max-w-5xl mx-auto px-6 py-6 border-t border-neutral-200 dark:border-neutral-800">${link('/privacy', 'Дані та приватність')}</footer></div>`;
}
function productBody(product: PublicCatalogProduct): string {
  const specs = [['Виробник', product.brand], ['Тип пластику', product.type], ['Колір', product.colorName], ['Вага', `${product.spoolWeightGrams} г`], ['Діаметр', `${product.diameterMm} мм`], ['Упаковка', product.packagingLabel], ['Температура сопла', product.profileNozzle || 'Не вказано'], ['Температура столу', product.profileBed || 'Не вказано']];
  return shell(`${link('/filaments', '← Каталог пластиків')}<article class="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 sm:p-8 space-y-6"><h1 class="text-3xl font-bold break-words">${escapeHtml(product.name)}</h1><p>Продавець: ${escapeHtml(product.storeName)}</p><p>${product.inStock ? 'В наявності' : 'Немає в наявності'}</p><h2 class="text-lg font-semibold">Характеристики</h2><dl class="grid grid-cols-2 gap-3 text-sm">${specs.map(([name, value]) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl><section class="space-y-3"><h2 class="text-lg font-semibold">Ціна за упаковку</h2><p class="text-3xl font-bold">${escapeHtml(formatUah(product.priceUah))}</p><p>${escapeHtml(formatUah(product.pricePerKg))} / кг</p><a class="text-emerald-700 dark:text-emerald-400 hover:underline" href="${escapeHtml(product.storeUrl)}" rel="noopener noreferrer" target="_blank">До продавця</a><p class="text-sm text-neutral-500">Перед замовленням перевірте ціну та наявність на сайті продавця.</p></section>${product.description ? `<section class="space-y-3"><h2 class="text-lg font-semibold">Про матеріал</h2><p class="whitespace-pre-wrap break-words">${escapeHtml(product.description)}</p></section>` : ''}${product.updatedAt ? `<p>Оновлено: <time datetime="${escapeHtml(product.updatedAt)}">${escapeHtml(product.updatedAt.slice(0, 10))}</time></p>` : ''}${link('/app/calculator', 'Розрахувати собівартість 3D-друку →')}</article>`);
}
function listBody(title: string, groups: { page: CatalogPage; path: string }[]): string {
  return shell(`<h1 class="text-3xl font-bold">${escapeHtml(title)}</h1><p>Пластики для 3D-друку: ціни, кольори, характеристики та пропозиції продавців.</p>${groups.map(({ page, path }) => `<section class="space-y-6"><h2 class="text-xl font-semibold">${path.endsWith('offers') ? 'Пропозиції компаній' : 'Матеріали каталогу'}</h2>${page.products.length ? `<ul class="grid sm:grid-cols-2 gap-4">${page.products.map(product => `<li class="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3"><h3 class="font-semibold">${link(product.path, product.name)}</h3><p>${escapeHtml(product.brand)} · ${escapeHtml(product.type)} · ${escapeHtml(product.colorName)} · ${product.spoolWeightGrams} г</p><p>${escapeHtml(formatUah(product.priceUah))} · ${product.inStock ? 'В наявності' : 'Немає в наявності'}</p><p>Продавець: ${escapeHtml(product.storeName)}</p></li>`).join('')}</ul>` : '<p>На цій сторінці немає опублікованих пропозицій.</p>'}${page.nextCursor ? link(path + '?after=' + encodeURIComponent(page.nextCursor), 'Наступні товари →') : ''}</section>`).join('')}`);
}
function productDescription(product: PublicCatalogProduct): string {
  return (product.description.trim() || `${product.name}. ${product.type}, ${product.colorName}, ${product.spoolWeightGrams} г. ${formatUah(product.priceUah)}. Продавець: ${product.storeName}.`).slice(0, 180);
}
async function html(request: Request, env: CatalogEnv, page: Page): Promise<Response> {
  if (!env.ASSETS) throw new ApiError(503, 'Сайт тимчасово недоступний.');
  const source = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!source.ok || !source.headers.get('Content-Type')?.includes('text/html')) throw new ApiError(503, 'Сайт тимчасово недоступний.');
  const status = page.status || 200;
  const headers = new Headers(source.headers);
  for (const name of ['Content-Length', 'ETag', 'Last-Modified']) headers.delete(name);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', status === 200 ? 'public, max-age=300' : 'no-store');
  headers.set('X-Robots-Tag', status === 200 ? 'index, follow' : 'noindex, nofollow');
  if (page.retryAfter) headers.set('Retry-After', String(page.retryAfter));
  const metadata = `<link rel="canonical" href="${escapeHtml(ORIGIN + page.path)}"><meta name="robots" content="${status === 200 ? 'index, follow' : 'noindex, nofollow'}"><meta property="og:url" content="${escapeHtml(ORIGIN + page.path)}">${page.product ? `<script id="catalog-jsonld" type="application/ld+json">${serializeJson(catalogProductStructuredData(page.product))}</script>` : ''}`;
  let rewriter = new HTMLRewriter()
    .on('title', { element: element => element.setInnerContent(page.title) })
    .on('meta[name="description"], meta[property="og:description"]', { element: element => element.setAttribute('content', page.description) })
    .on('meta[property="og:title"]', { element: element => element.setAttribute('content', page.title) })
    .on('meta[property="og:type"]', { element: element => element.setAttribute('content', page.product ? 'product' : 'website') })
    .on('link[rel="canonical"], meta[name="robots"], meta[property="og:url"], #catalog-jsonld', { element: element => element.remove() })
    .on('head', { element: element => element.append(metadata, { html: true }) })
    .on('#root', { element: element => element.setInnerContent(page.body, { html: true }) });
  if (page.standalone) rewriter = rewriter.on('script[type="module"]', { element: element => element.remove() });
  if (page.path.startsWith('/products/')) rewriter = rewriter.on('body', { element: element => element.append(`<script id="catalog-product-data" type="application/json">${serializeJson({ path: page.path, product: page.product || null, status })}</script>`, { html: true }) });
  return rewriter.transform(new Response(source.body, { status, headers }));
}
export function createCatalogSeo(firebase: Pick<ReturnType<typeof createImportFirebase>, 'catalogReader'> = createImportFirebase()) {
  return { async fetch(request: Request, env: CatalogEnv, context: Context): Promise<Response> {
    const url = new URL(request.url);
    const api = url.pathname.startsWith('/api/catalog/');
    const path = api ? url.pathname.slice('/api/catalog'.length) : url.pathname;
    const productRoute = path.startsWith('/products/');
    let canonicalPath = path;
    let response: Response;
    const head = (result: Response) => request.method === 'HEAD' ? new Response(null, result) : result;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      let cursor: string | undefined;
      if (productRoute) {
        let parts: string[];
        try { parts = path.split('/').slice(2).map(decodeURIComponent); } catch { throw new ApiError(404, 'Товар не знайдено.'); }
        if (!(parts[0] === 'offer' && parts.length === 2 || parts[0] === 'filament' && parts.length === 3)) throw new ApiError(404, 'Товар не знайдено.');
        catalogId(parts[1]);
        if (parts[2]) catalogId(parts[2], PUBLIC_CATALOG_TEXT_LIMITS.id);
        canonicalPath = '/products/' + parts.map(encodeURIComponent).join('/');
      } else if (path === '/catalog/offers' || path === '/catalog/filaments') {
        const after = url.searchParams.getAll('after');
        if (after.length > 1) throw new ApiError(404, 'Сторінку не знайдено.');
        cursor = after[0] ? catalogId(after[0]) : undefined;
        canonicalPath = path + (cursor ? '?after=' + encodeURIComponent(cursor) : '');
      } else if (!['/', '/filaments', '/sitemap.xml', '/robots.txt'].includes(path)) throw new ApiError(404, 'Сторінку не знайдено.');
      const canonicalRequest = (api ? '/api/catalog' : '') + canonicalPath;
      if (url.hostname.endsWith('.workers.dev') || url.pathname + url.search !== canonicalRequest) return head(Response.redirect(ORIGIN + canonicalRequest, 308));
      const cache = (caches as CacheStorage & { default: Cache }).default;
      const key = new Request(ORIGIN + '/__catalog_seo_v1' + canonicalRequest);
      const cached = await cache.match(key);
      if (cached) return head(cached);
      if (path === '/robots.txt') response = new Response(`User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${ORIGIN}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
      else if (path === '/') response = await html(request, env, { path, title: 'KILO·G — Розрахунок собівартості 3D-друку', description: 'Розрахунок собівартості FDM-друку, матеріали, принтери та каталог пластиків із пропозиціями продавців.', body: shell('<h1 class="text-3xl font-bold">Розрахунок собівартості 3D-друку</h1><p>Розраховуйте витрати на філамент, машинний час, електроенергію й податки за підтримуваними файлами Bambu Studio, OrcaSlicer та PrusaSlicer.</p><h2 class="text-xl font-semibold">Каталог пластиків для 3D-друку</h2><p>Порівнюйте матеріали, кольори, ціни та пропозиції продавців.</p>' + link('/filaments', 'Переглянути каталог пластиків →') + '<h2 class="text-xl font-semibold">Особистий кабінет майстерні</h2><p>Зберігайте матеріали, принтери, шаблони та історію розрахунків.</p>' + link('/auth/register', 'Створити акаунт')) });
      else {
        if (!env.ANALYTICS_DB || !env.ANALYTICS_RATE_LIMIT || !env.FIREBASE_IMPORT_SERVICE_ACCOUNT) throw new ApiError(503, 'Каталог тимчасово недоступний.', 60);
        const limited = await env.ANALYTICS_RATE_LIMIT.limit({ key: 'seo:' + (request.headers.get('CF-Connecting-IP') || 'unknown') });
        if (!limited.success) throw new ApiError(503, 'Забагато запитів. Спробуйте пізніше.', 60);
        const reader = await firebase.catalogReader(env.FIREBASE_PROJECT_ID, env.FIREBASE_IMPORT_SERVICE_ACCOUNT, env.ANALYTICS_DB);
        const catalog = createPublicCatalog(reader, env.ANALYTICS_DB);
        if (productRoute) {
          const product = await catalog.product(canonicalPath);
          if (!product) throw new ApiError(404, 'Товар не знайдено.');
          response = api ? Response.json({ path: canonicalPath, product, status: 200 }, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } })
            : await html(request, env, { path: canonicalPath, title: product.name + ' | KILO·G', description: productDescription(product), product, body: productBody(product) });
        } else if (path === '/sitemap.xml') {
          const entries = new Map<string, string | undefined>([['/', undefined], ['/filaments', undefined], ['/privacy', undefined]]);
          for (const method of ['offers', 'filaments'] as const) {
            let after: string | undefined;
            do {
              const page = await catalog[method](after);
              for (const product of page.products) entries.set(product.path, product.updatedAt);
              if (entries.size > 50000 || page.nextCursor === after) throw new ApiError(503, 'Карта сайту тимчасово недоступна.', 3600);
              after = page.nextCursor || undefined;
            } while (after);
          }
          const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...entries].map(([location, updated]) => `<url><loc>${escapeHtml(ORIGIN + location)}</loc>${updated ? `<lastmod>${escapeHtml(updated)}</lastmod>` : ''}</url>`).join('')}</urlset>`;
          response = new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
        } else {
          const groups = path === '/filaments' ? [{ path: '/catalog/offers', page: await catalog.offers() }, { path: '/catalog/filaments', page: await catalog.filaments() }]
            : [{ path, page: await catalog[path.endsWith('offers') ? 'offers' : 'filaments'](cursor) }];
          response = await html(request, env, { path: canonicalPath, title: 'Каталог пластиків для 3D-друку | KILO·G', description: 'Пластики для 3D-друку: ціни, кольори, вага котушок, профілі друку та пропозиції продавців.', body: listBody('Каталог пластиків для 3D-друку', groups), standalone: path !== '/filaments' });
        }
      }
      context.waitUntil(cache.put(key, response.clone()).catch(() => {}));
      return head(response);
    } catch (error) {
      const status = error instanceof ApiError && error.status === 404 ? 404 : 503;
      const retryAfter = status === 503 ? error instanceof ApiError && error.retryAfter || 60 : undefined;
      if (api) return head(Response.json({ path: canonicalPath, product: null, status }, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } }));
      const title = status === 404 ? 'Сторінку не знайдено' : 'Каталог тимчасово недоступний';
      if (path === '/sitemap.xml') return head(new Response(title, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Retry-After': String(retryAfter || 60) } }));
      try { return head(await html(request, env, { path: canonicalPath, title: title + ' | KILO·G', description: title, body: shell(`<h1 class="text-2xl font-bold">${title}</h1><p>${status === 404 ? 'Пропозицію видалено або вона ще не опублікована.' : 'Спробуйте ще раз пізніше.'}</p>${link('/filaments', 'Переглянути каталог')}`), status, retryAfter, standalone: path.startsWith('/catalog/') })); }
      catch { return head(new Response(title, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } })); }
    }
  } };
}
export default createCatalogSeo();
