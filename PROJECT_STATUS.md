# KILO·G — стан проєкту та задач

Стан перевірено **9 жовтня 2026, 02:38 Europe/Kyiv** (8 жовтня, 23:38 UTC). Це знімок стану для продовження роботи; докладний план — [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md), інструкції випуску й відновлення — [OPERATIONS.md](./OPERATIONS.md).

**Висновок:** реалізовані функції опубліковані; публічний сайт, калькулятор і 3D-прев’ю працюють. Cloudflare, Firebase Rules/indexes та D1 відповідають релізу. Повне живе приймання авторизації, адміністративних дій і звітів ще не завершене; нижче ці задачі залишені відкритими.

## Пауза публікації та посилання з листів

Після останньої перевірки власник дав команду **«не деплой доки не скажу»**. До явної команди не публікувати Worker/Firebase і не зберігати зміни live-конфігурації Authentication; локальна підготовка та read-only перевірки дозволені.

9 жовтня, 06:42 UTC, read-only GET конфігурації Firebase підтвердив поточний `notification.sendEmail.callbackUri`: `https://kilo-g.firebaseapp.com/__/auth/action`. Це стандартний Firebase handler. Щоб нові листи відкривали сайт KILO·G, потрібно задати `https://web-dev.pp.ua/auth/callback` у **Authentication → Templates → Customize action URL**. Домен уже дозволений; обидва bare URL без коду повертають HTTP 200. Код застосунку вже містить callback для підтвердження email та скидання пароля. `ActionCodeSettings.url` задає `continueUrl`, а не handler. Доказ без credentials: `output/email-action-config-proof.json` (ігнорований файл). Production writes, читання користувачів/кодів і надсилання листів у цьому проходженні — 0.

## Оновлення 9 жовтня: капча публічних форм

Cloudflare Turnstile реалізовано для входу, реєстрації, запиту відновлення пароля, встановлення нового пароля за посиланням і повторного листа підтвердження. Worker `/api/turnstile/verify` перевіряє Siteverify, HTTPS Origin/hostname, action, строк і одноразовість токена; використовує спільний native limiter 60 спроб/хв за IP для цих п’яти дій. Паролі й email через цей маршрут не проходять, D1 не використовується. Відсутні ключі, недоступність перевірки, неправильний токен і квота блокують надсилання форми з повідомленням українською.

Локально пройшли **122 app/Turnstile/runtime + 95 emulator = 217 автоматичних перевірок**, TypeScript, production build, deployment validator і Wrangler dry-run. CUA на ізольованій тестовій збірці з офіційним dummy sitekey підтвердив блокування до токена, успішний віджет у вході/реєстрації/відновленні, один script після переходів та відсутність віджета для reset-посилання без коду. Знайдену несумісність `turnstile.ready()` з async script усунено: використовується подія `load` перед explicit render.

