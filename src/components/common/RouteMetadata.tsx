import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function setPageMetadata(page: { title: string; description: string; path: string; indexable: boolean; type?: 'website' | 'product'; structuredData?: unknown }): void {
  document.title = page.title;
  const meta = (attribute: 'name' | 'property', key: string, content: string) => {
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.append(element);
    }
    element.content = content;
  };
  const canonicalUrl = `https://web-dev.pp.ua${page.path}`;
  meta('name', 'description', page.description);
  meta('name', 'robots', page.indexable ? 'index,follow' : 'noindex,follow');
  meta('property', 'og:title', page.title);
  meta('property', 'og:description', page.description);
  meta('property', 'og:type', page.type || 'website');
  meta('property', 'og:url', canonicalUrl);
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = canonicalUrl;
  document.getElementById('catalog-jsonld')?.remove();
  if (page.structuredData) {
    const script = document.createElement('script');
    script.id = 'catalog-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(page.structuredData);
    document.head.append(script);
  }
}

export function RouteMetadata() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (/^\/products\/(offer\/[^/]+|filament\/[^/]+\/[^/]+)$/.test(pathname)) return;
    const description = 'KILO·G — калькулятор собівартості FDM 3D-друку та каталог пластиків із цінами, характеристиками й пропозиціями продавців.';
    const page = pathname === '/filaments'
      ? { title: 'Каталог пластиків для 3D-друку — ціни та пропозиції | KILO·G', description: 'Порівнюйте PLA, PETG, ABS та інші пластики для 3D-друку: ціни, кольори, вага, профілі друку й посилання на продавців.', indexable: true }
      : pathname === '/privacy'
        ? { title: 'Дані та приватність | KILO·G', description: 'Як KILO·G обробляє дані акаунта, кукі та аналітику каталогу. Налаштування приватності.', indexable: true }
        : { title: 'KILO·G — Калькулятор собівартості 3D-друку та каталог пластиків', description, indexable: pathname === '/' };
    setPageMetadata({ ...page, path: pathname });
  }, [pathname]);
  return null;
}
