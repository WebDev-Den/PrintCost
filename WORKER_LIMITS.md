# Cloudflare Free: оптимізація й приймання

Оновлено 10 жовтня 2026, Europe/Kyiv. Тариф Cloudflare Free / Firebase Spark не змінюємо.

## Фінальне автоматичне приймання main — 10 жовтня 2026, 10:32 UTC

`main` без конфліктів оновлена до `727f3fff8f57c384598dfa737133fde38fa4970b`. [Main CI](https://github.com/WebDev-Den/PrintCost/actions/runs/38044776321) — SUCCESS. Cloudflare Build `6d5d8e95-a5cd-411e-b666-e1da67edeb8c` — Ready; автоматично опублікований Worker `c90eb652-ebcc-463f-a13c-b5cece2f5d7a` має **100% traffic** від **10:25:26 UTC**. Це новий ID після наведеного нижче ручного приймання. Secrets, Queue/D1/limiters, Logs/traces/redaction збережені; pending migrations немає. Тариф не змінено.

Повторні **62/62 HTTP PASS** на цьому Worker, concurrency до 4; Google/App Check браузерні key/history/report працюють. Новий зовнішній job зі 100 записів / 32768 bytes `55fbdf0d-8bd0-49e7-9a8b-4f892c5d31b4`: HTTP 202 → failed/HTTP_422, 0/100, results [], без запису товарів; idempotency replay без дубля. **47 native invocations**, усі outcome ok. **Фінальні CPU максимуми: POST 21 мс, external list 15 мс (також 13 мс), browser key 6 мс / report 7 мс, detail 5 мс, invalid analytics 2 мс, Cron 3 мс, Queue 9 мс**. Три HTTP samples перевищили 10 мс, runtime errors/exceededCpu немає. Попередні 15 мс ручного релізу не є максимумом автоматичного. **FREE-CPU strict ≤10 мс не закрито**; відсутність errors і запас платформи для рідких overruns не є гарантією для будь-якого трафіку.

**308 тестів PASS** і модель **85464 D1 writes / <3.5m reads / 9600 Queue operations** лишаються чинними для описаних caps/припущень; CPU нової версії виміряно окремо від latency. Рання побайтова звірка з локальним Windows dist не пройшла: його ресурси відрізняються від Linux Cloudflare Build. Фінальна перевірка: **54 запити, 27 точних побайтових порівнянь між двома доменами — PASS**; усі 23 JS/CSS ресурси та HTML-посилання відповідають іменам із успішного CI точного `main`. Favicon і theme script збігаються з Git LF-байтами; 207/207 blobs окремого LF-архіву перевірені. Незалежну локальну LF-збірку не завершено, її власний Vite-процес зупинено; CI не зберігає байти compiled chunks, тому їх незалежне побайтове порівняння зі збіркою не заявляється. Доказ: `output/cpu-canonical-lf-16a45a0a658a482db79c7ff3b5fd4575/ci-asset-proof.json`.

Безпечні локальні артефакти: `output/cpu-load-main.json`, `output/cpu-load-main-native.json`, `output/cpu-external-boundary-final.json`, `output/observability-readback.json`, `output/cpu-main-cloudflare-proof.png`. Значення ключів, raw telemetry та backup у Git відсутні.

Документація після цього deployment збережена в `codex/cpu-free-load`; runtime-код і caps у `main` збігаються. Повнодобове production saturation, максимальний успішний імпорт і максимальний production report не виконувалися. Інші застосунки акаунта, ручні операції та затримки Queue через кілька діб можуть споживати додаткові Free квоти.

Перевірений runtime source `0bf409c`; виправлення лише діагностики native budget — `31ea73b`. Worker `23aec692-9162-4cb0-a661-963aa5d18f96`, **100% traffic** від **10 жовтня 2026, 10:16:45 UTC**. Cloudflare Free / Firebase Spark збережені. Оптимізований реліз функціонально працює, але **суворе приймання кожного HTTP у 10 мс ще не пройдене**: у точній новій версії є 11–15 мс CPU, усі з outcome `ok`.

**308 локальних перевірок PASS** (174 app/runtime + 134 emulator/integration), lint/build/validator/Wrangler dry run — PASS. [CI точного runtime source](https://github.com/WebDev-Den/PrintCost/actions/runs/38043864305) — SUCCESS, 14/14 кроків. Додатково виправлений native budget assertion пройшов окремо. **62/62 контрольовані живі HTTP-перевірки**, concurrency до 4: assets, auth guards, validation, зовнішній API-ключ, повтори існуючого 100-record / 32-KiB job та перевищення меж. Окремо: forged signature 401, declared oversize 413, 3 коректні analytics events 202; живий браузерний Google/App Check доступ до metadata/history/detail/report працює. Під час тесту ключі не ротувалися, товари не видалялися, ролі не змінювалися.

Перший новий зовнішній POST після deployment: 100 записів / рівно 32768 bytes, HTTP 202; Queue повернула `HTTP_422` для навмисно некоректної останньої ціни, **0/100**, results `[]`, без запису товарів. Idempotency replay повертає той самий job. Контрольний job `df4ac287-1ee6-4a40-98a1-189d2c681903`. Native CPU: POST **15 мс**, зовнішній GET list максимум **13 мс**, браузерні key/report **11/11 мс**, detail **6 мс**, ingest **10 мс**, Cron **2 мс**, Queue **5 мс**. Це actual invocation CPU; HTTP latency не використовується замість CPU. Queue має окремий default budget 30 секунд.

Основні зміни: HTTP більше не підписує service-account JWT; encrypted D1 broker оновлюється Queue. Браузер використовує точний Google-verified Firebase token і App Check під Rules; fresh roles/revocation/blocking залишені. D1 читання об’єднані в batch; історія при quota denial читає **0 job rows**, дозволена — **30** навіть при 3000 історичних jobs. Додано bounded cleanup, atomic daily reservations і storage stop guard. Чинні caps: **100 записів / 32 KiB**, **2000 items / 100 jobs за UTC-добу**, **500 import + 300 maintenance Queue sends**, **2000 analytics events / 4000 ingest attempts**. Native measurements + поточна консервативна модель: **85464 D1 writes < 100000**, reads **<3.5m / 5m**, Queue **9600 / 10000 operations** за зазначеними припущеннями. Міграції `0001–0010` застосовані; приватний backup перед `0010` збережений поза Git. Докладні обмеження, докази й відкат — [WORKER_LIMITS.md](./WORKER_LIMITS.md).

Не перевіряли повнодобове saturation production, максимальний успішний імпорт 100 коректних записів чи максимальний production report. Модель не резервує квоти для інших застосунків акаунта, ручних sends/операцій і затримки Queue через кілька UTC-діб. **0 runtime errors не доводить strict ≤10 мс або 100% uptime**; FREE-CPU залишається відкритим. Подальше зменшення свіжих перевірок доступу заради CPU не застосовувалося.

## Поточна архітектура

- Браузерний HTTP спочатку перевіряє точний ID token через офіційний Google `accounts:lookup` із публічним Firebase web API key. Google повертає enabled/emailVerified/validSince саме цієї сесії; повторної привілейованої Auth lookup немає. Свіжі ролі, блокування, видалення та компанія читаються masked batchGet під тим самим ID token і App Check через Firestore Rules. Відмова не повторюється із сервісними credentials. Рішення авторизації не кешуються.
- Зовнішній API-ключ і Queue зберігають свіжу привілейовану перевірку Auth та доступу. HTTP не підписує service-account JWT і не виконує OAuth exchange. Він отримує чинний service token із приватного D1 broker: AES-GCM, випадковий 12-byte nonce, окремий ключ із secret, прив'язка до project/secret fingerprint/expiry. Відсутній або прострочений token дає `503` / `Retry-After: 60`; оновлення виконує Queue consumer. Ролі, стан Firebase-користувача, відкликання та доступ компанії перевіряються свіжо; broker не кешує авторизаційні рішення.
- Cron лише атомарно резервує квоту й ставить обмежене maintenance-повідомлення. Consumer виконує OAuth refresh за потреби, outbox/recovery та очищення. Його межа CPU відрізняється від HTTP/Cron.
- HTTP приймає до 100 записів / 32 KiB вихідного JSON; більший payload відхиляється з `413` і має бути розділений клієнтом. Consumer перевіряє всі поля до запису товарів, обробляє порції по 5 і зберігає receipt/idempotency. Некоректний payload завершується без часткового імпорту. Імпортовані товари залишаються чернетками.
- Історія імпортів читає збережені підсумки 30 jobs; дозволений список читає **30 job rows**, а при вичерпаній остаточній квоті — **0 job rows** навіть при 3000 історичних jobs. Детальний endpoint зберігає повні результати та перевірку власності.
- До deduplication аналітики атомарно резервується квота спроб. Звіт резервує бюджет читань і повертає невикористану частину лише за повними native `rows_read`; без повних metadata резерв залишається списаним. Static assets обходять Worker, розрахунок виконується у браузері.

## Чинні обмеження

Усі добові лічильники нижче спільні для застосунку й скидаються за UTC. Часові інтервали компанії та API-ключа зберігаються незалежно від добового скидання.

| Ресурс | Межа |
| --- | --- |
| Один імпорт | 100 записів, 32 KiB JSON; більші набори розділяються клієнтом |
| Інтервал імпорту | Менеджер: 1 година; адміністратор: 5 хвилин |
| Імпорт за добу | 2000 записів, 100 jobs; не більше 100 активних jobs |
| Попередні API-перевірки | 1100/добу: 500 admin + 500 manager + 100 невідомих UID; вичерпаний загальний резерв не створює нових UID-рядків |
| Остаточні API-перевірки | 1000/добу; свіжий Firebase user/role/company access |
| Queue | 500 import sends + 300 maintenance sends/добу; batch 1, concurrency 1, порції по 5 записів, до 3 повторів |
| Lifetime | Повідомлення й активний job: не більше 24 годин; історія jobs: 30 днів |
| Аналітика: прийняті події | 2000/добу; до 20 подій у пакеті |
| Аналітика: спроби ingest | 4000/добу, включно з повторними пакетами, до deduplication |
| Аналітика: звіти | 1500 перевірок/добу; 1000000 зарезервованих snapshot reads/добу |
| Деталізація звіту | До 100 груп; обмежені snapshots до 20001 offer-рядка і 5001 filter-рядка, повні totals збережені |
| Зберігання | При 450 MiB D1 зупиняються нові імпорти, ingest аналітики та створення нових API-ключів; rotation/revocation чинного ключа й обмежене очищення залишаються доступними |
| Очищення історії | До 200 зарезервованих спроб видалення jobs/добу; невдала спроба також витрачає резерв |
| Щоденне очищення counters | Один атомарний запуск/UTC день: до 200 прострочених ключів, 200 cooldowns, 1100 UID counters, 32 daily counters |

Перед dispatch і видаленням квота резервується атомарно. Повторна доставка, неоднозначний commit, вичерпана квота та конкурентний останній слот перевіряються в D1 runtime. Нові expiry-індекси й примусовий pending-індекс обмежують сканування історії; активні jobs не потребують сканування всіх завершених jobs.

## Сукупний бюджет D1 та Queues

Розрахунок нижче поєднує native D1 `rows_read` / `rows_written` після міграцій `0001–0009`; `0010` змінює лише поріг приймання нових записів, без додаткових таблиць чи індексів із чинними атомарними квотами. Це консервативна модель дозволеного трафіку, повторів і очищення, а не повнодобовий production stress test. INSERT/UPDATE враховують витрати індексів; виміряні DELETE потребують одного write на видалений рядок.

| Категорія | Верхня оцінка D1 writes/добу |
| --- | ---: |
| 2000 прийнятих подій і групи аналітики | 22506 |
| Обмежене retention-очищення аналітики, включно зі старим backlog | 16258 |
| 1500 перевірок звіту, резерви та refunds | 4500 |
| 4000 ingest reservations до deduplication | 4000 |
| Попередні UID та остаточні role reservations API | 4300 |
| Створення/rotation ключів і скасування активних jobs | 5400 |
| Прийняття 100 jobs, включно з cooldown expiry-індексом | 1100 |
| Queue claim/retry/progress: 1000 current/prior-day import pointers × 17 | 17000 |
| Dispatch reservations, невдалі sends і відкладення | 7300 |
| Expiry, history cleanup та щоденне очищення counters | 2500 |
| Cron reservations і service-token broker | 600 |
| **Разом** | **85464** |

Native fixture аналітики виміряв 22253 ingest + 4000 attempt controls + 16258 cleanup = **42511 writes**. Безпечна оцінка для двох київських дат протягом однієї UTC-доби — 42764; застарілу діагностику 58765 виправлено. Повний бюджет поточних caps — **85464 writes < 95000 < 100000 Free writes/добу**. Колишні 90164 є верхньою моделлю більших caps, не новим виміром. Оцінка читань — **менше 3,5 млн із 5 млн Free reads/добу**: вона включає 1 млн зарезервованих snapshot reads, 4000 ingest attempts із конкурентними dedup/INSERT, поточні та попередні Queue deliveries, maintenance/cleanup, API та відхилені D1 preflight у межах 100000 Worker HTTP-запитів/добу. Історичну оцінку «менше 3 млн» для довільних конкурентних ingest bursts не використовуємо.

Queues: **9600 operations/добу з 10000 Free у моделі поточної/попередньої UTC-доби**. На добу резервується до 800 sends (500 import + 300 maintenance). Консервативно враховані actual writes обох діб при переході UTC, чотири deliveries (перша + 3 retries) і delete: `2 × 800 × (1 + 4 + 1) = 9600`. Pointers менші за 64 KiB. Це модель обмеженого трафіку, а не hard account-wide fuse: інші Queues, ручні sends та затримка відправлення через кілька діб потребують окремого бюджету. До 100 jobs / 2000 items дають не більше 480 звичайних порцій по 5 записів; retries додатково витрачають reservation.

Модель передбачає один стабільний Firebase project/service-account secret, стандартний OAuth TTL 3600 секунд, атомарні reservations, незмінні 24-годинні lifetimes та невеликі чинні counter tables. Ручні зміни D1, міграції, deployment verification, rotation service-account secret і великий історичний backlog counters не входять до звичайного добового бюджету. Account-wide квоти можуть витрачати інші застосунки й бази цього акаунта; цей розрахунок не резервує ресурс для них.

450 MiB — поріг зупинення нових записів із запасом до Free межі бази 500 MB, а не обіцянка, що необмежена історія поміститься в базу. Прямі Firebase SDK-запити мають окремі Spark квоти. Після релізу звіряти Cloudflare/Firebase Usage, CPU, errors і storage.

## Поточні перевірки та сумісність

Точна версія має **51 native invocation**, усі outcome `ok`, без `exceededCpu`. Чотири HTTP samples перевищують 10 мс: cold POST 15, external list 13, browser metadata/report 11/11. Native Cron 2 мс і Queue 5 мс пройшли власні межі. Повторні імпорти не створили новий job. Безпечні докази з ray/request ID і version: `output/cpu-load-final-native.json`, `output/cpu-load-final.json`, `output/cpu-external-boundary-final.json`, `output/cpu-d1-capacity-current.json`, `output/observability-readback.json`; raw exports/credentials/backups не комітяться. Репозиторний тест повторюється командою `node scripts/cpu-load-test.mjs run output/cpu-load-final.json output/cpu-api-credentials.json`; fixture replay потребує раніше прийнятого job, harness не створює товари. [Офіційні Worker limits](https://developers.cloudflare.com/workers/platform/limits/) допускають рідкі перевищення CPU, але це не є strict PASS.

Чинний реліз використовує additive міграції `0004–0010`, encrypted service-token broker і guarded maintenance. Для відкату необхідний сумісний API/consumer, який розуміє `raw:` jobs, replay hashes, збережені result counts та чинні quotas. Попередній consumer не повинен обробляти активні jobs нового формату. Браузерна сесія не потребує прогрітого broker; зовнішній ключ і consumer потребують чинного broker, який оновлюється maintenance-повідомленням у межах Queue квоти. Перед `0010` створено приватний D1 backup `output/backups/cpu-before-0010/d1.sql`.

## Історичні вимірювання та випуски

Усі SHA, Worker versions, CPU, тестові counts і старі caps у цьому розділі описують попередні релізи. Вони пояснюють причину наступних змін і не є прийманням нового кандидата.

**Попередній реліз не пройшов суворе приймання HTTP/Cron у 10 мс CPU.** Живий контроль зафіксував API-key 20 мс, пізніший повторний API-key 16 мс і великий POST 16 мс. Перевищення не обмежувалися лише першим запитом. Окремі перевищення завершилися без помилок; це не гарантувало, що всі майбутні запити вкладатимуться у Free. На той момент був потрібний окремий архітектурний крок і нове виміряне приймання.

### Виміряна причина попередньої оптимізації

На production source `53f3268f2467145465b2d08c5382e009c29118c6`, Worker `3df3ac56-c16c-4f7d-a62e-815231fc801b`, native Observability показала авторизовані `GET /api/v1/api-key` **29 мс CPU** та `GET /api/v1/imports` **15 мс CPU** о 19:26 UTC. Запити завершилися успішно, але перевищують номінальні 10 мс HTTP Free. Порожні п'ятихвилинні Cron зазвичай потребували 1–4 мс, однак о 19:40 UTC також було **29 мс**; негативні CAPTCHA/неавторизовані запити — 0–5 мс. Не можна використати прості запити чи лише прогріті значення як доказ для авторизованого API.

Попередні GraphQL 25.842/21.670 мс належать старішому релізу й різним вибіркам. Перший readback поточного релізу (36 sampled requests, max bucket P99 5.257 мс, 0 errors) ще не містив наведених авторизованих перевірок. Це не A/B benchmark і не гарантія лімітів.

### Зміни попередніх релізів

- Імпортуємо лише потрібний публічний RSA-ключ Google; готовий ключ повторно використовується до TTL. Пізня відповідь попереднього запиту не замінює новіший кеш. Мережеві Promise між запитами не розділяються. Підпис і claims кожного JWT перевіряються заново.
- Ролі, блокування, відкликання сесії, дозволені домени й доступ компанії читаються як раніше. Авторизаційні рішення не кешуються.
- У транзакції порції імпорту компанії й профілі читаються один раз на шлях, включно з відсутнім профілем. Pending-записи мають пріоритет; rollback окремого товару не залишає його незавершені зміни. Наступна порція читає новий стан.
- Обмежений JSON-потік з одним chunk декодується без зайвого копіювання. Повний розмір потоку та коректність UTF-8 перевіряються до використання.
- Новий payload зберігається як вихідний обмежений UTF-8 JSON; HTTP перевіряє структуру, розмір і кількість записів. Повна перевірка полів/цін/URL/дублікатів виконується чергою до запису товарів. Некоректний JSON завершує job з `HTTP_422`, без повторів і записів у Firestore. Нові повтори потребують тих самих байтів; старі jobs зберігають попереднє нормалізоване порівняння. Контракт і помилки описані в [API_IMPORT_GUIDE.md](./API_IMPORT_GUIDE.md).
- Звіт аналітики серіалізується один раз; до кешованої частини додається свіжий budget відповідно до перевіреної ролі. До 16 записів / 192 KiB кожен / 60 секунд; клієнтський HTTP-кеш закритий.
- Події одного товару в одному пакеті повторно використовують його перевірку. Переходи до продавця мають окрему сувору URL-перевірку; різні event ID рахуються окремо.
- HTTP-запити більше не запускають retention cleanup. Очищення аналітики виконує щоденний Cron; import outbox — окремий п'ятихвилинний Cron. Межі очищення та строки зберігання збережені.
- D1 preflight об'єднує резервування UID-перевірки й читання квоти в batch; остаточна спільна квота використовує свіжу роль Firebase. Cron об'єднує expiration/recovery та очищення counters, зберігаючи порядок, leases і ліміти.
- Список імпортів отримує лише підсумки 30 jobs. Correlated JSON aggregate матеріалізує 30 малих записів замість передачі до Worker до 3000 повних результатів; детальний endpoint зберігає повні результати й перевірку власності.
- POST використовує `INSERT RETURNING` малих підсумків; replay/detail не передають payload або приватні поля авторизації з D1. Конкурентні повтори зберігають одне завдання, атомарні квоти й інтервал.
- Claim відправлення й резерв добової квоти Queue виконуються одним послідовним D1 batch; `changes()=1` списує квоту лише для отриманого job. Скасування перед claim, вичерпана квота й конкурентний останній слот перевірені в реальному D1 runtime.
- Календар Europe/Kyiv створюється лише при використанні дат аналітики; REST API не витрачає CPU на його ініціалізацію. Літній/зимовий час і межа retention перевірені.
- Початкове та ручне оновлення вкладки API читають метадані й історію послідовно, щоб не дублювати холодні OAuth exchanges. Під час першого завантаження кнопки зайняті; зміна акаунта/помилки зберігають наявні session guards.

### Історичні обмеження попередніх релізів

Імпорт: до 100 записів / 128 KiB за запит; менеджер — раз на годину, адміністратор — раз на 5 хвилин. Черга послідовна: одне повідомлення / один consumer, порції по 5 записів, до 3 повторів; повторна доставка і неоднозначний commit захищені receipt/idempotency. Денні спільні межі: 5000 записів, 100 jobs, 1500 повідомлень; перевірки доступу мають окремі admin/manager резерви.

Аналітика: до 20 подій / пакет і 4000 прийнятих подій / UTC день; до 4 одночасних зовнішніх читань. Звіт повертає до 100 груп пропозицій/фільтрів; великий період читає обмежений snapshot до 20001 денних рядків і явно позначає обмежену деталізацію. Повні totals не втрачаються. Статичні assets і розрахунок у браузері не потребують виконання Worker на кожну дію.

Це історичні caps: чинний реліз зменшив денний імпорт до 2500 записів, import sends до 600 та прийняті події аналітики до 2000 і додав окремі reservations для maintenance, ingest attempts, report reads та cleanup. Повні поточні межі наведені вище.

### Історія перевірок і приймання

`npm run lint`, `npm test` (включно з новими JWK/UTF-8/Cron regressions), `npm run test:emulators`, production build, deployment validator і Wrangler dry-run. Integration перевіряє права, квоти, чергу, транзакції, retention і звіт за максимальний дозволений період. Локальний wall time не є Cloudflare CPU.

Початкове локальне проходження оптимізації: **145 app/runtime + 112 emulator/integration = 257 PASS**, 0 failures / skipped; lint, build, validator і Wrangler dry-run — PASS. Snapshot інтеграційного тесту з 120000 денних offer-рядків підтвердив максимум 40008 D1 reads для обмеженого великого звіту; сценарій 4000 подій із cleanup оцінив 76763 D1 writes. Це контрольні сценарії, а не весь account Usage.

Перша оптимізація, source `b58b35dbb1cbeedbdfdc914a255babd5085ad22d`, пройшла [push CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37981493023) та [PR CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37981530054). Worker `df2a7371-9322-4768-87ef-37950166ee0a` опублікований на 100% трафіку о 19:41 UTC; 68 порівнянь assets і 10 негативних API перевірок — PASS, secrets/queue/Observability збережені. Native авторизовані читання о 19:42 UTC: API-ключ **8 мс**, аналітика **7 мс**, список імпортів **13 мс**. GraphQL саме цієї версії: 13 sampled requests, 0 errors, max bucket P99 **13.584 мс**. Це перший контрольний прохід, ще не приймання всіх сценаріїв у 10 мс.

Повторні читання цієї версії о 19:46 UTC: API-ключ **4 мс**, список імпортів **6 мс**, аналітика **4 мс**; порожній Cron о 19:45 UTC — **2 мс**. Перший список імпортів 13 мс не приховуємо за прогрітими результатами.

Другий блок: TypeScript і цільовий Worker/D1/Queues integration — PASS (3/3). Максимальна історія 30 jobs × 100 результатів потребує **3090 D1 rows_read**; підсумки, порожні результати, detail і manager ownership збігаються. Проміжний JOIN/GROUP BY з 6060 reads відхилений. 1000 дозволених добових access checks із такими максимальними списками — до 3,09 млн reads лише history SELECT; решта D1-запитів враховується окремо. Cron regression перевіряє expiration перед dispatch, п'ять recovery jobs, чинні leases і retention.

Найбільший production-імпорт/звіт та холодний isolate під навантаженням не вважати прийнятими без окремих фактичних вимірів.

Другий блок, source `1b768d5408967cb2cfd13e550c887a8ea1fc9fa8`: [push CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37984467712) і [PR CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37984474669) — **145 + 114 = 259 PASS**. Worker `f5d2dae7-dc20-4667-bbef-bb62fb3bacef`, 100% traffic від 20:06 UTC; 68 assets / 10 негативних API перевірок — PASS. Перші авторизовані API-ключ/імпорти/аналітика — **14/19/11 мс**, повторні API-ключ/імпорти — **7/13 мс**, порожній Cron — **3 мс**. GraphQL цієї версії: 20 sampled requests / 0 errors / max bucket P99 **19.106 мс**. Free CPU ще не прийнятий: зменшення D1 роботи саме по собі не усуває витрат першого запуску.

Третій блок відділив легку перевірку пропозицій від frontend-конвертації з Decimal. Worker bundle зменшився з 256019 до 193018 байтів (−24,6%); залежність Decimal повністю відсутня. Перевірка ціни до копійок зберігається, frontend-розрахунки з Decimal не змінюються. Source `a3451717d43aecca4820e61a36e64fffdfa3d396`, [push CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37985733841) / [PR CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37985739033): **146 + 114 = 260 PASS**. Worker `1a353e58-8da7-49c0-94fe-355e4c2ca440`, 100% traffic від 20:18 UTC; 66 asset comparisons / 10 негативних API перевірок — PASS.

Native перевірки третього блоку: перші API-ключ / список імпортів **12 / 17 мс**, авторизований звіт **9 мс**, порожні Cron **2–3 мс**. JSON із 100 записами / 129990 байтів і некоректною останньою ціною повернув 422 без записів у каталог: **17 мс**, проти **30 мс** у другому блоці. Тому приймання HTTP Free ще відкрите; менший bundle не є достатнім доказом.

Четвертий блок повторно використовує один готовий неекспортований RSA signing key точного project/secret під час OAuth refresh; кожен refresh створює свіжий підпис і власний мережевий запит. Декодування base64 використовує прямий заповнений byte buffer. Локальні **147 application/runtime tests** і незалежний security review — PASS. Ролі, відкликання й стан користувача читаються свіжо. Цей блок і перенесення повної перевірки записів у наявний Queue consumer опубліковані разом у наступному релізі.

Четвертий, п'ятий і шостий блоки, source `3e8c8784dc092a04de4cc839dcf834d63a046566`: [push CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37988577118) / [PR CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37988582696) — **149 + 117 = 266 PASS**, lint/build/deployment validator/Wrangler dry-run — PASS. Незалежний review не знайшов регресій. Worker `5d1e4750-360b-4d0d-9fb6-d32d32477f39`, 100% traffic від 20:43 UTC; 66 asset comparisons / 10 негативних API перевірок і ще 4 негативні auth перевірки — PASS.

Живий контроль `e153cd25-292a-4819-9f32-8d728d42a920`: 100 записів / 129990 байтів, остання ціна некоректна; HTTP 202 → failed / `HTTP_422`, processed **0/100**, results порожні. Повтор через кабінет повернув той самий ID без дубля. Native CPU: перший API-key **11 мс**, список **4 мс**, наступні key/list **4–5 мс**, звіт **7 мс**, POST **11 мс**, Queue consumer **14 мс**, порожній Cron **3 мс**. Queue consumer має іншу межу — 30 секунд CPU, а HTTP ще потребує запасу до 10 мс. Перший GraphQL readback мав 15 sampled requests / 0 errors / max bucket P99 11.154 мс; він ще не містив усіх пізніших подій.

Сьомий блок об'єднав dispatch claim/reserve й прибрав одночасні холодні читання вкладки API. Scoped D1 runtime **6/6 PASS**, lint PASS; перевірено відсутність списання квоти без claim, відкладення при вичерпаному резерві та конкурентний останній слот. Source `7c70e330d13fa5f00b71660731498ed8d2e656ac`: [push CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37990084004) / [PR CI](https://github.com/WebDev-Den/PrintCost/actions/runs/37990089028) — **149 + 117 = 266 PASS**, lint/build/deployment validator/Wrangler dry-run — PASS. Worker `5e3f5157-12e8-456f-a9cc-f30589b54b3a` опублікований на 100% traffic 9 жовтня о **20:57:36 UTC** (23:57:36 Europe/Kyiv). **66 asset comparisons / 10 негативних API перевірок / 4 негативні auth перевірки — PASS.** Поточний Worker bundle: **195254 проти 256019 байтів, −23,7%**; Decimal не входить у bundle.

Native контроль цієї версії 9 жовтня о **21:01:14–15 UTC** (10 жовтня 00:01:14–15 Europe/Kyiv): перший API-key **20 мс CPU**, список імпортів **7 мс**. Великий POST **100 записів / 129990 байтів** о **21:01:42.8 UTC** — **16 мс CPU**. Наступні API-key / список — **6 / 10 мс**; Queue consumer — **11 мс**, порожній Cron — **4 мс**. Queue consumer має межу **30 секунд CPU**, тому його 11 мс не є перевищенням HTTP-ліміту. Перший GraphQL readback поточної версії: **9 sampled requests / 0 errors / max bucket P99 20.191 мс**; це агрегована мала вибірка, а не гарантія кожного запиту чи всього навантаження.

Пізніші індивідуальні native події цієї версії 9 жовтня UTC: авторизований звіт о **21:01:55.557 — 10 мс CPU**; повторний API-key о **21:02:41.395 — 16 мс**, список імпортів о **21:02:42.488 — 6 мс**; детальний стан job о **21:03:17.547 — 5 мс**. У Europe/Kyiv це вже 10 жовтня. Повторний API-key 16 мс підтверджує, що одних прогрітих читань 6 мс недостатньо для приймання; первинний GraphQL snapshot не замінює цих подальших вимірів. GraphQL о 21:06 UTC: **26 sampled requests / 0 errors / max bucket P99 20.191 мс**, 5 buckets понад 10 мс. Група включає Queue; max bucket P99 не є aggregate P99 або максимумом лише HTTP.

Живий контроль `bb810f7f-75ab-4c9f-bd3c-2bbac3e9e4f4` прийнятий з HTTP 202 й завершився **failed / processed 0/100 / results [] / HTTP_422** через точність останньої ціни. Повна перевірка спрацювала до `process` та записів Firestore. Функціональне приймання нового формату, черги, повторів і відмов виконане; **суворе приймання 10 мс залишається відкритим**. Історичні та останні окремі перевищення не приховуємо за прогрітими результатами. Наступне архітектурне рішення має окремо визначити допустимий CPU/розмір запиту й зберегти свіжу авторизацію. Оплати, послаблення захисту чи зменшення поточних caps у цьому релізі немає.

Наведені CI та ручне live приймання описують функціональний runtime source `7c70e330d13fa5f00b71660731498ed8d2e656ac`. Для `main` та автоматичної Cloudflare збірки звіряти фактичний Git SHA, provenance збірки й активну версію Worker за Git/Cloudflare, а не виводити їх лише з цього документа. Зміна лише підсумкового Markdown не змінює runtime-код і не підтверджує нове native CPU приймання.

**Історична примітка про відкат:** на етапі source `7c70e330` міграцій, нових bindings чи зміни тарифу не було; версії до raw consumer не розуміли активні `raw:` jobs та нові hash повторів. Для чинного релізу з міграціями `0004–0009` застосовується розділ сумісності вище.

## Джерела

[Workers Free: 10 мс CPU HTTP/Cron, 100000 requests/день, 50 subrequests](https://developers.cloudflare.com/workers/platform/limits/). Очікування мережі/D1 не є CPU. Поодинокий overrun може пройти завдяки внутрішній гнучкості платформи; стале перевищення може спричинити `exceededCpu` / 1102.

[Queues limits](https://developers.cloudflare.com/queues/platform/limits/) описують consumer окремо. Не змішувати його тривалість з HTTP/Cron при прийманні. [Queues Free pricing](https://developers.cloudflare.com/queues/platform/pricing/) — 10000 operations/день, retention 24 години; retries також витрачають operations. Налаштування підвищення CPU для Paid не використовуємо.

[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) — Free 5 млн rows read / 100000 rows written за UTC день; індекси INSERT/UPDATE також витрачають writes. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) — Free до 500 MB на базу; загальна Free storage квота акаунта 5 GB. Добові ресурси й storage перевіряти разом з іншими базами акаунта.
