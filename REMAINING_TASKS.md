# KILO·G: поточний стан і відкриті задачі

Оновлено **9 жовтня 2026**. Команда власника відновила реалізацію, перевірки й підготовлений реліз. Попередня пауза після відключення світла завершена. **Identity Platform / Auth App Check пропущено за прямою командою власника**, без зміни Spark або підключення billing.

## Виконано та опубліковано

- [x] REST API `/api/v1`: ключі адміністратора/менеджера, створення/ротація/відкликання зі свіжим входом; JSON-імпорт, статуси й результати; вкладка `/app/api` з документацією. Звичайний користувач доступу не має.
- [x] Стабільний upsert за `externalId` у межах компанії; збереження пропущених необов'язкових полів; компанії адміністратора через JSON і автоматично за точним доменом HTTPS URL; менеджер лише своєї активної компанії та її дозволених доменів.
- [x] Актуальний стандартний/власний профіль пластику без дублювання температур у товарі; перевірка поточної ролі, блокування, видалення та відкликаної сесії перед запитом і кожною порцією.
- [x] D1 backup зроблено до міграцій; `0002_import_api.sql` і `0003_import_access_limits.sql` застосовані, pending migrations немає. Queue `kilog-imports` створено, retention 24 години, producer/consumer `kilo-g` підключені.
- [x] Окремий `kilog-import-worker@kilo-g.iam.gserviceaccount.com`: тільки `roles/datastore.user` і `roles/firebaseauth.viewer`. Секрет Worker активований разом із сумісним кодом, наявний Turnstile збережений. JSON credentials поза Git із перевіреним приватним ACL.
- [x] SEC-001: персональна квота до Firebase, окремі manager/admin бюджети; відхилені запити не забирають резерв адміністратора. Конкурентні квоти, ротація без скидання інтервалу, idempotency, outbox і неоднозначний commit перевірені.
- [x] Строгий CSP без script `unsafe-inline`/`unsafe-eval`; фактичний endpoint встановленого App Check SDK дозволено й покрито regression. Капча/Google внизу форми, favicon і попередні зміни UI опубліковані.
- [x] Firebase App Check SDK + Enterprise provider активні. **Firestore enforcement ENFORCED**; Verified requests підтверджені власником, приватні/публічні читання й аналітика працюють після ввімкнення. Пряме контрольне читання без App Check отримує 403.
- [x] Заміна пропущеного Auth App Check: Turnstile з серверною перевіркою, native rate limits, увімкнений email enumeration protection, verified email, свіжий вхід і актуальні ролі. Це не закриває прямий Firebase Auth endpoint поза CAPTCHA; межу задокументовано.
- [x] `recoverEmail` callback завершений і опублікований; mode перевіряється перед застосуванням, replay/invalid code відхиляються. Листи автоматично під час тестів не надсилалися.
- [x] Production dependency audit — 0. Виправлений `get-uri → basic-ftp 6.2.3`, відтворюваний чистий `npm ci`. Залишилося 7 development-only advisory entries (3 high / 4 moderate); unsafe major overrides не застосовані.

