import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Copy, KeyRound, RefreshCw, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { authErrorMessage, authService, reauthenticateAccount } from '../../services/authService.ts';
import { firebaseAuth, getAppCheckHeaders } from '../../services/firebaseClient.ts';
import { createApiImportClient, type ApiKeyResponse } from '../../services/apiImportClient.ts';
import { IMPORT_EXAMPLE, IMPORT_LIMITS, type ImportJobSummary, type ImportStatus } from '../../domain/apiImports.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';

const statusNames: Record<ImportStatus, string> = { queued: 'У черзі', processing: 'Виконується', completed: 'Завершено', partial: 'Частково виконано', failed: 'Помилка', cancelled: 'Скасовано' };
const date = (value: string) => new Date(value).toLocaleString('uk-UA');
const panel = 'rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4';
const code = 'block overflow-x-auto rounded-xl bg-neutral-100 dark:bg-neutral-950 p-4 text-xs whitespace-pre-wrap break-words';

export function ApiPage() {
  const { user } = useAuth();
  const uid = user!.id;
  const identity = useRef(uid);
  identity.current = uid;
  const [metadata, setMetadata] = useState<ApiKeyResponse | null>(null);
  const [secret, setSecret] = useState('');
  const [jobs, setJobs] = useState<ImportJobSummary[]>([]);
  const [detail, setDetail] = useState<(ImportJobSummary & { error?: string }) | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const [action, setAction] = useState<'rotate' | 'revoke' | null>(null);
  const [password, setPassword] = useState('');
  const [confirmationMethod, setConfirmationMethod] = useState<'google.com' | 'password' | null>(null);
  const [jsonText, setJsonText] = useState(JSON.stringify(IMPORT_EXAMPLE, null, 2));
  const idempotency = useRef(crypto.randomUUID());
  const hasPassword = user?.authProviders?.includes('password') === true;
  const hasGoogle = user?.authProviders?.includes('google.com') === true;
  const method = confirmationMethod ?? (hasGoogle ? 'google.com' : 'password');
  const api = useMemo(() => {
    const assertCurrent = () => { authService.assertSession(uid); if (identity.current !== uid) throw new Error('Акаунт змінився.'); };
    return createApiImportClient(async () => {
      const current = firebaseAuth?.currentUser;
      if (current?.uid !== uid) throw new Error('Увійдіть повторно.');
      return current.getIdToken(true);
    }, assertCurrent, fetch, getAppCheckHeaders);
  }, [uid]);
  useEffect(() => {
    let active = true;
    identity.current = uid;
    setBusy(true); setError(''); setNotice('');
    setSecret(''); setMetadata(null); setJobs([]); setDetail(null); setPassword(''); setAction(null); setConfirmationMethod(null);
    // Serialize these reads to avoid duplicate cold OAuth exchanges on Workers Free.
    void (async () => {
      const data = await api.metadata();
      if (!active) return;
      const history = await api.jobs();
      if (active) { setMetadata(data); setJobs(history.jobs); }
    })().catch(error => { if (active) setError(authErrorMessage(error)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; identity.current = ''; };
  }, [api]);
  async function run(operation: () => Promise<void>) {
    if (busy) return;
    const currentUid = uid;
    setBusy(true); setError(''); setNotice('');
    try { await operation(); }
    catch (error) { if (identity.current === currentUid) setError(authErrorMessage(error)); }
    finally { if (identity.current === currentUid) setBusy(false); }
  }
  async function refresh() {
    const data = await api.metadata();
    const history = await api.jobs();
    setMetadata(data); setJobs(history.jobs);
  }
  const base = window.location.origin + '/api/v1';
  return <div className="w-full space-y-6 text-neutral-900 dark:text-neutral-100">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">API та імпорт пропозицій</h1><p className="mt-1 text-sm text-neutral-500">Оновлюйте каталог зі свого програмного забезпечення.</p></div>
      <Button variant="outline" disabled={busy} leftIcon={<RefreshCw size={15} />} onClick={() => void run(refresh)}>Оновити стан</Button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 dark:bg-red-950/40 p-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm">{notice}</p>}
    <section className={panel}>
      <h2 className="flex items-center gap-2 font-semibold"><KeyRound size={18} />Особистий API-ключ</h2>
      <p className="text-sm text-neutral-500">Ключ діє 90 днів. Зберігайте його у своєму програмному забезпеченні. Повне значення показується один раз.</p>
      {metadata?.key ? <p className="text-sm"><code>{metadata.key.prefix}…</code> · до {date(metadata.key.expiresAt)}{metadata.key.requiresRotation && <strong className="ml-2 text-amber-600">Потрібно оновити</strong>}</p> : <p className="text-sm">{metadata ? 'Ключ ще не створено.' : error ? 'Дані ключа недоступні.' : 'Завантажуємо параметри API…'}</p>}
      {metadata?.companyId && <p className="text-sm">Ваша компанія: <code>{metadata.companyId}</code>. Дозволені лише її затверджені домени.</p>}
      {secret && <div className="space-y-2">
        <label htmlFor="api-secret" className="text-sm font-medium">Новий ключ — скопіюйте перед закриттям сторінки</label>
        <div className="flex flex-wrap gap-2"><input id="api-secret" readOnly value={secret} className="min-w-0 flex-1 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent p-3 font-mono text-xs" autoComplete="off" />
          <Button variant="outline" leftIcon={<Copy size={15} />} onClick={() => void run(async () => { await navigator.clipboard.writeText(secret); setNotice('Ключ скопійовано.'); })}>Копіювати</Button>
          <Button variant="ghost" onClick={() => setSecret('')}>Приховати</Button></div>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !metadata} onClick={() => { setAction('rotate'); setPassword(''); setConfirmationMethod(null); }}>{metadata?.key ? 'Оновити ключ' : 'Створити ключ'}</Button>
        {metadata?.key && <Button variant="danger" disabled={busy} onClick={() => { setAction('revoke'); setPassword(''); setConfirmationMethod(null); }}>Відкликати ключ</Button>}
      </div>
      <p className="text-xs text-neutral-500">Оновлення або відкликання ключа скасовує незавершені імпорти. Уже розпочата порція до 5 записів може завершитися. Зміна ролі, компанії чи блокування потребує нового ключа.</p>
    </section>
    <section className={panel}>
      <h2 className="font-semibold">Імпорт JSON</h2>
      <p className="text-sm">Імпортовані товари та оновлення зберігаються як чернетки. Перевірте їх і опублікуйте обрані у <NavLink to="/app/admin/catalog" className="text-emerald-600 underline">адмінці каталогу</NavLink>.</p>
      <p className="text-sm text-neutral-500">Після додавання черга перевірить усі записи. Якщо поля некоректні, імпорт завершиться помилкою без запису товарів; причину дивіться у результаті.</p>
      <p className="text-sm text-neutral-500">До {IMPORT_LIMITS.items} записів та {IMPORT_LIMITS.bytes / 1024} КіБ за запит. Більші файли розділіть на менші порції. Менеджер — раз на годину, адміністратор — раз на 5 хвилин. Один активний імпорт на акаунт.</p>
      {metadata?.nextImportAt && new Date(metadata.nextImportAt).getTime() > Date.now() && <p className="text-sm">Наступний імпорт: {date(metadata.nextImportAt)}</p>}
      <label htmlFor="api-json-file" className="block text-sm font-medium">Завантажити файл JSON</label>
      <input id="api-json-file" type="file" accept=".json,application/json" disabled={busy} className="block max-w-full text-sm" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        void run(async () => { if (file.size > IMPORT_LIMITS.bytes) throw new Error(`Файл перевищує ${IMPORT_LIMITS.bytes / 1024} КіБ. Розділіть його на менші порції.`); const value = await file.text(); JSON.parse(value); setJsonText(value); idempotency.current = crypto.randomUUID(); });
      }} />
      <label htmlFor="api-json" className="block text-sm font-medium">Вміст JSON</label>
      <textarea id="api-json" rows={12} spellCheck={false} value={jsonText} className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent p-3 font-mono text-xs" disabled={busy}
        onChange={event => { setJsonText(event.target.value); idempotency.current = crypto.randomUUID(); }} />
      <Button leftIcon={<Upload size={15} />} disabled={busy || !metadata?.key || metadata.key.requiresRotation} onClick={() => void run(async () => {
        if (new TextEncoder().encode(jsonText).length > IMPORT_LIMITS.bytes) throw new Error(`JSON перевищує ${IMPORT_LIMITS.bytes / 1024} КіБ. Розділіть його на менші порції.`);
        const result = await api.submit(JSON.parse(jsonText), idempotency.current);
        setNotice('Імпорт додано до черги: ' + result.id + '. Оновіть стан для перевірки результату.');
        await refresh();
      })}>Додати до черги</Button>
    </section>
    <section className={panel}>
      <h2 className="font-semibold">Останні імпорти</h2>
      {!jobs.length ? <p className="text-sm text-neutral-500">Імпортів ще немає.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-neutral-200 dark:border-neutral-800">
        <th className="p-2">Дата та ID</th><th className="p-2">Стан</th><th className="p-2">Оброблено</th><th className="p-2">Успіх / помилки</th><th className="p-2">Дія</th></tr></thead><tbody>
        {jobs.map(job => <tr key={job.id} className="border-b border-neutral-200 dark:border-neutral-800"><td className="p-2">{date(job.createdAt)}<code className="mt-1 block text-xs">{job.id}</code></td><td className="p-2">{statusNames[job.status]}</td>
          <td className="p-2">{job.processed} / {job.total}</td><td className="p-2">{job.succeeded} / {job.failed}</td><td className="p-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(async () => setDetail(await api.job(job.id)))}>Результат</Button></td></tr>)}
      </tbody></table></div>}
      {detail && <div className="space-y-2"><h3 className="text-sm font-medium">{statusNames[detail.status]} · {detail.id}</h3>{detail.error && <p role="alert" className="text-sm text-red-600">{detail.error}</p>}
        <pre className={code}>{JSON.stringify(detail.results, null, 2)}</pre><Button variant="ghost" onClick={() => setDetail(null)}>Закрити результат</Button></div>}
    </section>
    <section className={panel}>
      <h2 className="font-semibold">Як використовувати API</h2>
      <p className="text-sm">Адреса: <code className="break-all">{base}</code>. Передавайте ключ лише в <code>Authorization: Bearer ВАШ_КЛЮЧ</code>.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><tbody>
        <tr><th className="p-2 font-mono">POST /imports</th><td className="p-2">Прийняти JSON у чергу, відповідь 202 з ID. Обов’язковий Idempotency-Key. Перевірку записів і результат дивіться у стані імпорту.</td></tr>
        <tr><th className="p-2 font-mono">GET /imports</th><td className="p-2">Останні 30 імпортів. Адміністратор бачить усі, менеджер — власні.</td></tr>
        <tr><th className="p-2 font-mono">GET /imports/ID</th><td className="p-2">Стан і результат кожного запису.</td></tr>
      </tbody></table></div>
      <pre className={code}>{`curl -X POST "${base}/imports" \\\n  -H "Authorization: Bearer $KILOG_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: batch-2026-10-09-001" \\\n  --data-binary @offers.json`}</pre>
      <p className="text-sm">У JSON передавайте <code>offers</code>. Обов’язкові поля позиції: externalId, name, brand, type, colorName, colorHex, spoolWeightGrams, priceUah, productUrl, inStock. <code>externalId</code> має залишатися сталим у вашій системі: повторний імпорт оновить позицію цієї компанії. Пропущені позиції не видаляються.</p>
      <pre className={code}>{JSON.stringify(IMPORT_EXAMPLE, null, 2)}</pre>
      <p className="text-sm">priceUah — ціна упаковки у гривнях, spoolWeightGrams — її вага у грамах. Додаткові поля: companyId, family, colorTone, packagingType (spool / refill), diameterMm, description, status (hidden; blocked — лише адміністратор). Значення published також імпортується як чернетка; після кожного імпорту товар потрібно опублікувати в адмінці. Блокування адміністратором зберігається. При оновленні інші пропущені необов’язкові поля зберігаються. Тип нормалізується до великих літер, температурний профіль підбирається з каталогу. Якщо профілю немає, вкажіть family: Стандартні, Інженерні, Гнучкі, Композитні або Підтримки.</p>
      <p className="text-sm">Менеджер імпортує лише свою активну компанію та її точні дозволені домени. WWW і піддомени додаються адміністратором окремо.</p>
      {user?.role === 'admin' && <>
        <p className="text-sm">Адміністратор також передає масив <code>companies</code>. Компанію визначає companyId або точний домен website/productUrl. Якщо її немає, створюється компанія з назвою домену. Її дані можна доповнити у вкладці «Користувачі та компанії». Для неоднозначного домену обов’язковий companyId.</p>
        <pre className={code}>{JSON.stringify({ companies: [{ name: 'Магазин пластику', website: 'https://shop.example.com/', allowedDomains: ['shop.example.com'], status: 'active' }] }, null, 2)}</pre>
      </>}
      <p className="text-sm">Для повторної спроби використовуйте той самий Idempotency-Key та незмінний JSON, включно з пробілами й порядком полів. Для нового оновлення — новий ключ запиту. Після 429 дотримуйтесь Retry-After; після 202 перевіряйте стан не частіше ніж раз на 30 секунд і зупиніть перевірки після завершення.</p>
      <p className="text-sm">Стани: queued, processing, completed, partial, failed, cancelled. 401 — ключ недійсний; 403 — бракує прав; 409 — конфлікт Idempotency-Key; 413 — завеликий JSON; 422 — некоректна структура запиту; 429 — ліміт; 503 — сервіс тимчасово недоступний. Помилка полів після прийняття до черги відображається у результаті як HTTP_422 і не повторюється автоматично. Прийняті імпорти, зокрема з помилкою, витрачають інтервал та денну квоту. У разі часткового імпорту перегляньте результати перед повторним надсиланням.</p>
      <p className="text-xs text-neutral-500">Спільні ліміти API за добу UTC: {IMPORT_LIMITS.dailyItems.toLocaleString('uk-UA')} записів, {IMPORT_LIMITS.dailyJobs} імпортів і {IMPORT_LIMITS.dailyQueueMessages} відправлень у чергу. Для перевірок доступу виділено окремо 500 запитів менеджерам і 500 адміністраторам; на один акаунт — до 200 для менеджера й 500 для адміністратора з ключем. При вичерпанні ліміту черги завдання зберігається до наступної доби. Черга обробляє по 5 записів послідовно, повторює тимчасові помилки до 3 разів і зупиняє незавершений імпорт через 24 години. Історія зберігається 30 днів.</p>
    </section>
    <Modal isOpen={!!action} onClose={() => { if (!busy) { setAction(null); setPassword(''); setConfirmationMethod(null); } }} title={action === 'revoke' ? 'Відкликати API-ключ' : metadata?.key ? 'Оновити API-ключ' : 'Створити API-ключ'}
      description="Підтвердьте вхід. Попередній ключ і незавершені імпорти будуть скасовані.">
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void run(async () => {
        const current = firebaseAuth?.currentUser;
        if (!current || current.uid !== uid) throw new Error('Увійдіть повторно.');
        await reauthenticateAccount(current, password, method);
        authService.assertSession(uid);
        if (action === 'revoke') { await api.revoke(); setSecret(''); setNotice('Ключ відкликано.'); }
        else { const result = await api.rotate(); setSecret(result.key); setNotice('Новий ключ створено. Збережіть його зараз.'); }
        setAction(null); setPassword(''); setConfirmationMethod(null); await refresh();
      }); }}>
        {hasGoogle && hasPassword && <div className="space-y-2">
          <label htmlFor="api-confirmation-method" className="block text-sm font-medium">Спосіб підтвердження</label>
          <select id="api-confirmation-method" value={method} disabled={busy} className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent p-3 text-sm"
            onChange={event => { setConfirmationMethod(event.target.value === 'google.com' ? 'google.com' : 'password'); setPassword(''); setError(''); }}>
            <option value="google.com">Google</option><option value="password">Пароль облікового запису</option>
          </select>
        </div>}
        {method === 'password' ? <Input label="Поточний пароль" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /> : <p className="text-sm">Підтвердьте свій акаунт у вікні Google. Пароль сайту не потрібний.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" isLoading={busy} variant={action === 'revoke' ? 'danger' : 'primary'}>Підтвердити {method === 'google.com' ? 'через Google' : 'паролем'}</Button>
      </form>
    </Modal>
  </div>;
}
