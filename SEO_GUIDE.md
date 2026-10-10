# Індексація каталогу KILO·G

Публічні опубліковані пропозиції мають постійні сторінки `/products/offer/{id}`. Варіанти загального каталогу — `/products/filament/{parentId}/{skuId}`. Cloudflare віддає назву, характеристики, ціну упаковки, наявність і посилання на продавця в початковому HTML: вхід і JavaScript для їх читання не потрібні. React показує ті самі дані, отримані сервером, без повторного читання під час першого відкриття товару.

Кожна сторінка має окремі title/description, canonical на `https://web-dev.pp.ua`, Open Graph та JSON-LD Product/Offer. Ціна — за конкретну упаковку у гривнях, а не ціна за кг. Рейтинг, відгуки й фотографії не вигадуються. Structured data не гарантує розширеного результату Google.

`/filaments` містить звичайні посилання на товари. `/catalog/offers` та `/catalog/filaments` — публічні HTML-сторінки з курсорною пагінацією; наступні сторінки мають власну canonical URL. Курсор рухається за первинними записами навіть коли ціла сторінка містить приховані компанії. Кольори/варіанти одного матеріалу не обрізаються між сторінками.

`/robots.txt` посилається на `/sitemap.xml`. У sitemap потрапляють лише видимі товари; lastmod береться з фактичного updatedAt, без підставлення дати відкриття. Чернетки, відключені компанії, видалені legacy-записи та посилання поза allowedDomains не індексуються. Відсутні/приховані товари повертають 404, тимчасова помилка сервісу — 503 з Retry-After й no-store. Кабінет та сторінки авторизації мають X-Robots-Tag noindex і заборонені для обходу robots.txt; це доповнення до реального контролю доступу, а не його заміна.

## Кеш і безкоштовні квоти

Публічний HTML/JSON кешується до 5 хвилин, sitemap — до години; кеш однаковий для всіх і не залежить від cookie/Authorization. Раніше опубліковані дані можуть бути видимими ще 5 хвилин після приховування. 404/503 не кешуються. Статичні JS/CSS, кабінет і авторизація залишаються assets; глобальний Workers Cache, який змінює їх тарифікацію, не вмикається.

У Cloudflare для домену Browser Cache TTL має бути **Respect Existing Headers**. Значення 4 hours переписувало коротші max-age Worker; це виправлено й перевірено на живому домені. Воно не очищає вже збережені копії у браузерах. [Документація Cloudflare](https://developers.cloudflare.com/cache/how-to/edge-browser-cache-ttl/set-browser-ttl/).

Нова таблиця D1 `catalog_seo_daily` атомарно обмежує серверні читання: до 500 звернень до Firestore та до 5000 зарезервованих документів на добу Pacific (час скидання Firestore Spark). Окремий SEO-key native rate limiter — 60 холодних запитів/хвилину на IP; cache hits не читають Firestore. Помилки списку не підмінюються демонстраційними товарами. Маски читають лише 4 публічні колекції й ніколи UID, email, ролі чи API-ключі.

Один HTTP-запит має максимум 40 зовнішніх викликів каталогу, залишаючи запас до 50 subrequests Free. Великий sitemap, який не можна повністю зібрати в цих межах, повертає 503, а не обрізаний успішний XML. HTML-пагінація залишається способом обходу всіх товарів. Для каталогу на сотні/тисячі позицій наступне розширення — попередньо підготовлений розділений sitemap; це не виконувалося в цьому релізі. Добові межі не резервують решту спільної Spark/Cloudflare квоти й не гарантують CPU <10 мс для кожного холодного виклику.

## Дії власника

1. Публікувати реальні пропозиції після перевірки імпорту: чернетки спеціально не показуються Google.
2. Додати `web-dev.pp.ua` у Google Search Console, підтвердити власність DNS-записом і надіслати `https://web-dev.pp.ua/sitemap.xml`.
3. Через URL Inspection перевірити опубліковану сторінку товару. Через Rich Results Test перевірити Product markup; необов'язкові відсутні поля не замінювати вигаданими.
4. Стежити за індексацією, Usage, помилками 503 та CPU; самі зміни коду не гарантують позицій у Google.

Документація: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Product snippets](https://developers.google.com/search/docs/appearance/structured-data/product-snippet), [Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).