Поточний source: `9f2d8baebb22e2365465141f26e3b16e07705c1e`, Worker `d7f4f6aa-e18e-45d0-9365-f7296f5de87d`, **100% traffic**, remote readback після публікації **16:33 UTC**, [основний сайт](https://web-dev.pp.ua), [резервний домен](https://kilo-g.web-developer-den.workers.dev). Сумісний попередній реліз — `712e603` / `0c99f93f-e0bc-4213-9db0-5fb44612510d`. Гілка `codex/user-platform`, draft [PR #1](https://github.com/WebDev-Den/PrintCost/pull/1). `main` не змінювався.

## Фактичне приймання

- [x] 137 application tests + 100 emulator/integration tests, lint, build, validator і dry-run — PASS для опублікованого source. [Чистий CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37959585046).
- [x] Реальний API-ключ: прихована пропозиція прийнята HTTP 202; job `6f391f2a-2987-4d58-9aac-2a895fda55d9` completed, 1/1. Той самий JSON/Idempotency-Key повертає той самий job без дубля.
- [x] Імпорт через живий кабінет: company JSON + оновлення ціни 600 → 610 грн; job `c5c50322-6932-4f6d-b82f-a59512af0611` completed, 2/2. ID товару зберігся, опис зберігся, профіль PLA — сопло 190–225 °C / стіл 50–60 °C.
- [x] Після окремого перемикання статусу контрольний товар повернуто в hidden; у публічному каталозі його немає. Реальні товари/компанії не видалялися, контрольна компанія лишається доступною адміністратору.
- [x] Live HTTP: SPA-маршрути/assets/favicon, CSP, 401/403/404/405, foreign Origin, відхилення неправильного API-ключа й Turnstile — PASS. Без secrets у звітах.
- [x] Cloud Billing false; IAM, Queue bindings, міграції, App Check enforcement перевірені через readback.

## Поточний блок перевірки продуктивності

- [x] Cloudflare GraphQL підтвердив одиницю CPU: **мікросекунди**. У початкових 55 sampled requests — 0 runtime errors, але максимальний bucket P99 **25.842 ms**, вище номінальних 10 ms HTTP/Cron Free. Startup time не є request CPU.
- [x] Оптимізовано чотири свіжих читання authorization documents в один Firestore batchGet без кешу ролей. Незалежність від порядку, missing/duplicate/foreign rows та fail-closed перевірені, target integration 2/2 і 137 app tests PASS.
- [x] Повний CI source `9f2d8ba`, публікація оптимізації, HTTP та авторизований кабінет після релізу — PASS. Обидва Worker secrets збережені, Queue producer/consumer активні.
- [x] Повторний CPU readback після релізу: 16 sampled requests, **0 runtime errors**, max bucket P99 **21.670 ms**. Це інша вибірка запитів, а не коректний A/B benchmark. Піки все ще вище 10 ms Free; поодинокі перевищення допускає платформа, стале перевищення може дати `exceededCpu`/1102. Не стверджувати, що весь CPU ризик закритий. [Офіційні CPU limits](https://developers.cloudflare.com/workers/platform/limits/).
- [ ] Максимальний реальний імпорт 100 записів/128 KiB та навантаження багатьох користувачів не прийняті на production. Не запускати атакувальний load test і не обіцяти Free/100% uptime для будь-якого навантаження.

## Потребує участі власника або окремого приймання

- [x] **API-ключ, який потрапив у чат, оновлено власником** після завершення jobs. D1 readback: старий hash не має активного ключа (`old_key_still_active: 0`). Новий plaintext не передавався агенту й не зберігався у Git.
- [ ] Firebase Templates: штатна action URL досі `https://kilo-g.firebaseapp.com/__/auth/action`. Через консоль власника налаштувати `https://web-dev.pp.ua/auth/callback` і перевірити реальні verify/reset/recover листи. API PATCH раніше відхилений; не підміняти одноразові action links статичним URL.
- [ ] Застосувати ім'я/теми/дозволені тексти листів та `noreply@web-dev.pp.ua`: точні DNS records з Customize domain, перевірка MX/SPF/DKIM і Apply Custom Domain. HTML-макети готові, доставка/SMTP ще не підключені. [Пакет листів](./docs/email-templates/README.md).
- [ ] Живе приймання під окремим менеджером/іншим адміністратором, логотип компанії, власний профіль, масові дії на непорожньому каталозі, звіт менеджера, фізичний телефон, нативний друк/PDF. Локальні сценарії працюють, live матриця не завершена.
- [ ] Посилена серверна password policy та аудит доступів людей/Google API restrictions у консолях — не завершені. App Check не замінює контроль Firestore квот усередині справжнього клієнта.
- [ ] Злиття draft PR #1 у `main` — окреме рішення після приймання; зараз не зливати. Cloudflare Builds стежить за `main`.

Докази: ігнорований `output/` містить CI/HTTP/import/App Check/IAM/CPU JSON, логи та screenshots без plaintext ключів. Private service account і D1 backup зберігаються окремо від репозиторію. Вимкнення ПК не виконувати без актуальної команди.

[PROJECT_STATUS.md](./PROJECT_STATUS.md) · [API_IMPORT_PLAN.md](./API_IMPORT_PLAN.md) · [API_IMPORT_GUIDE.md](./API_IMPORT_GUIDE.md) · [security_best_practices_report.md](./security_best_practices_report.md) · [FIREBASE_SECURITY_ACTIVATION.md](./FIREBASE_SECURITY_ACTIVATION.md) · [OPERATIONS.md](./OPERATIONS.md).
