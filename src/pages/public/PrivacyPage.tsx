import React, { useState } from 'react';
import { PublicNavbar } from '../../components/layout/PublicNavbar.tsx';
import { Footer } from '../../components/layout/Footer.tsx';
import { analyticsOptedOut, analyticsService } from '../../services/analyticsService.ts';

export const PrivacyPage: React.FC = () => {
  const [optedOut, setOptedOut] = useState(analyticsOptedOut);
  return <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
    <PublicNavbar />
    <main className="max-w-3xl w-full mx-auto px-4 py-12 space-y-8">
      <h1 className="text-3xl font-bold">Дані та приватність</h1>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Акаунт і розрахунки</h2>
        <p>Firebase Authentication обслуговує вхід, підтвердження пошти й відновлення пароля. KILO·G зберігає профіль, особисті матеріали, принтери, шаблони та знімки збережених розрахунків у Firebase Firestore.</p>
        <p>Ці дані доступні власнику підтвердженого незаблокованого акаунта. Адміністратор бачить службовий список акаунтів із email, ім’ям і статусом, керує ролями та компаніями; ця роль не дає доступу до чужих приватних розрахунків. Зміни прав зберігаються в службовому журналі.</p>
        <p>Файл G-code або 3MF аналізується у вашому браузері. Після збереження розрахунку на сервер потрапляють його назва, вибрані параметри, прочитані метадані друку та результати; сам оригінальний файл не завантажується.</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Аналітика каталогу</h2>
        <p>Щоб оцінювати корисність каталогу, застосунок вимірює пошук, використання фільтрів, відсутність результатів, видимі покази пропозицій, відкриття деталей, переходи до продавця й додавання особистого матеріалу.</p>
        <p>Подія містить випадковий одноразовий ідентифікатор для усунення повторів, вид дії, ідентифікатор пропозиції та обмежені категорії матеріалу, упаковки й наявності. Звіт також зберігає публічну назву пропозиції на момент збору. Пошуковий текст, email та UID акаунта відвідувача, IP, дані файла й історія розрахунків не записуються в базу аналітики. Події не об’єднуються в персональні профілі відвідувачів.</p>
        <p>Детальні події очищаються після 30 днів, денні агрегати — після 12 місяців під час обмеженого щоденного очищення. Після тривалої недоступності сервісу очищення може потребувати кількох запусків. Менеджери отримують агрегати лише своєї компанії, адміністратори — системи. Перехід до магазину не підтверджує покупку.</p>
        <label className="flex items-start gap-3 rounded-xl border border-neutral-300 dark:border-neutral-700 p-4">
          <input type="checkbox" checked={!optedOut} onChange={event => { const value = !event.target.checked; analyticsService.setOptedOut(value); setOptedOut(value); }} className="mt-1" />
          <span>Дозволити вимірювання активності каталогу в цьому браузері. Вимкнення очищає чергу ще не надісланих подій і не впливає на калькулятор або посилання продавців.</span>
        </label>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Налаштування зберігається локально для цього домену. Раніше надіслані події не можна зіставити з вашим акаунтом для індивідуального видалення. Демо не надсилає робочих подій.</p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Браузер і зовнішні сервіси</h2>
        <p>Локальне сховище зберігає сесію входу, вибрану тему, параметри інтерфейсу, налаштування аналітики та окремі демонстраційні дані. Очищення сховища браузера видаляє локальні налаштування; збережені дані акаунта залишаються у Firestore.</p>
        <p>Cloudflare обслуговує сайт і захист запитів, Firebase — акаунти й дані. Провайдери отримують технічні дані мережевих запитів відповідно до власних умов: <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer" className="underline">приватність Cloudflare</a>, <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noopener noreferrer" className="underline">приватність Firebase</a>. Відкриття посилання продавця переводить вас на зовнішній сайт із власними правилами.</p>
      </section>
    </main>
    <Footer />
  </div>;
};
