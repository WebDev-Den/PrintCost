# Запуск, резервні копії та відновлення KiloG

Робочий Firebase-проєкт — **kilo-g**, база Firestore **(default), Standard**, тариф **Spark**. Сайт і API — Worker **kilo-g** на Cloudflare Free. Зміна тарифу, Cloud Billing, Blaze, paid Workers, керовані backups/PITR або платні сервіси не входять до цього запуску.

## Перед випуском

Перевірити production build, TypeScript, тести застосунку, Rules, account cleanup, operations і реальний Worker/D1 runtime. Для CI потрібні Node 22 та Java 21 для емулятора. CI запускається на push/PR; розклад, автоматична оплата й деплой з неперевіреної гілки не потрібні. Не завантажувати `output/backups`, Auth exports, CLI credentials або журнали приватних даних як CI artifacts.

Публікація заблокована, поки D1 `database_id` є placeholder, немає потрібних bindings або застосованої міграції. Фактичні CPU API на Workers Free треба виміряти на робочому релізі для холодного/прогрітого ключа, неправильних токенів, пакета подій і великого звіту. Локальний wall time і sampled V8 profile не підтверджують облік Cloudflare та межу **10 мс CPU**. Не вмикати paid plan для проходження перевірки: скоротити роботу запиту або залишити аналітику недоступною до усунення причини. Відмова API аналітики не повинна зупиняти статичний сайт і калькулятор.

Перевірити дозволені Firebase Auth домени, реальні листи підтвердження/відновлення, роботу прямого URL, bootstrap власника і ролей. Зберегти git SHA, версію Worker, стан Rules/indexes та ідентифікатор міграції D1. Відкат коду або Rules не відновлює дані автоматично.

Локальний remote — [WebDev-Den/PrintCost](https://github.com/WebDev-Den/PrintCost), робоча гілка `codex/user-platform`. Read-only інвентаризація 8 жовтня 2026 підтвердила доступ до Worker API та наявні deployments із source `wrangler`. [Workers Builds trigger inventory](https://developers.cloudflare.com/api/resources/workers_builds/subresources/triggers/methods/list/) повернув **403 / 10000** для наявного CLI OAuth: його scopes не містять Workers CI Read/Write. Це не доводить відсутності Git connection. Перед випуском власник має перевірити в Cloudflare Builds підключений repository, production branch, root directory, build/deploy commands і відсутність небажаного автодеплою. Скрипти цього етапу не розширюють scopes, не створюють triggers і не запускають builds.

## Захищений локальний експорт

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
