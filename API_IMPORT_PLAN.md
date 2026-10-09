# REST API імпорту компаній і пластиків

**Реалізовано й активовано 9 жовтня 2026** за командою власника. D1 migrations 0002/0003, Queue `kilog-imports` і окремий Firebase service account підключені; тарифи лишаються Cloudflare Free / Firebase Spark, billing вимкнений. Поточний реліз, докази та відкриті задачі — у [REMAINING_TASKS.md](./REMAINING_TASKS.md).

## Контракт і межі

- `/api/v1/api-key`: GET метаданих / POST створення чи ротації / DELETE відкликання власного ключа. Кабінет використовує Firebase ID token; зміна ключа потребує свіжого входу. Один ключ на користувача, випадкові 256 біт, plaintext лише у відповіді створення, у D1 лише SHA-256. Зміна ролі/компанії, блокування, видалення чи відкликання Firebase сесій зупиняє доступ.
- `/api/v1/imports`: POST JSON з `offers` і необов’язковим admin-only `companies`; `Authorization: Bearer <API-key>` та обов’язковий `Idempotency-Key`. Відповідь 202 з ID й URL статусу. GET списку/деталей — лише власні завдання; admin може бачити всі завдання, без чужих ключів.
- `externalId` стабільний у межах компанії: повторний імпорт оновлює той самий запис, не видаляє відсутні в JSON товари. Невідомі/некоректні поля відхиляються. Компанії зіставляються за ID або точним доменом HTTPS URL; неоднозначність — помилка. Admin може створювати компанії за JSON; для нового URL створюється активна компанія з назвою-доменом для подальшого заповнення. Жодного сканування сайтів чи призначення менеджера автоматично.
- Manager: лише компанія ключа, активний поточний membership і точні `allowedDomains`; створення компаній і блокування пропозицій заборонені. Права перевіряються також перед фактичним записом. Admin: усі компанії та їх JSON. Тип пластику прив’язує актуальний стандартний/власний профіль без копіювання температур у кожний товар; невідомий тип потребує явної групи, без вигаданої температури.
- До 100 записів сумарно й 128 KiB JSON за запит; manager раз на 3600 секунд, admin раз на 300 секунд. Cooldown за UID, а не ключем; максимум одне незавершене завдання на UID. Спільно до 5000 записів / 100 завдань на добу UTC, до 100 активних завдань. До Firebase — 30 запитів/хв/IP та UID, персональна квота 10 невідомому UID / 200 manager / 500 admin із ключем. Успішні рішення доступу мають незалежні бюджети 500 manager / 500 admin; відмови не забирають резерв адміністратора. 429 має Retry-After; лічильник не скидається ротацією.
- D1 зберігає завдання й outbox; Cloudflare Queues передає тільки ID/позицію, consumer concurrency 1 і до 5 записів за доставку. Firestore transaction + приватний receipt запобігають повторним записам після crash/retry. Durable outbox відновлює збій відправлення. Максимум 3 retries, deadline 24 години; статус/часткові помилки доступні клієнту, payload очищається після завершення. Ротація/відкликання скасовує невиконану частину; вже почата маленька транзакція може завершитися.
- Асинхронні записи використовують окремий Firebase service account у Worker Secret, а не пароль, browser refresh token або API key Firebase. IAM перевірений: тільки `roles/datastore.user` та `roles/firebaseauth.viewer`; OAuth обходить Firestore Rules, тому Worker сам перевіряє поточні права. Правила клієнта не послаблені, Firestore App Check enforcement увімкнений. Credentials поза Git.

## Порядок завершених блоків

- [x] 1. JSON контракт, нормалізація URL/типів, профілі, стабільні IDs та domain tests.
- [x] 2. Firestore REST/OAuth adapter, актуальний Auth/role scope, транзакційні компанії/пропозиції/receipts; emulator tests.
- [x] 3. D1 ключі, атомарні quotas/idempotency/outbox, API маршрути та Queue consumer; real workerd/D1 integration й crash/retry/concurrency tests.
- [x] 4. Вкладка API лише для manager/admin: ключ/ротація/відкликання, документація, JSON/curl, статуси й імпорт JSON; UI/SDK tests.
- [x] 5. Повні lint/tests/emulators/build/dry-run і CI; підготовлена інструкція активації/rollback, Git і файли стану. Контрольовані live imports виконані лише для тестової компанії/прихованого товару, без реальних товарних змін і paid plan.

Реалізовано додатковий ліміт 1 500 відправлень Queue/UTC-добу; навіть із трьома повторними читаннями це до 9 000 операцій для повідомлень цього API. Ключ діє 90 днів. Приватна квитанція одна на імпорт; очищається разом з історією після 30 днів. При upsert пропущені необов’язкові поля зберігаються, зокрема hidden/blocked status і ручний опис.

137 application tests + 100 emulator/integration tests PASS, включно з неоднозначним commit, недоступним producer, відкликанням прав, квотами та незалежністю authorization batchGet від порядку found/missing rows. [CI source 9f2d8ba](https://github.com/WebDev-Den/PrintCost/actions/runs/37959585046).

Локальне UI-приймання ключів/ролей/менеджера завершене. У production зовнішній ключ дав completed 1/1; повтор того самого Idempotency-Key повернув той самий job. Кабінет адміністратора імпортував company JSON + оновлення товару: completed 2/2, ціна 600 → 610, ID і пропущений опис збережені; PLA профіль застосований. Контрольний товар прихований і виключений із публічного каталогу. Живий сценарій окремого менеджера та максимальне навантаження ще відкриті.

Початковий live CPU readback: 55 sampled requests, 0 runtime errors, max bucket P99 25.842 ms. Після опублікованого batchGet: 16 sampled requests, 0 runtime errors, max bucket P99 21.670 ms. Права не кешуються. Вибірки різні, піки досі вище номінальних 10 ms HTTP/Cron Free; залишковий ризик описаний у статусі. Не обіцяти 100% доступність на безкоштовному плані. [Інструкція](./API_IMPORT_GUIDE.md).

## Джерела

- [Firestore REST auth і IAM](https://firebase.google.com/docs/firestore/use-rest-api): service account OAuth використовує IAM, Firebase ID token — Rules.
- [Queues Free pricing](https://developers.cloudflare.com/queues/platform/pricing/): 10 000 операцій/день, стандартна доставка — три операції; retry теж витрачає квоту.
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/): Free retention 24 години; лише невеликі ID messages.
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 10 ms HTTP/Cron CPU на Free, 50 external subrequests; контрольні тести не замінюють фактичний production CPU.
