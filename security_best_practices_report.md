# KILO·G — перевірка безпеки

Дата: **9 жовтня 2026**. Перевірений код: `7a58f1c03975ac558b72b22753841c225c07295c`, гілка `codex/user-platform`. Використано скіл [security-best-practices](C:/Users/webde/.codex/skills/security-best-practices/SKILL.md), його інструкції для React і загального JavaScript frontend; Cloudflare Workers/Firebase перевірені за кодом, локальними тестами та офіційною документацією.

## Результат

**Оновлення після відновлення роботи 9 жовтня:** SEC-001 виправлено локально. Атомарна квота UID виконується до читання Firebase; бюджети manager/admin розділені, 401/403 не споживають їх. Regression на справжніх локальних Worker/D1 перевіряє відхилені запити, припинення Firebase reads на особистому ліміті, незалежний admin reserve й атомарність при конкуренції. Нижче збережено результати початкового аудиту; зміна ще не опублікована.

У перевірених сценаріях не підтверджено викрадення ключів, підвищення ролі, доступу менеджера до іншої компанії або виконання довільного коду. **Виявлено чотири питання середнього пріоритету та одне низького.** Найперше виправлення перед публікацією REST API — спільна квота перевірок доступу, яку може витрачати звичайний користувач. Це відтворено локально на реальних D1/Worker та Firestore emulator.

125 цільових автоматичних перевірок пройшли: 60 application/Worker tests і 65 Rules/Firestore/D1/Queues checks, включно з контрольним відтворенням недоліку квоти. `npm audit --omit=dev`: **0 відомих вразливостей**. Повний `npm audit`: **11 повідомлень — 7 high, 4 moderate**, усі у development dependencies Firebase CLI; їхня severity не означає наявність відповідних публічних endpoint на сайті.

Функціональний код, правила, credentials та production конфігурація під час аудиту не змінені. Новий API **ще не задеплоєний**. На живому сайті виконано тільки read-only перевірку HTTP-заголовків. Аудит не є гарантією відсутності будь-яких вразливостей.

## Межі перевірки

