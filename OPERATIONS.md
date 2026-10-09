# Запуск, резервні копії та відновлення KiloG

Робочий Firebase-проєкт — **kilo-g**, база Firestore **(default), Standard**, тариф **Spark**. Сайт і API — Worker **kilo-g**, тариф **Cloudflare Free**: 9 жовтня 2026 консоль Workers plans показала Free / $0 / Current plan. API subscriptions для CLI повернув 403, тому тариф підтверджено через консоль. Зміна тарифу, Cloud Billing, Blaze, paid Workers, керовані backups/PITR або платні сервіси не входять до цього запуску.

Останнє оновлення — 3D-прев’ю файлів, source `4f50eed791460956779f92ba6a197c1b303229c3`, Worker `fc5cd99f-86bb-4675-bc17-4f36e28903bd`, 100% трафіку. Обидва push/PR CI успішні: 95 app + 62 Rules + 10 logo SDK + 6 account SDK + 7 Worker/D1 + 10 operations = 190 перевірок. Після публікації 10 byte comparisons HTML/main JS/Calculator/Three/preview-worker на двох доменах і 7 metadata checks PASS; proof — `output/print-preview-production-proof-1791502085858.json`. CUA на `web-dev.pp.ua` завантажив 3MF, перемкнув геометрії пластин 2/4, перевірив масштаб і клавіатуру з повним розрахунком 106,94 / 220,00 грн; production Firestore/Auth writes не виконувалися. Попередня версія Worker `2c962240-21ea-403f-944a-64257259a0b9` доступна для відкату. Прев’ю працює локально у браузері: міграцій, змін Rules, нових bindings, credentials або paid services немає. Записи про попередній випуск логотипів нижче зберігають його окремі докази.

## Перед випуском

Оновлення Turnstile підготовлене в `codex/user-platform`, але **ще не опубліковане через відсутній CLI-дозвіл**. Поточні source/version і докази попереднього релізу збережені нижче; вони не підтверджують живу капчу. Повний `npm test` пройшов 116 перевірок застосунку/Worker та 6 native runtime перевірок Turnstile, разом 122. Окремі 95 емуляторних перевірок також пройшли: усього 217 PASS. TypeScript, production build, deploy validator і Wrangler dry run пройшли; після останньої перевірки пробілів у token повторно пройшли 25 цільових Turnstile перевірок та dry run. Локальний dummy widget перевірений у браузері на вході, реєстрації та запиті відновлення; реальний widget і Siteverify потребують окремого приймання після публікації.

Перевірити production build, TypeScript, тести застосунку, Rules, account cleanup, operations і реальний Worker/D1 runtime. Для CI потрібні Node 22 та Java 21 для емулятора. CI запускається на push/PR; розклад, автоматична оплата й деплой з неперевіреної гілки не потрібні. Не завантажувати `output/backups`, Auth exports, CLI credentials або журнали приватних даних як CI artifacts.

Публікація заблокована, поки D1 `database_id` є placeholder, немає потрібних bindings або застосованої міграції. Фактичні CPU API на Workers Free треба виміряти на робочому релізі для холодного/прогрітого ключа, неправильних токенів, пакета подій і великого звіту. Локальний wall time і sampled V8 profile не підтверджують облік Cloudflare та межу **10 мс CPU**. Не вмикати paid plan для проходження перевірки: скоротити роботу запиту або залишити аналітику недоступною до усунення причини. Відмова API аналітики не повинна зупиняти статичний сайт і калькулятор.

Перевірити дозволені Firebase Auth домени, реальні листи підтвердження/відновлення, роботу прямого URL, bootstrap власника і ролей. Зберегти git SHA, версію Worker, стан Rules/indexes та ідентифікатор міграції D1. Відкат коду або Rules не відновлює дані автоматично.

