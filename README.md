# KILO·G — собівартість FDM/FFF 3D-друку

Калькулятор витрат і ціни замовлення, матеріали, принтери, історія розрахунків та публічний каталог філаментів. Застосунок читає підтримувані метадані нарізки локально у браузері.

Поточний стек: React + TypeScript + Vite, **Cloudflare Pages** для сайту, **Firebase Authentication** для акаунтів і **Cloud Firestore Standard** для даних. Окремий REST-сервер, Firebase Storage та Cloud Functions для цього запуску не потрібні. [SERVER_SPECIFICATION.md](./SERVER_SPECIFICATION.md) зберігає попередню архітектуру як історичний документ; актуальні інструкції наведені тут.

## Firebase Spark: початкове налаштування

Цільовий Firebase-проєкт — `kilo-g`, тариф **Spark**. 8 жовтня 2026 року створено Web app і безкоштовну Firestore Standard `(default)` у `eur3`, опубліковано правила та індекси, увімкнено Email/Password. Налаштування виконуються в [Firebase Console](https://console.firebase.google.com/project/kilo-g/overview).

1. У **Project settings → General → Your apps** зареєструйте Web app. Firebase Hosting для нього не вмикайте: сайт розміщується на Cloudflare Pages.
2. У **Authentication → Sign-in method** увімкніть **Email/Password**. Застосунок використовує пароль, підтвердження адреси та відновлення пароля. Окремий SMTP не потрібен. [Документація Email/Password](https://firebase.google.com/docs/auth/web/password-auth).
3. Створіть **Firestore Database**, оберіть **Standard**, database ID **`(default)`**, потрібний регіон і **production mode**. Початкові закриті правила замініть правилами з репозиторію через команду нижче. Правила test mode для робочого сайту не використовуйте.
4. Скопіюйте `apiKey`, `authDomain`, `projectId` та `appId` з конфігурації Web app. Усі чотири значення потрібні для збірки.
5. У **Authentication → Settings → Authorized domains** додайте точний hostname робочого сайту, наприклад `kilog-printcost.pages.dev`, без `https://`, шляху чи порту. Для локальної роботи з реальним Firebase додайте `localhost` вручну: нові проєкти більше не отримують його автоматично. Якщо тестуєте окремий preview або власний домен, додайте також його hostname. [Дозволені домени Firebase](https://firebase.google.com/docs/auth/web/email-link-auth).

Після встановлення залежностей увійдіть у Firebase CLI й опублікуйте правила та індекси:

```bash
npm ci
npx firebase login
npm run deploy:firebase -- --project kilo-g
```

Команда розгортає лише `firestore.rules` і `firestore.indexes.json`. Вона не публікує сайт та не створює платних функцій. Виконайте її до роботи з реальними акаунтами.

Приватні дані зберігаються під `users/<uid>` та його підколекціями. Правила дозволяють доступ власнику акаунта. Публічні `filaments`, `manufacturers` і `temperatureProfiles` доступні для читання; змінювати їх може адміністратор із custom claim `admin: true`. Початковий каталог береться з даних у репозиторії, а зміни адміністратора зберігаються у Firestore.

Право адміністратора встановлюється **тільки Firebase Admin SDK у довіреному середовищі**. Не додавайте його через браузер, поле профілю або локальне сховище. Під час `setCustomUserClaims` зберігайте наявні claims; після зміни користувач має отримати новий ID token, наприклад повторно увійти. Секрети Admin SDK не належать до вебконфігурації. [Custom claims](https://firebase.google.com/docs/auth/admin/custom-claims).

## Локальний запуск із реальним Firebase

Використовуйте **Node.js 22.23.2**, зафіксований у `.nvmrc`, і залежності з `package-lock.json`.

Створіть `.env.local` за прикладом `.env.example` та вставте значення саме вашої Web app:

```dotenv
VITE_FIREBASE_API_KEY=<apiKey з Firebase Console>
VITE_FIREBASE_AUTH_DOMAIN=<authDomain з Firebase Console>
VITE_FIREBASE_PROJECT_ID=kilo-g
VITE_FIREBASE_APP_ID=<appId з Firebase Console>
VITE_USE_FIREBASE_EMULATORS=false
```

Це **публічна конфігурація клієнта**, яка потрапляє у збірку. Вона не замінює правила Firestore. Паролі, service account JSON, приватні ключі та адміністративні credentials у `VITE_*` додавати не можна. `.env.local` виключений із Git. [Firebase API keys](https://firebase.google.com/docs/projects/api-keys).

```bash
npm ci
npm run dev
```

Відкрийте `http://localhost:3000`. Реальна авторизація потребує Firebase-конфігурації; відсутність конфігурації або помилка мережі не перетворюються на успішний вхід. Демо вмикається окремою дією та зберігає демонстраційні дані локально, окремо від реальних акаунтів. Попередні локальні дані автоматично не імпортуються у Firebase.

Перевірка та збірка:

```bash
npm test
npm run lint
npm run build
npm run preview
```

`npm run lint` перевіряє TypeScript. Production-збірка зупиняється, якщо бракує однієї з чотирьох Firebase-змінних, увімкнено емулятори або вказано `demo-*` project ID. Після зміни `VITE_*` сайт потрібно зібрати повторно.

## Локальні емулятори та перевірка правил

Для Firestore Emulator встановіть **Java JDK 21** і переконайтеся, що `java` доступна в терміналі. Firebase CLI вже входить у залежності проєкту. Емулятори використовують `demo-kilog`, Auth на `127.0.0.1:9099`, Firestore на `127.0.0.1:8080`. [Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure).

Перевірка правил сама запускає та зупиняє Firestore Emulator:

```bash
npm run test:rules
```

Для локального тестування інтерфейсу створіть `.env.emulator.local`:

```dotenv
VITE_FIREBASE_API_KEY=demo-key
VITE_FIREBASE_AUTH_DOMAIN=demo-kilog.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-kilog
VITE_FIREBASE_APP_ID=demo-kilog
VITE_USE_FIREBASE_EMULATORS=true
```

У першому терміналі запустіть `npm run emulators`, у другому — `npm run dev -- --mode emulator`. Відкрийте `http://localhost:3000`. Акаунти й дані емулятора не є реальними акаунтами `kilo-g`; листи емулятора не надходять у поштову скриньку. Цей режим призначений для локального тестування, а не публікації.

## Cloudflare Pages через GitHub

Репозиторій: [WebDev-Den/PrintCost](https://github.com/WebDev-Den/PrintCost). Зміни застосунку, `package-lock.json`, конфігурація Firebase та `.nvmrc` мають бути у гілці, з якої Cloudflare виконує збірку.

1. У Cloudflare відкрийте **Workers & Pages → Create application → Pages → Connect to Git**.
2. Надайте інтеграції GitHub доступ до `WebDev-Den/PrintCost`. Репозиторій може бути приватним або публічним; робити його публічним для деплою не потрібно. [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [обмеження Pages](https://developers.cloudflare.com/pages/platform/limits/).
3. Оберіть production-гілку й задайте налаштування:

| Поле | Значення |
| --- | --- |
| Project name | `kilog-printcost` або доступна назва |
| Framework preset | React (Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | Корінь репозиторію |
| `NODE_VERSION` | `22.23.2` |

[Налаштування збірки](https://developers.cloudflare.com/pages/configuration/build-configuration/), [версія Node.js](https://developers.cloudflare.com/pages/configuration/build-image/).

4. Додайте `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` із Web app проєкту `kilo-g` у **production environment variables**. `VITE_USE_FIREBASE_EMULATORS` має бути відсутнім або `false`. Якщо потрібні preview deployments, задайте для них конфігурацію також; їхні дані будуть у тому Firebase-проєкті, який ви вказали.
5. Запустіть деплой. Після отримання адреси `https://<project>.pages.dev` внесіть її **hostname** у Firebase Authorized domains. Додавання домену не змінює вже зібрані Firebase-змінні.
6. Перевірте відкриття головної сторінки та прямих адрес `/auth/login`, `/auth/callback`, `/app/calculator`. Pages обслуговує маршрути SPA через `index.html`; у проєкті немає власної верхньорівневої `404.html`. [SPA на Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

Після підключення Git зміни production-гілки автоматично запускають нову збірку. Безкоштовний піддомен `pages.dev` достатній; купувати домен не потрібно.

Для ручного оновлення вже підготовленого Pages-проєкту доступні `npx wrangler login` і `npm run deploy:pages` після правильної production-збірки. Скрипт очікує назву `kilog-printcost`; якщо назва інша, передайте її безпосередньо `npx wrangler pages deploy dist --project-name <name>`. Не публікуйте локальну збірку для емуляторів.

## Листи підтвердження та відновлення пароля

Стандартний обробник листів Firebase працює без налаштування власної сторінки: після завершення дії він може повернути користувача у застосунок. Авторизація використовує URL поточного сайту, тому його hostname має бути дозволеним у Firebase.

За бажанням після деплою в **Authentication → Templates** задайте для листів підтвердження та скидання пароля **Action URL** `https://<project>.pages.dev/auth/callback`. Власний маршрут обробляє `mode=verifyEmail` та `mode=resetPassword` із `oobCode`; при скиданні відкриває `/auth/reset-password`. Копіювати або обривати параметри посилання з листа не потрібно. [Власний email handler](https://firebase.google.com/docs/auth/custom-email-handler).

Публічний запуск потребує окремої перевірки доставлення реальних листів, повторного входу після підтвердження та входу з новим паролем після відновлення.

## Підтримка файлів

| Формат | Що читає застосунок |
| --- | --- |
| Текстовий `.gcode` PrusaSlicer / OrcaSlicer | `estimated printing time (normal mode)`, витрати кожного філаменту `[g]` / `[mm]`, типи, кольори, модель принтера та діаметр сопла за наявності |
| Текстовий `.gcode` Bambu Studio | `total estimated time`, `total filament weight [g]` та довжина; лише коли масив витрат можна однозначно зіставити з філаментами |
| Нарізаний `.3mf` / `.gcode.3mf` Bambu Studio / OrcaSlicer | `Metadata/slice_info.config`: індекс пластини, `prediction`, `filament id`, `used_g`, `used_m`, тип і колір; відповідний `plate_<index>.gcode` доповнює наявні дані |
| Архів із текстовим `plate_<index>.gcode` без `slice_info.config` | Підтримувані статистичні коментарі кожної пластини |

Індекси пластин і філаментів беруться з файла, включно з пропусками в нумерації. Загальний час і маса обчислюються з прочитаних пластин. Перерахунок довжини в грами можливий лише за наявності **реальних діаметра та густини з файла**; стандартна густина за назвою матеріалу не підставляється.

Для успішного аналізу потрібні час друку та витрати кожного філаменту. Відсутні тип або колір супроводжуються попередженням і ручним вибором матеріалу; відсутні час чи маса не підміняються демонстраційними числами. Пошкоджені ZIP/XML відрізняються від проєктів із моделями без нарізки.

Файл залишається у браузері: worker читає метадані, а в Firestore зберігається компактний розрахунок, не оригінальний архів. Ліміти аналізатора:

- 50 MiB завантаженого файла;
- 64 MiB на запис ZIP та 256 MiB сумарно розпакованих даних;
- 2048 записів ZIP і 2 MiB `slice_info.config`;
- 30 секунд роботи worker; фактичний розпакований розмір і CRC перевіряються.

Binary `.bgcode`, `.stl`, автоматична нарізка моделей, ZIP64, шифровані архіви й специфічні варіанти інших слайсерів не підтримуються. Сумісність Creality Print, Elegoo або Cura без перевірених зразків не заявляється. Демонстраційні сценарії позначені як демо та не є аналізом користувацького файла.

## Межі поточної версії

- Історія завантажує останні **200** розрахунків; старіші залишаються в базі й відкриваються за прямим посиланням. Для повного списку потрібна пагінація.
- Один збережений розрахунок обмежений **700 КБ**, до **100 пластин** і **500 рядків філаментів**.
- Реальні записи потребують мережі й підтвердження сервера; помилка запису не відображається як успішне збереження.
- Автоматичне спостереження за локальною папкою не реалізоване; файли додаються користувачем.

## Безкоштовні квоти

Умови перевірені **8 жовтня 2026 року**. Запуск може залишатися безкоштовним у межах квот Cloudflare Free та Firebase Spark. Це не гарантія безперервної роботи, необмеженого навантаження чи сумісності з будь-яким файлом.

Firestore надає одну безкоштовну базу на проєкт: **1 GiB даних, 50 000 читань, 20 000 записів і 20 000 видалень на день**, **10 GiB вихідного трафіку на місяць**. Денна квота оновлюється за тихоокеанським часом, а не за київським. [Квоти Firestore](https://firebase.google.com/docs/firestore/quotas).

Для листів Firebase Auth на Spark заявлені **1000 підтверджень адреси** й **150 скидань пароля на день**; також діють обмеження проти зловживань. [Квоти Authentication](https://firebase.google.com/docs/auth/limits).

Cloudflare Pages Free має **500 збірок на місяць**; ліміт одного статичного файла сайту — **25 MiB**. Цей ліміт стосується опублікованих assets, а не локального файла нарізки, який аналізує браузер. [Квоти Pages](https://developers.cloudflare.com/pages/platform/limits/).

Перевищення квот Spark може призупинити відповідну операцію або продукт до відновлення квоти. Підключення Cloud Billing переводить проєкт на Blaze з оплатою використання; для бюджету 0 грн залишайтеся на Spark і контролюйте Usage у Firebase Console. [Тарифи Firebase](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

## Стан перевірки

Локально пройдені TypeScript-перевірка, **14 тестів авторизації, розрахунку та аналізатора файлів** і **9 перевірок правил Firestore та API**. Браузерний сценарій із Firebase Emulator перевірив реєстрацію, майстер налаштувань, завантаження G-code через worker, збереження й перезавантаження історії, повторний вхід та ізоляцію двох акаунтів. Пропуск усіх кроків не створює обладнання й матеріалів та не змінює існуючих налаштувань; новий акаунт не отримує вигаданий тариф електроенергії.

Публічний сайт, доставлення реальних листів і роботу на остаточному hostname потрібно підтвердити після деплою. Адміністративний custom claim ще не призначено реальному користувачу. Збірка й тести самі по собі не підтверджують завершений публічний запуск.