Код і документацію опубліковано у `codex/user-platform`, source `2fbe4aa2a56f7e283b6eed18bfeb0d140e4649ab`. Обидва CI цього source-коміту успішні: [push 37894337235](https://github.com/WebDev-Den/PrintCost/actions/runs/37894337235), [PR 37894341133](https://github.com/WebDev-Den/PrintCost/actions/runs/37894341133), включно з 217 тестами, TypeScript, production build і dry-run. Опис draft PR #1 оновлено; merge у `main` не виконувався.

Віджет **KILO-G public forms**, public sitekey `0x4AAAAAAFR_dav3sbi3wfEO`, Managed, без pre-clearance, створено для `web-dev.pp.ua` та `kilo-g.web-developer-den.workers.dev`. **Деплой цього доповнення ще очікує** доступу CLI `challenge-widgets.write`: поточний Turnstile API повертає 403. Перший ще не опублікований секрет випадково потрапив у технічний вивід; перед релізом він має бути негайно анульований ротацією. Новий секрет передається лише як Worker secret, через ігнорований файл із ACL; у Git/VITE його не додають. Активний production нижче поки залишається попереднім релізом без капчі.

Захист стосується потоку форм цього сайту. Прямі Firebase Auth API не проходять через Turnstile preflight; окремий Firebase App Check залишається за межами цього доповнення. Реальні паролі, листи й private production writes для тесту не виконувалися. Локальні докази: `output/turnstile-widget-settings.png` (два hostname й Managed), `output/turnstile-registration-test.png` (успішний тестовий віджет). Секрети у screenshots відсутні.

## Активний реліз

| Компонент | Підтверджений стан |
|---|---|
| Основний сайт | https://web-dev.pp.ua |
| Резервна адреса Worker | https://kilo-g.web-developer-den.workers.dev |
| Розміщення | Cloudflare Worker `kilo-g`, Static Assets + API; використовується лише цей Worker |
| Source commit опублікованого коду | `4f50eed791460956779f92ba6a197c1b303229c3` |
| Активна версія Worker | `fc5cd99f-86bb-4675-bc17-4f36e28903bd`, **100% трафіку**, створена `2026-10-08T23:27:54.587751Z` |
| Попередня версія для відкату | `2c962240-21ea-403f-944a-64257259a0b9` |
| Git на початку перевірки | `codex/user-platform`, HEAD `104e1f13cc6f1de6f4f5d5a4e0f31b902096d411`; відмінності від deployed source — лише документація |
| GitHub | [WebDev-Den/PrintCost](https://github.com/WebDev-Den/PrintCost), [draft PR #1](https://github.com/WebDev-Den/PrintCost/pull/1) у `main` |
| Firebase | Проєкт `kilo-g`, Firestore `(default)`, Standard / `eur3`, **Spark**, billing вимкнений, billing account не прив’язаний |
| Authentication | Email/Password увімкнений, email enumeration protection увімкнений, `web-dev.pp.ua` дозволений |
| Опублікований Rules ruleset | `1641cc1d-19ef-4d8b-9b06-e049627c13a9` |
| SHA-256 Rules | `54e352eb8f7cc169999e0cec670ebdd76827c6ab6f4f106c8a8917f062c564d2` — локальний і опублікований файли збігаються побайтово |
| Firestore indexes | **3/3 READY**; індексування `companyLogos.imageDataUrl` вимкнене |
| D1 | `kilog-analytics`, ID `d837dab8-8871-43d1-8cfc-df6c4d03b8d2`, binding `ANALYTICS_DB` |
| D1 migration | `0001_analytics.sql`, receipt ID `1`, застосована `2026-10-08 22:18:51`; усі **12 SQL-об’єктів** збігаються з локальною міграцією після нормалізації пробілів |
| API / очищення | Native rate limiter **60/60 секунд**, cron **`0 2 * * *` UTC**, `FIREBASE_PROJECT_ID=kilo-g`, `ASSETS` binding присутній |

Cloudflare Free / $0 підтверджено через консоль під час випуску 9 жовтня. Повторна перевірка Firebase підтвердила відсутність billing; тарифи й платні сервіси в цьому проходженні не змінювалися. Безкоштовність залежить від квот, описаних у OPERATIONS.md.

## Перевірки цього проходження

- [x] Cloudflare API: активна версія / 100% трафіку, D1 binding, rate limiter, Static Assets, Firebase project, cron і custom domain — **7/7 PASS**.
- [x] HTML калькулятора, main JS, CalculatorPage, Three.js preview chunk і preview worker на **обох доменах** — **10/10 побайтових порівнянь з `dist` PASS**. Прямий SPA URL працює.
- [x] `/`, `/auth/login`, `/auth/callback`, `/app/calculator`, `/app/calculations` повертають **HTTP 200**; security headers `nosniff` / `DENY` присутні. Збірка містить production Firebase config, конфігурації емулятора немає.
- [x] Публічне читання каталогу у Firestore — **200**; анонімне читання приватного тестового шляху — **403**.
- [x] Валідний запит `/api/analytics/report?companyId=all&from=2026-10-09&to=2026-10-09` без входу на обох доменах — **401**. Це підтверджує закритий доступ, а не роботу авторизованого звіту.
- [x] Firebase: exact Rules readback, три індекси READY, exemption для зображення, Email/Password, email privacy, production domain та відсутність billing — **PASS**.
- [x] D1 через наявну Cloudflare Console: свіжі read-only SELECT схеми та receipt міграції; **12/12 об’єктів PASS**. CLI SQL-запит повернув `7403` через обмежені права; додаткові scopes не запитувалися.
- [x] Браузер на production після перезавантаження: тестовий `preview-two-plates.gcode.3mf`, пластини **2/4**, різні геометрії, масштаб, клавіатура, початковий вигляд — **PASS**. Повний розрахунок: собівартість **106,94 грн**, ціна **220,00 грн**. PLA/PETG dropdown містить лише відповідний тип матеріалу. Адміністративного меню в демо немає.
- [x] GitHub Actions для HEAD на початку перевірки: [push #37859832975](https://github.com/WebDev-Den/PrintCost/actions/runs/37859832975) та [PR #37859836333](https://github.com/WebDev-Den/PrintCost/actions/runs/37859836333) — **SUCCESS**. TypeScript, **190 перевірок**, production build і Wrangler dry run успішні. Публікування цього документа повторно запускає [CI гілки](https://github.com/WebDev-Den/PrintCost/actions?query=branch%3Acodex%2Fuser-platform).

190 перевірок = 95 app + 62 Rules + 10 logo SDK + 6 account SDK + 7 Worker/D1 + 10 operations. Окремі 11 сценаріїв Auth SDK перевірені раніше й **не входять** у це число. Повний локальний suite повторно не запускався: код не змінювався, успішний CI для того самого коду підтверджено.

Докази збережені локально в ігнорованому `output/`: `print-preview-production-proof-1791502533891.json`, `firebase-status-2026-10-09.json`, `d1-production-schema.json`, `deployment-status-verified.png`, `deployment-status-d1.png`. Під час цього проходження акаунти, компанії, приватні розрахунки та події аналітики в production не створювалися; браузерний сценарій виконувався в демо. Коди входу, credentials, приватні експорти й backups у Git не потрапляють.

## Статус функціональних задач

«Готово / задеплоєно» означає завершений код, перевірки й публікацію. Для операцій під реальним акаунтом окремо вказане незавершене живе приймання.

| Задача | Реалізація / публікація | Перевірка / що залишається |
|---|---|---|
| Реєстрація, вхід, підтвердження email, відновлення пароля | Готово / задеплоєно | SDK/емулятор і UI перевірені; реальні листи та новий пароль — відкрита задача |
| Cloudflare Turnstile для п’яти публічних Auth форм | Код і локальні перевірки готові; реліз очікує CLI доступу | 27 нових перевірок включно з реальним workerd/native limiter; віджет і UI перевірені; ротація секрету та live Siteverify ще відкриті |
| Ролі user / manager / admin, bootstrap власника | Готово / задеплоєно | Rules, транзакції, журнал, блокування та захист останнього admin перевірені; production bootstrap / зміна ролі очікують |
| Компанії й призначення менеджера адміністратором | Готово / задеплоєно | Менеджер обмежений власною активною компанією; production створення/призначення очікує |
| Пропозиції пластиків і посилання компанії, публікація одразу | Готово / задеплоєно | HTTPS / дозволені shop domains / scoped Rules перевірені; реальний manager write очікує |
| Логотип компанії: upload / replace / clear | Готово / задеплоєно | PNG/JPEG/WebP, ліміти, 128×128, CAS конфлікти та права перевірені; production upload власником/менеджером очікує |
| Каталог, пошук, фільтри та лише сумісні матеріали у калькуляторі | Готово / задеплоєно | Точний тип пластика перевірений тестами та живим демо; адмінка демо недоступна |
| Приватні матеріали, принтери, тарифи, шаблони й історія | Готово / задеплоєно | SDK/UI persistence, незмінні snapshots, пагінація понад 200 записів перевірені; додаткове приймання власного акаунта очікує |
| Податкова оцінка України: ФОП 1/2/3, загальна система, ручні ставки, опціональний ПДВ | Готово / задеплоєно | Фінансові тести й snapshots перевірені; ставки можна змінювати вручну; перед застосуванням актуальних нормативних ставок перевірити їх дату |
| Аналітика каталогу: 7 подій, dedupe, scope компанії, звіти, квоти й очищення | Готово / задеплоєно | Worker/D1 integration та закритий production report перевірені; авторизований production report і фактичний CPU ще відкриті |
| Експорт, видалення акаунта, міграція/відновлення | Готово; UI опублікований, operations scripts у Git | Integration/operations перевірені; операційні scripts виконуються локально; destructive production smoke не виконується без потреби |
| 3D-прев’ю завантаженого файлу | Готово / задеплоєно | Parser/lifecycle, локальний і production UI перевірені; особисті файли та окремі пристрої ще не перевірені |
| Документація стану та статусів | Готово | Цей файл; зберігається в `codex/user-platform` разом з актуальним планом та інструкціями |

3D-прев’ю показує траєкторії текстового G-code або embedded G-code з нарізаного 3MF; потрібен WebGL 2. Unsliced mesh 3MF/STL, binary `.bgcode`, невідомі firmware-команди та завеликі траєкторії можуть бути недоступні для прев’ю. Відмова прев’ю не блокує розрахунок підтримуваних метаданих. Файл/геометрія не записуються у Firestore або історію.

## Відкриті задачі для завершення живого приймання

- [ ] **EMAIL-ACTION-URL:** після явного дозволу на live-зміни зберегти `https://web-dev.pp.ua/auth/callback` у Firebase email templates; перевірити readback, нові листи підтвердження й відновлення та перехід на свій домен. Збереження змінює URL усіх email-шаблонів; уже надіслані листи не переписуються. Реальні коди й паролі вводить власник. Деплой Worker для цього не потрібний.
- [ ] **CAPTCHA-RELEASE:** після явної команди на публікацію отримати CLI scope `challenge-widgets.write`, негайно анулювати перший секрет, атомарно опублікувати новий секрет і збірку в Worker `kilo-g`; перевірити metadata/assets, live Siteverify і форми на обох доменах. Не публікувати збірку з dummy key або без потрібного секрету.
- [ ] **AUTH-LIVE:** власник проходить реальну реєстрацію/вхід, отримує лист підтвердження, відкриває посилання, отримує reset email, сам вводить новий пароль і перевіряє повторний вхід. Паролі й коди не копіювати в чат/журнали.
- [ ] **ROLES-LIVE:** після verified email `web.developer.den@gmail.com` перевірити bootstrap порожньої системи, призначення іншого адміністратора, компанії та менеджера; manager працює лише зі своєю компанією. Не змінювати ролі реальних інших користувачів заради smoke test.
- [ ] **COMPANY-LIVE:** власник/призначений менеджер додає реальну пропозицію та логотип; перевірити читання в каталозі після перезавантаження, редагування й CAS конфлікт.
- [ ] **ANALYTICS-LIVE:** отримати авторизований звіт admin/manager, перевірити scope, накопичення подій і відображення корисних показників для реальної компанії.
- [ ] **FREE-CPU:** виміряти фактичний облік Cloudflare CPU для холодних/прогрітих ключів, неправильних токенів, пакета подій і великого звіту. Локальні тести й wall time не підтверджують межу Workers Free **10 мс CPU**. Платний тариф для проходження не вмикати.
- [ ] **USER-ACCEPTANCE:** шаблони/історія власного акаунта, власні файли, мобільний пристрій, поведінка без WebGL 2 та native print/PDF. Емуляція mobile viewport у попередньому проходженні фактично не застосувалася, тому mobile acceptance не зарахований.
- [ ] **MAIN-RELEASE:** після приймання завершити PR #1 та синхронізувати `main` із перевіреним кодом. До цього PR лишається draft.

## Ризики й наступний крок

**Головний ризик деплою:** remote `main` досі `ded3d89fea70d846947d67982aa708b2c84ee076`, а актуальний код лежить у `codex/user-platform`. Cloudflare Builds налаштований на `main` (перевірено в консолі під час випуску; Builds inventory API для CLI — 403). Push у старий `main` може перезаписати поточний ручний реліз старим кодом. Запис стану в робочу гілку не змінює активний Worker; merge та зміна production branch у цьому проходженні не виконуються.

Інші обмеження: безкоштовні квоти не є гарантією необмеженого навантаження; фактичний CPU і справжні поштові потоки ще не прийняті. Попередній production dependency audit мав 0 знахідок; 11 наявних dev-only знахідок Firebase CLI залишаються окремою задачею (аудит у цьому проходженні повторно не запускався).

Наступну роботу починати з **AUTH-LIVE → ROLES-LIVE → COMPANY-LIVE → ANALYTICS-LIVE / FREE-CPU → USER-ACCEPTANCE → MAIN-RELEASE**. Кожен блок завершувати й перевіряти перед переходом далі. Після зміни релізу оновити цей файл фактичними SHA/Worker version/Rules hash і новими доказами; не переносити неперевірені задачі у завершені.