TypeScript/React SPA, Firebase Auth, Firestore Rules і repositories, Cloudflare Worker з Turnstile/аналітикою/імпортом, D1, Queue consumer, JSON та файлові завантаження, Git/CI і npm lockfile. Враховано анонімного відвідувача, звичайного підтвердженого користувача, менеджера власної компанії та адміністратора. Сервісний акаунт імпорту є привілейованою серверною межею: OAuth застосовує IAM і обходить Rules; права користувача має перевіряти Worker. [Firestore REST authentication](https://firebase.google.com/docs/firestore/use-rest-api).

Не запускалися атаки чи навантаження на production, не створювалися live акаунти, не надсилалися листи, не читалися чужі приватні документи або секрети. IAM, обмеження публічного Google API key, password policy, App Check enforcement та доступи людей у консолях окремо не перевірені в live конфігурації.

## Середній пріоритет

### SEC-001 — звичайний користувач може вичерпати спільну квоту REST API

- **Правило:** авторизація й захист доступності / CWE-400. **Стан:** підтверджений недолік локального API; до production не опублікований. **Впевненість:** висока.
- **Місце:** [workers/importApi.ts:33](D:/AI_Work/PrintCost/workers/importApi.ts:33), [workers/importApi.ts:58](D:/AI_Work/PrintCost/workers/importApi.ts:58), [src/domain/apiImports.ts:8](D:/AI_Work/PrintCost/src/domain/apiImports.ts:8).
- **Доказ:** `await budget(db)` виконується перед `firebase.scope(...)`; `dailyAccessChecks: 1000` є спільним для всіх. Криптографічно правильний JWT звичайного підтвердженого користувача проходить до цієї операції, а перевірка ролі лише потім повертає 403.
- **Відтворення:** в ізольованому D1 встановлено `access_checks=999`; GET `/api/v1/api-key` від користувача без admin/manager повернув 403 і збільшив лічильник до 1000. Наступний GET адміністратора отримав 429. Дані production не використовувалися.
- **Наслідок:** непривілейований користувач може позбавити адміністратора/менеджерів HTTP-доступу до ключів, приймання імпортів і статусів до наступної UTC-доби. Уже прийняті завдання мають окремий consumer і не обов'язково зупиняться. Межа 30/хв на UID/IP сповільнює витрачання квоти, але не ізолює денний бюджет.
- **Рекомендація:** розділити бюджет перевірок недовірених запитів за UID/IP і бюджет уже авторизованих привілейованих користувачів; передбачити резерв для адміністратора. Не переносити глобальний лічильник після дорогих Firebase запитів без окремого попереднього обмеження витрат. Додати постійний regression test: багато 403 від user не забирають admin-бюджет.

### SEC-002 — Turnstile не примушує проходити CAPTCHA при прямому Firebase Auth запиті

- **Правило:** серверна перевірка антибот-захисту / REACT-AUTHZ-001. **Стан:** відома архітектурна межа поточної інтеграції; стосується наявних публічних форм. **Впевненість:** висока щодо коду, live App Check enforcement не перевірено.
- **Місце:** [src/services/turnstileService.ts:7](D:/AI_Work/PrintCost/src/services/turnstileService.ts:7), [src/services/authService.ts:222](D:/AI_Work/PrintCost/src/services/authService.ts:222), [src/services/authService.ts:236](D:/AI_Work/PrintCost/src/services/authService.ts:236), [src/services/authService.ts:275](D:/AI_Work/PrintCost/src/services/authService.ts:275), [src/services/firebaseClient.ts:17](D:/AI_Work/PrintCost/src/services/firebaseClient.ts:17).
- **Доказ:** сайт спочатку отримує `{success:true}` від Worker Siteverify, потім браузер окремо викликає `signInWithEmailAndPassword`, `createUserWithEmailAndPassword` або `sendPasswordResetEmail`. Firebase не отримує обов'язкового серверного доказу цієї Turnstile-перевірки. App Check SDK у коді не ініціалізований; shortcut-коментар уже позначає цю межу.
- **Наслідок:** бот може звертатися до Auth API без форми й CAPTCHA сайту, витрачати квоти реєстрації/відновлення або робити спроби входу. Це **не** дає правильного пароля, підтвердженої email-адреси, admin-ролі чи доступу до чужих Firestore документів. Власні обмеження Firebase залишаються.
- **Рекомендація:** перевірити API restrictions і реалістичні quotas `identitytoolkit.googleapis.com`, password policy та захист привілейованих облікових записів. Для повного attestation/enforcement оцінити Firebase App Check для Auth; офіційно він потребує Firebase Authentication with Identity Platform. Спершу перевірити сумісність з вимогою Free/Spark, не вмикати платний тариф автоматично. Звичайне перенесення SDK-виклику у Worker або приховування публічного Firebase config не закриває прямий endpoint. [Firebase API keys і Auth abuse](https://firebase.google.com/docs/projects/api-keys#tighten-quota), [Firebase App Check для Auth](https://firebase.google.com/docs/auth/faq-and-troubleshooting).

### SEC-003 — публічні читання Firestore обходять Cloudflare квоти

- **Правило:** захист доступності / CWE-400. **Стан:** архітектурний ризик чинного каталогу. **Впевненість:** висока щодо маршрутів коду; фактичну атаку й вичерпання live-квоти не запускали.
- **Місце:** [firestore.rules:553](D:/AI_Work/PrintCost/firestore.rules:553), [firestore.rules:591](D:/AI_Work/PrintCost/firestore.rules:591), [firestore.rules:603](D:/AI_Work/PrintCost/firestore.rules:603), [src/services/companyOfferRepository.ts:117](D:/AI_Work/PrintCost/src/services/companyOfferRepository.ts:117), [src/services/companyOfferRepository.ts:133](D:/AI_Work/PrintCost/src/services/companyOfferRepository.ts:133).
- **Доказ:** `allow get: if true` на публічних довідниках/компаніях і прямі `getDocFromServer`/`getDocsFromServer` у браузері. Rules обмежують розмір сторінки, а не число запитів за час. Ліміти Worker для аналітики та імпорту ці звернення не бачать. Авторизовані приватні записи також ідуть напряму до Firestore і не використовують денний бюджет імпорту.
- **Наслідок:** повторні читання публічних документів можуть вичерпати спільну Spark-квоту й зробити базу недоступною іншим користувачам. Публічна видимість каталогу тут очікувана; проблема стосується доступності, а не витоку приватних даних. Free allowance має 50 000 reads/день і 20 000 writes/день. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas).
- **Рекомендація:** для стійкого публічного каталогу розглянути окрему кешовану публічну проєкцію через Cloudflare/static snapshot з обмеженнями на сервері й закриттям прямого anonymous Firestore шляху після міграції клієнта. Просто додати proxy, залишивши `allow get: if true`, недостатньо. App Check для Firestore, періодичний контроль Usage і обмеження власних записів можуть зменшити ризик, але не є абсолютним захистом від зловживання легітимним клієнтом. Змінити разом із читаннями аналітики, які зараз теж використовують публічний Firestore REST.

### SEC-004 — на живому сайті немає Content Security Policy

- **Правило:** REACT-CSP-001 / REACT-HEADERS-001. **Стан:** підтверджене незавершене посилення захисту; експлуатацію XSS не знайдено. **Впевненість:** висока для перевіреної login-сторінки.
- **Місце:** [public/_headers:1](D:/AI_Work/PrintCost/public/_headers:1), [index.html:16](D:/AI_Work/PrintCost/index.html:16), [src/services/firebaseClient.ts:17](D:/AI_Work/PrintCost/src/services/firebaseClient.ts:17).
- **Доказ:** HEAD `https://web-dev.pp.ua/auth/login` повернув `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` і `Referrer-Policy: strict-origin-when-cross-origin`, але без `Content-Security-Policy` та report-only політики. CSP meta також немає.
- **Наслідок:** якщо з'явиться XSS або буде скомпрометовано дозволений сторонній скрипт, браузер не має додаткової політики обмеження скриптів/відправки даних. Це особливо суттєво для SPA з доступною JavaScript Firebase-сесією. Сам факт відсутності CSP не доводить наявність XSS.
- **Рекомендація:** підготувати CSP спочатку report-only, перевірити Google popup, Firebase, Turnstile, Google Fonts, Blob/Web Workers, графіки та друк; далі ввімкнути enforcement. Inline theme script винести у файл або використати hash/nonce. Не додавати глобальний `unsafe-eval` чи широку wildcard-політику для усунення помилок. [Сумісність CSP з Turnstile](https://developers.cloudflare.com/turnstile/reference/content-security-policy/).

## Низький пріоритет для публічного застосунку

### SEC-005 — відомі вразливості у dependency tree Firebase CLI

- **Правило:** REACT-SUPPLY-001. **Стан:** підтверджений dependency audit; публічної експлуатації через цей застосунок не знайдено.
- **Місце:** [package.json:53](D:/AI_Work/PrintCost/package.json:53), [package-lock.json:4850](D:/AI_Work/PrintCost/package-lock.json:4850), [package-lock.json:5030](D:/AI_Work/PrintCost/package-lock.json:5030), [package-lock.json:6868](D:/AI_Work/PrintCost/package-lock.json:6868).
- **Доказ:** `firebase-tools` 15.33.0 та транзитивні `basic-ftp` 5.3.1, `braces` 3.0.3, `@opentelemetry/core` 1.30.1 і `uuid` 9.0.1 позначені `dev:true`. Audit: 11 affected dependency entries, а не 11 незалежних атак; частина повідомлень успадкована через батьківські пакети. `--omit=dev` повернув 0.
- **Наслідок:** ризик для локального/CI інструментарію при обробці відповідних недовірених inputs. Worker не використовує FTP directory listing, glob-парсер braces або OpenTelemetry baggage цих CLI dependency; JSON імпорту й 3D-файли не потрапляють у ці функції.
- **Рекомендація:** окремо перевірити підтримуване оновлення Firebase CLI/транзитивних залежностей і сумісність емуляторів. Не запускати `npm audit fix --force`: запропонований downgrade major не є перевіреним виправленням. Для basic-ftp advisory вказує patch 6.2.1; для braces на дату перевірки patch не зазначений, тому обіцянки «виправити все одним оновленням» немає. [basic-ftp advisory](https://github.com/advisories/GHSA-c475-qrg2-pj4r), [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Що перевірено й працює у покритих сценаріях

- JWT: RS256, реальний підпис, project/audience/issuer/time, verified email; підроблені й прострочені токени відхиляються. Кешуються тільки Google public keys.
- Авторизація: актуальні registry/membership/block/company/deletion; API додатково перевіряє поточний Auth user, disabled/deleted і validSince. Менеджер має тільки власну активну компанію та точні дозволені hostname. Role/control документи клієнт не може змінювати довільно.
- Ключі: випадкові 256 біт, D1 містить SHA-256 і короткий prefix; plaintext одноразово повертається й не зберігається у localStorage. Ротація/відкликання потребує auth_time до 5 хвилин і не скидає cooldown.
- Записи: bound SQL parameters, жорстка JSON-схема, 100 записів/128 KiB, атомарна квота/idempotency, приватні receipts, CAS/lease, відновлення неоднозначного commit. Доступ до чужого job відхиляється.
- URL: HTTPS без userinfo/ports, точне зіставлення домену; імпорт не робить HTTP-запит до URL товару. Серверний OAuth обмін і Firestore calls використовують фіксовані Google hosts з timeout, bounded response і manual redirect — SSRF через product URL не знайдено.
- Turnstile endpoint: справжній Siteverify, exact action/hostname, строк token, відмова при replay/помилці/missing binding. Локальний bypass не дозволений на production hostname.
- UI: не знайдено `dangerouslySetInnerHTML`, `eval` чи `new Function` з користувацькими даними. Єдиний `document.write` для друку екранує `&<>"'`, а дочірнє вікно від'єднує opener; підтвердженого XSS у цьому шляху немає.
- Файли: ліміти compressed/uncompressed ZIP та metadata, сегментів/координат 3D, timeout із terminate Worker; логотипи приймають PNG/JPEG/WebP і перекодовуються. Завантаження активного SVG/HTML у логотип не дозволено.
- Git: за перевіреними шаблонами не знайдено committed private keys, персональних API-ключів, GitHub/OAuth tokens у поточному tracked коді; історія перевірена за шаблонами приватних ключів/GitHub tokens. Публічний Firebase web API key у `.env.production` очікуваний і не дорівнює service account secret. Його API restrictions лишаються окремою live перевіркою. [Firebase public API keys](https://firebase.google.com/docs/projects/api-keys).
- CI: `npm ci`, lockfile, `contents: read`, без production credentials і без deploy job. Публікацію нової API інфраструктури під час аудиту не виконано.

## Подальші завдання

- [x] SEC-001 виправлено та покрито regression локально; перед релізом застосувати міграцію 0003 разом із сумісним Worker.
- [ ] SEC-002 погодити й перевірити варіант захисту Auth, що відповідає вимозі безкоштовності; перевірити restrictions/quotas/password policy.
- [ ] SEC-003 підготувати захищений і кешований публічний read-шлях з урахуванням поточного SDK/аналітики.
- [ ] SEC-004 підготувати й перевірити CSP перед окремо дозволеним релізом.
- [ ] SEC-005 перевірити безпечний шлях оновлення development toolchain без сліпого force/downgrade.
- [ ] Окремо перевірити live IAM сервісного акаунта, доступи до консолей, реальний usage/CPU і квоти після команди на активацію.

Решта реалізації та деплой лишаються на паузі. Докази без production credentials: ігноровані `output/security-unit-tests.log`, `output/security-integration-tests.log`, `output/security-import-budget.integration.ts`, `output/security-live-headers.json`, `output/security-npm-audit*.json`. Недолік SEC-001 можна відтворити, додавши описану перевірку лічильника до існуючого `tests/importApiRuntime.integration.ts`; копія для цього аудиту не змінювала tracked тест.