Локальний remote — [WebDev-Den/PrintCost](https://github.com/WebDev-Den/PrintCost), робоча гілка `codex/user-platform`. [Workers Builds trigger inventory](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/list/) повернув **403 / 10000** для наявного CLI OAuth; налаштування збережені й повторно перевірені через консоль 9 жовтня 2026: repository `WebDev-Den/PrintCost`, production branch `main`, root `/`, build `npm run lint && npm test`, deploy `npm run deploy:worker`. Preview builds та preview URLs вимкнені: окремі ресурси Firebase/D1 для preview не налаштовані. Нових scopes або credentials цей випуск не створює.

## Turnstile: секрет, публікація та перевірка

Публічна конфігурація збірки — `VITE_TURNSTILE_SITE_KEY`; runtime Secret Worker — `TURNSTILE_SECRET_KEY`. `secrets.required` вимагає секрет перед деплоєм. `TURNSTILE_HOSTNAMES` має точне значення `web-dev.pp.ua,kilo-g.web-developer-den.workers.dev`, а production build і deploy guard відхиляють відсутній або dummy sitekey. Сервер не приймає dummy secret/token; без секрету, hostname чи native limiter endpoint відмовляє з 503. Приватний ключ не є `VITE_*` або `vars` і не записується у Firebase/D1. Налаштування **Workers Logs та Traces залишаються вимкненими**; ключі, токени й дані форм не додаються до журналів.

Для першої публікації підготувати файл JSON із єдиним секретом `TURNSTILE_SECRET_KEY` у новому захищеному каталозі `output/backups` за процедурою ACL нижче. Перевірити Git ignore, обмеження доступу й право CLI публікувати саме Worker `kilo-g`; значення ключа не виводити в команді, чаті або CI artifact. У файлі має бути лише секрет, без публічних `VITE_*`, Auth credentials чи інших випадкових змінних. Опублікувати код і секрет одночасно:

```bash
npm run deploy:worker -- --secrets-file output/backups/<protected-directory>/turnstile-secrets.json
```

Wrangler приймає JSON або dotenv secrets file та створює одну версію з кодом і секретом; інші секрети попередньої версії зберігає. Не використовувати tracked `.env.production` як secrets file: він містить публічну конфігурацію Vite. Звичайний `wrangler secret put` одразу розгортає нову версію, тому окремий secret-only деплой не є заміною процедури першого випуску. Після встановлення секрету звичайний `npm run deploy:worker` використовує наявний runtime Secret. [Worker secrets і одночасний upload](https://developers.cloudflare.com/workers/configuration/secrets/).

Після публікації записати source SHA/Worker version, звірити assets, runtime bindings, точні hostname й ім’я секрету без читання значення. На обох доменах пройти п’ять дій `login`, `register`, `forgot_password`, `reset_password`, `resend_verification`; перевірити помилку, прострочення, retry, повторне використання токена й відмову без капчі. Коректний токен має пройти реальний Siteverify, неправильний action/hostname — отримати відмову. Пароль і email передаються лише Firebase SDK. Native limiter використовує наявний binding `ANALYTICS_RATE_LIMIT` із префіксом `turnstile:` та приблизною спільною межею 60/60 секунд для всіх дій; перевірки не звертаються до D1, не створюють подій аналітики й також витрачають квоту Worker. Цей preflight захищає форми сайта, але прямий Firebase Auth API залишається поза ним; App Check для Auth є окремою архітектурною зміною. [Siteverify](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Firebase Auth REST](https://firebase.google.com/docs/reference/rest/auth).

Для ротації в налаштуваннях існуючого Turnstile widget обрати **Rotate Secret Key** й підготувати новий секрет у захищеному файлі. Публічний sitekey не змінюється. Протягом двох годин старий і новий ключі чинні; у цей проміжок виконати той самий деплой із `--secrets-file`, потім перевірити живий Siteverify. Відкат Worker не повертає чинність ключа після завершення ротації. [Офіційна ротація секрету](https://developers.cloudflare.com/turnstile/troubleshooting/rotate-secret-key/).

У локальній роботі bypass дозволено лише `DEV` + явним Firebase emulator flag + `demo-*` project ID + loopback hostname. Native runtime тести ізолюють транспорт Siteverify й не використовують production credentials; dummy browser key не є доказом production захисту. Відсутність провайдера в production блокує публічні форми, але перегляд сайта та локальний демокалькулятор залишаються доступними.

## Опублікований випуск 9 жовтня 2026

Оновлення логотипів пройшло 164 локальні автоматичні перевірки, браузерне приймання та обидва CI source-коміту. Після публікації 6 порівнянь HTML/main JS/CompanyOffers JS на обох доменах збіглися з `dist`; 7 metadata перевірок підтвердили поточну версію зі 100% трафіку, D1, ASSETS, rate limiter, Firebase project, cron і custom domain. Rules збігаються побайтово; 3/3 індекси READY, image index exemption підтверджений, Spark не змінився. Production logo write під реальним акаунтом ще не перевірений; тестові компанії та логотипи в production не створювалися. Доказ — локальний `output/company-logo-production-proof-1791500681250.json`. Rules/index backup перед цим оновленням — `output/backups/firebase-release-before-2026-10-08T22-57-57-639Z`; попередній Worker `be720641-8b9d-4112-b4f0-7970930392af` залишається доступним для відкату. Старі копії нижче належать першому випуску платформи.

- Source commit `4f50eed791460956779f92ba6a197c1b303229c3`, обидва push/PR CI успішні; ручний `npm run deploy:worker` завершений. Worker version `fc5cd99f-86bb-4675-bc17-4f36e28903bd`, домени `web-dev.pp.ua` і `kilo-g.web-developer-den.workers.dev`. `main` ще містить попередню версію; PR #1 залишається draft до живого приймання. Новий push у старий `main` може повторно опублікувати старий код.
- D1 `kilog-analytics`: `d837dab8-8871-43d1-8cfc-df6c4d03b8d2`, binding `ANALYTICS_DB`. Міграція `0001_analytics.sql` підтверджена квитанцією `d1_migrations` і порівнянням усіх 12 SQL-об’єктів із локальною міграцією. Початкова невдала команда відкотилася цілком; часткової схеми не залишилося. Native `ANALYTICS_RATE_LIMIT` — 60/60 секунд; очищення `0 2 * * *` UTC.
- Firestore ruleset `1641cc1d-19ef-4d8b-9b06-e049627c13a9`, SHA-256 `54e352eb8f7cc169999e0cec670ebdd76827c6ab6f4f106c8a8917f062c564d2`, exact readback після публікації. Усі три потрібні індекси READY. Spark без billing, email/password, email privacy та обидва Authorized domains підтверджені.
- Копія Auth/Firestore перед випуском: `output/backups/2026-10-08T22-17-30-106Z-886f0de4-57bb-45f4-aedd-5aaf2b7dc669`, 0 документів/0 акаунтів, dry run 0 змін; bootstrap залишається доступним. Старий Worker version `26003bcb-c966-4d98-9d0c-8c971911eab9`. Metadata/source Rules та індекси для відкату — `output/backups/firebase-release-before-2026-10-08T22-20-03-357Z`; старий ruleset `163d9649-64c5-4da7-9884-226de9baa9c1`. Ці локальні каталоги захищені ACL і не входять у Git.

Реальне підтвердження/відновлення пошти, bootstrap власника та CPU авторизованих звітів ще очікують живого проходження. Зміна нового пароля передається користувачу; секрети та коди з листів не копіюються в журнали або чат.

## Захищений локальний експорт

Логотипи компаній — окрема колекція `companyLogos`, яку рекурсивний експорт також охоплює. Міграція компаній не потрібна: відсутній логотип означає ініціали. PNG-поле `imageDataUrl` не індексується, максимальний data URL — 131094 символи (96 KiB PNG). `get` публічний лише для активної компанії; `list/delete` закриті. Запис потребує підтвердженого неблокованого адміністратора або менеджера власної активної компанії без marker видалення, CAS версії та незмінного автора/часу створення. Видалення акаунта зберігає логотип компанії, як і її пропозиції. Rules обмежують PNG signature/IHDR 128 × 128, canonical base64 та розмір; повне декодування виконує браузер перед canvas-конвертацією. Пошкоджене зображення, записане стороннім клієнтом у дозволених межах, показує ініціали. Це не серверне засвідчення змісту PNG.

`scripts/firebaseOperations.ts` використовує **наявний Firebase CLI login** через `getAccessToken`; service-account keys, токени в аргументах і секрети в репозиторії не потрібні. OAuth-запити адміністратора обходять Rules, тому операційні команди виконуються тільки власником проєкту. Скрипт допускає робочі запити лише до точного **kilo-g**. Для тестів потрібні обидва явні loopback endpoints і окремий проєкт **demo-kilog-operations-***; середовище емулятора не перемикає production команду приховано.

```powershell
npx tsx scripts/firebaseOperations.ts export --project kilo-g --budget 20000
```

Команда створює новий каталог у **output/backups**, перевіряє Git ignore, перед записом приватних даних вимикає успадкування ACL і залишає доступ тільки SID поточного користувача Windows. ACL повторно перевіряється; на POSIX використовується каталог 0700/файли 0600. Адміністратор ОС може змінити ACL: це контроль локального доступу, а не шифрування. Для перенесення копії використовувати власний зашифрований носій; не публікувати її в Git, спільній папці чи CI artifact.

Експорт використовує офіційні [listCollectionIds](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/listCollectionIds) та [listDocuments](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/list): усі root collections і підколекції, пагінація, `showMissing` для документів із підколекціями без батьківського документа. Збережені точні імена документів/ID та raw REST protobuf fields: Timestamp, int64 як рядок, bytes, reference, map, array та null не перетворюються на JS числа або звичайні рядки. До копії потрапляють приватні snapshots/likes, каталог, companies/companyOffers з авторами, ролі, audit та accountDeletion і будь-які додаткові колекції.

Production Firestore читається на одному `readTime` приблизно за 5 секунд до початку експорту; API дозволяє таке читання протягом години. Скрипт припиняє експорт після 55 хвилин або перевищення бюджету документів. Незавершена копія без `manifest.json` непридатна для міграції. Manifest містить час, кількість документів і SHA-256; NDJSON перевіряється перед використанням. Емулятор читається послідовно без гарантії production snapshot.

Auth читається окремо через [accounts:batchGet](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v1/projects.accounts/batchGet). Його export може містити адреси, claims і password hashes/salts, якщо наявні CLI-права їх дозволяють. Auth і Firestore не утворюють спільної атомарної копії. Скрипт не імпортує Auth accounts і не змінює claims/паролі. Для disaster recovery Auth потрібен окремий переглянутий CLI import із параметрами правильного hash algorithm або скидання пароля; не вважати local JSON гарантованою копією всіх параметрів password hashing.

Перед великим експортом перевірити залишок Firestore Usage. Ліміт 20 000 документів — бюджет цього запуску, а не обіцянка безкоштовності за вже витраченої квоти. Експорт із 20 001+ документів залишає неповні файли і потребує нового запуску з явно переглянутим бюджетом; максимум скрипта — 50 000.

## Перенесення старих ролей

```powershell
npx tsx scripts/firebaseOperations.ts dry-run --project kilo-g --directory output/backups/<backup-directory>
```

Dry run зберігає захищений план і виводить тільки шлях, hash і кількість змін. Переноситься лише **точний Auth UID** з literal claim `admin: true` або `role: "admin"`, підтвердженою поштою, активним Auth account і без deletion marker. Назва, email, поле companyId чи назва компанії не визначають роль або власність. Перед застосуванням Auth перевіряється знову.

Якщо реєстр уже існує, він є авторитетним: автоматичного merge немає. Колізія нових role documents припиняє перенесення. Якщо придатних старих UID немає, скрипт **не створює порожній реєстр** і залишає bootstrap власника доступним. Приватні профілі, історія, вподобання, IDs і каталог не переписуються. За наявності старих адміністраторів один атомарний commit створює тільки system/authorization і відповідні accountAccess, memberships та accessAudit.

Production міграцію виконувати лише після перегляду експортованих даних і конкретного плану. Точний hash плану є обов'язковим:

```powershell
npx tsx scripts/firebaseOperations.ts apply --project kilo-g --plan output/backups/<backup-directory>/<plan-file>.json --approve <reviewed-plan-sha256> --journal output/backups/<backup-directory>/migration-journal.json
```

Документи створюються з `exists:false`, оновлюються з точним `updateTime`; [Firestore preconditions](https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition) захищають від записів після перегляду. Commit обмежено 400 змінами й атомарний. Повторний завершений apply з тим самим journal нічого не записує; повторний dry run після створення реєстру теж не змінює його. Journal записується до commit й опечатується post-commit snapshots тільки після перевірки їх `updateTime` проти receipts саме цього commit. Якщо процес завершився між commit і опечатуванням або в цей час з'явився новіший запис, зупинитися та переглянути фактичний стан: скрипт не привласнює новіші записи за збігом полів.

## Відкат і вибіркове відновлення

```powershell
npx tsx scripts/firebaseOperations.ts rollback --project kilo-g --journal output/backups/<backup-directory>/migration-journal.json --approve <reviewed-plan-sha256>
```

Відкат торкається тільки документів із journal. Він порівнює поточні `updateTime` і hashes із post-commit snapshots, а потім одним CAS commit відновлює попередні поля або видаляє тільки створені міграцією документи. За будь-якого конфлікту весь відкат пропускається — жодного часткового видалення нових ролей. Знову переглянути дані й узгодити їх вручну; `force` режиму немає. Повторний завершений rollback — no-op.

Для окремих утрачених Firestore документів:

```powershell
npx tsx scripts/firebaseOperations.ts restore-preview --project kilo-g --directory output/backups/<original-backup> --select users/<uid>/likes/<id>,users/<uid>/calculations/<id>
```

Без `--expected` відновлюються тільки відсутні документи; рівні дані пропускаються, змінені зберігаються. Щоб навмисно повернути старішу версію, спочатку зробити захищену копію поточного очікуваного стану й передати `--expected output/backups/<expected-current-backup>`. Нові зміни після неї пропускаються. Переглянути отриманий план/hash та застосувати командою `apply` з окремим journal. Скрипт не стирає документи, створені після старого export, і не переписує колекції wholesale. Raw fields/IDs відновлюються; Firestore призначить нові системні createTime/updateTime.

## Якщо останній адміністратор видалив Auth поза застосунком

Застосунок знімає доступ і очищає приватні дані **до** видалення Auth; останній адміністратор не може залишити систему без наступника через штатний потік. Firestore Rules не можуть заборонити незалежне видалення Auth через Console або прямий SDK. Така дія може залишити старий UID у реєстрі без можливості входу.

Власник Firebase-проєкту має підтвердити існування **конкретного** нового Auth UID із verified email, enabled account і без accountDeletion marker, зробити свіжий export та підготувати recovery:

```powershell
npx tsx scripts/firebaseOperations.ts recover-admin --project kilo-g --directory output/backups/<fresh-backup> --uid <explicit-verified-auth-uid>
```

План додає лише цей UID, зберігає наявні adminUids, bootstrapUid та initializedAt, підвищує version і створює audit. Не стирає реєстр і не обирає адміністратора за назвою чи email. Переглянути план та застосувати його з hash/journal, як вище; CAS не дозволить перезаписати паралельну зміну реєстру. Ліміт 32 адміністратори та пошкоджена схема потребують окремого ручного перегляду.

## Контроль безкоштовних квот

У Firebase Console вручну перевіряти Firestore Usage і Authentication Usage. Для Spark: 1 GiB Firestore, 50 000 читань, 20 000 записів і 20 000 видалень на день, 10 GiB вихідного трафіку/місяць; reset за Pacific time. Auth: 1000 verification emails і 150 password resets/день. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas), [Auth limits](https://firebase.google.com/docs/auth/limits).

У Cloudflare вручну перевіряти Workers Requests/CPU/errors, D1 rows read/written/database size і Workers Builds usage. Free: 100 000 API requests/день, 10 мс CPU; D1 5 млн reads/100 000 writes на день UTC, 500 MB/DB; Builds 3000 хвилин/місяць. Статичні assets обслуговуються окремо. API має точну спільну квоту 4000 подій/день UTC; менеджер не бачить загального використання. Фільтри/звіти, retries, invalid requests і захищені Firestore lookup також витрачають квоту — денний event cap не замінює Usage контроль. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Build limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

На **70%** будь-якої квоти перевірити тенденцію, джерело запитів і залишок дня/місяця; на **85%** припинити некритичні великі exports/reports, звузити періоди, вимкнути збір аналітики у клієнті або тимчасово повернути 503 для неї. Це ручні робочі пороги, а не автоматичні service alerts чи бюджетне списання. Якщо акаунт дає безкоштовні Usage notifications, власник може налаштувати їх у Console; CI/скрипти не вмикають billing або нові schedules. Копії даних, перевірка відновлення й щоденний Usage огляд перед активним використанням потрібні навіть при порожньому стартовому проєкті.
