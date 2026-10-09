# Firebase App Check: запуск і перевірка

Код клієнта готовий: `firebase/app-check` ініціалізується перед Auth/Firestore з `ReCaptchaEnterpriseProvider` та автоматичним оновленням токена. Аналітика передає `X-Firebase-AppCheck` через Worker до Firestore REST; ролі перевіряються окремо, без довіри до цього заголовка. Помилки атестації не перетворюються на успіх і не отруюють спільний кеш. REST API зовнішнього імпорту використовує власний ключ і server-side OAuth, тому App Check браузера для нього не потрібен.

## Безкоштовність і межі

- Проєкт `kilo-g` має лишатися **Spark**, Cloud Billing — **вимкнений**. Це перевірено через billing API 9 жовтня 2026.
- reCAPTCHA Enterprise без billing має 10 000 assessments/місяць на організацію, спільно для її проєктів. Після вичерпання повертає 429 до наступного місяця; не підключати оплату як спосіб усунення цієї помилки. [Офіційні ліміти](https://docs.cloud.google.com/recaptcha/docs/billing-information).
- TTL токена можна задати 30 хвилин–7 днів. SDK оновлює його приблизно на половині TTL; довший TTL економить assessments, але збільшує строк придатності вкраденого токена. Початково — 24 години. [Налаштування провайдера](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
- App Check для Authentication потребує **Firebase Authentication with Identity Platform**. Він може залишатися на Spark з лімітом 3000 активних користувачів/день для email/social входу; не погоджувати Blaze чи billing. [Firebase Authentication](https://firebase.google.com/docs/auth), [захист Auth](https://docs.cloud.google.com/identity-platform/docs/admin/app-check-integration).
- App Check ускладнює пряме використання Firebase ботами, але не обмежує кількість читань усередині справжнього клієнта. Spark квоти та моніторинг usage лишаються обов'язковими. Захист публічної аналітики її власними квотами зберігається; передавання заголовка не означає окремої криптографічної перевірки App Check самим Worker.

## Послідовність активації

1. Створити Web **score-based** reCAPTCHA Enterprise key у `kilo-g` тільки для `web-dev.pp.ua` та `kilo-g.web-developer-den.workers.dev`. Не додавати localhost, wildcard domains чи checkbox challenge.
2. Зареєструвати цей ключ для існуючого Web app у Firebase App Check, TTL `86400s`, типовий risk threshold `0.5`. Умови сервісу, якщо показані, приймає власник. Не вмикати enforcement до публікації SDK.
3. Записати лише публічний site key у `VITE_APP_CHECK_SITE_KEY` production build. Секрети провайдера, service-account private key та debug tokens не мають потрапляти у VITE_* або Git. Build/dry-run й тести повинні пройти.
4. Випустити клієнт і Worker разом. Перевірити реальні SDK запити до Firestore, Google/email sign-in, приватний кабінет, каталог, логотипи та звіт менеджера. Переглянути verified/unverified metrics App Check. Старі вкладки без нового SDK потребують оновлення.
5. Лише після успішного приймання ввімкнути enforcement **Cloud Firestore**. Повторити ті самі сценарії; прямий запит без токена має відхилятися, browser SDK із токеном — працювати.
6. Для **Authentication** спочатку виконати окремий перехід на Identity Platform, зберігши Spark і вимкнений billing; потім перевірити SDK, метрики й enforcement Auth. Якщо консоль вимагає оплату — зупинитися, а не змінювати тариф.
7. Моніторити assessments, auth DAU, Firestore reads/writes і відмови справжніх користувачів. Зберегти readback конфігурації й результати перевірок у статусі задач.

## Локальна перевірка та відкат

Емулятори пропускають атестацію тільки коли `VITE_USE_FIREBASE_EMULATORS=true` і hostname — loopback. Та сама змінна на production домені не обходить App Check. Debug provider не використовується. Без зареєстрованого site key клієнт працює в попередньому режимі; це **не активований захист**.

Якщо після enforcement справжні клієнти відхиляються, спочатку зібрати код помилки/метрики без токенів та приватних даних. Відкат UI до версії без App Check несумісний з enforcement. Зняття enforcement послаблює захист і потребує погодженого аварійного рішення; не робити його автоматично при помилці SDK.
