# Firebase: чинний захист і безкоштовні межі

Оновлено **9 жовтня 2026**. Проєкт `kilo-g` лишається **Spark**; Cloud Billing API підтверджує `billingEnabled: false`.

## Виконано в production

- Для Web app `1:27559428526:web:2469fc6c751a67ac5a883f` зареєстрований score-based reCAPTCHA Enterprise provider, TTL `86400s`, risk threshold `0.5`. Дозволені лише `web-dev.pp.ua` і `kilo-g.web-developer-den.workers.dev`, без wildcard/localhost.
- `firebase/app-check` ініціалізується перед Auth/Firestore; токен оновлюється автоматично. Клієнт і строгий CSP опубліковані. CSP дозволяє фактичний endpoint встановленого SDK `https://content-firebaseappcheck.googleapis.com`; regression перевіряє origin із встановленого пакета.
- **Cloud Firestore App Check — ENFORCED**, readback 9 жовтня о 16:15 UTC. Власник підтвердив Verified requests; каталог, приватний кабінет, пропозиції компанії й авторизована аналітика працюють після enforcement. Пряме читання контрольної компанії без App Check повертає **403 PERMISSION_DENIED**.
- Аналітика передає `X-Firebase-AppCheck` через Worker до Firestore. Помилка атестації не перетворюється на успіх і не отруює кеш. Ролі перевіряються окремо: заголовок не дає жодних привілеїв.
- Зовнішній REST-імпорт використовує особистий API-ключ і серверний OAuth. Окремий `kilog-import-worker` має тільки `roles/datastore.user` та `roles/firebaseauth.viewer`. Поточні права перевіряються перед HTTP-запитом і кожною порцією черги; Rules для браузера не послаблені.

## Authentication: заміна пропущеного Identity Platform

**За прямою командою власника Identity Platform та App Check enforcement для Authentication пропущено.** Не повертатися до цього upgrade як до обов'язкової задачі, не вмикати billing/Blaze. Поточний subtype — `FIREBASE_AUTH`, Auth App Check — `UNENFORCED`.

Без переходу на інший тариф використовуються:

- Turnstile на публічних формах із серверним Siteverify, перевірками action/hostname, строку токена й повторного використання; native Worker limiter обмежує запити.
- Власні квоти та антизловживання Firebase Auth; **email enumeration protection увімкнений**, live readback `enableImprovedEmailPrivacy: true`.
- Підтверджена email-адреса для приватних даних і привілейованого API, свіжий вхід для чутливих операцій, перевірки блокування/відкликаної сесії/поточної ролі. API-ключі мають персональні й окремі admin/manager квоти.
- App Check enforcement залишається ввімкненим для Firestore, де містяться дані та права користувачів.

Це **не тотожна заміна Auth App Check**: прямий Firebase Auth endpoint не отримує обов'язкового доказу Turnstile, тому його можна викликати поза формою сайту. Перенесення SDK у Worker чи приховування публічного web config не закриває цю межу. Поточна мінімальна довжина пароля — 6 символів; посилена серверна password policy ще не налаштована. [Firebase API keys і Auth abuse](https://firebase.google.com/docs/projects/api-keys#tighten-quota), [email enumeration protection](https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection).

## Квоти та перевірки

reCAPTCHA Enterprise без billing: до 10 000 assessments/місяць на організацію; після вичерпання — 429 до наступного місяця. TTL 24 години зменшує assessments, але збільшує строк придатності вкраденого токена; SDK оновлює приблизно на половині TTL. [Ліміти](https://docs.cloud.google.com/recaptcha/docs/billing-information), [провайдер](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).

App Check ускладнює прямі запити ботів, але не ставить денний ліміт читань для справжнього клієнта. Контроль Firestore/Enterprise/Workers/D1/Queue Usage лишається потрібним. Ліміти API не гарантують безкоштовності будь-якого навантаження.

Локальні емулятори пропускають атестацію лише з `VITE_USE_FIREBASE_EMULATORS=true` на loopback; production домен не має bypass або debug provider. Секрети, service-account JSON і debug tokens не записувати у `VITE_*` чи Git.

## Відкат

Старий клієнт без App Check несумісний із чинним Firestore enforcement. Спочатку перевірити код помилки й метрики без credentials; не знімати enforcement автоматично через помилку SDK. Повернення версії без SDK потребує окремого погодженого аварійного рішення щодо захисту. Звичайний відкат має обирати сумісну версію із SDK та правильним CSP.
