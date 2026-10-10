import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { NavLink } from 'react-router-dom';
import { getCookieConsent, openCookieSettings, setCookieConsent, subscribeCookieConsent } from '../../services/cookieConsentService.ts';
import { Button } from './Button.tsx';
import { Modal } from './Modal.tsx';

export const CookieConsent: React.FC = () => {
  const consent = useSyncExternalStore(subscribeCookieConsent, getCookieConsent, () => null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    const open = () => { setAnalytics(getCookieConsent() === true); setSettingsOpen(true); };
    window.addEventListener('kilog:cookie-settings', open);
    return () => window.removeEventListener('kilog:cookie-settings', open);
  }, []);

  const save = (allowAnalytics: boolean) => { setCookieConsent(allowAnalytics); setSettingsOpen(false); };

  return <>
    {consent === null && !settingsOpen && <section aria-labelledby="cookie-banner-title" className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-5xl rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex-1 min-w-0">
          <h2 id="cookie-banner-title" className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Кукі та приватність</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">Використовуємо кукі й сховище браузера для входу, безпеки та налаштувань. Аналітика каталогу — лише з вашого дозволу. <NavLink to="/privacy" className="underline hover:text-emerald-600 dark:hover:text-emerald-400">Дані та приватність</NavLink></p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => save(false)}>Лише необхідні</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => save(true)}>Дозволити аналітику</Button>
          <Button type="button" size="sm" variant="ghost" onClick={openCookieSettings}>Налаштувати</Button>
        </div>
      </div>
    </section>}
    <Modal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="Налаштування кукі" description="Оберіть, чи дозволяти необов’язкову аналітику." footer={<div className="flex flex-wrap justify-end gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => save(false)}>Лише необхідні</Button>
      <Button type="button" size="sm" onClick={() => save(analytics)}>Зберегти вибір</Button>
    </div>}>
      <label className="flex items-start gap-3">
        <input type="checkbox" checked disabled className="mt-1 accent-emerald-600" aria-describedby="cookie-necessary-description" />
        <span><span className="block font-medium">Необхідні — завжди активні</span><span id="cookie-necessary-description" className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">Підтримують вхід, захист форм, вибрану тему й налаштування інтерфейсу. Без них сайт працюватиме некоректно.</span></span>
      </label>
      <label className="flex items-start gap-3 border-t border-neutral-200 dark:border-neutral-800 pt-4">
        <input type="checkbox" checked={analytics} onChange={event => setAnalytics(event.target.checked)} className="mt-1 accent-emerald-600" aria-describedby="cookie-analytics-description" />
        <span><span className="block font-medium">Аналітика каталогу</span><span id="cookie-analytics-description" className="mt-1 block text-xs text-neutral-500 dark:text-neutral-400">Допомагає оцінювати пошук, фільтри, перегляди та переходи до продавців. Не впливає на вхід, розрахунки або доступ до каталогу.</span></span>
      </label>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">Вибір зберігається на 180 днів лише в цьому браузері й для цього домену. Якщо сховище заблоковане, він діє до перезавантаження сторінки. Змінити вибір можна будь-коли в налаштуваннях кукі.</p>
      <NavLink to="/privacy" onClick={() => setSettingsOpen(false)} className="text-sm underline text-emerald-700 dark:text-emerald-400">Дані та приватність</NavLink>
    </Modal>
  </>;
};
