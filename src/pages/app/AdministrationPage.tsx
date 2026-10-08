import React, { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import type { AccessAudit, AccessState, Company, DirectoryUser, Role } from '../../domain/organizations.ts';
import { organizationRepository } from '../../services/organizationRepository.ts';
import { authErrorMessage, authService } from '../../services/authService.ts';

const roleLabels: Record<Role, string> = { user: 'Користувач', manager: 'Менеджер', admin: 'Адміністратор' };
const actionLabels: Record<AccessAudit['action'], string> = { bootstrap: 'Перший адміністратор', role: 'Зміна ролі', block: 'Зміна блокування', company: 'Зміна компанії' };
const selectClass = 'w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white disabled:opacity-50';
const panelClass = 'p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-4';

export const AdministrationPage: React.FC = () => {
  const { user, isDemoSession } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [access, setAccess] = useState<Record<string, AccessState>>({});
  const [companies, setCompanies] = useState<Company[]>([]);
  const [audit, setAudit] = useState<AccessAudit[]>([]);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [selectedUid, setSelectedUid] = useState('');
  const [role, selectRole] = useState<Role>('user');
  const [companyId, selectCompany] = useState('');
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [website, setWebsite] = useState('');
  const [domains, setDomains] = useState('');
  const [companyStatus, setCompanyStatus] = useState<Company['status']>('active');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const request = useRef(0);

  const load = async (more = false) => {
    const version = ++request.current;
    const identity = user?.id || '';
    setLoading(true); setError(null);
    try {
      const [page, loadedCompanies, loadedAudit] = await Promise.all([
        organizationRepository.listUsers(more && cursor ? cursor : undefined), organizationRepository.listCompanies(), organizationRepository.listAudit(),
      ]);
      const states = await Promise.all(page.items.map(async item => [item.uid, await organizationRepository.getAccess(item.uid)] as const));
      authService.assertSession(identity);
      if (version !== request.current) return;
      setUsers(previous => more ? [...previous, ...page.items.filter(item => !previous.some(existing => existing.uid === item.uid))] : page.items);
      setAccess(previous => more ? { ...previous, ...Object.fromEntries(states) } : Object.fromEntries(states));
      setCompanies(loadedCompanies); setAudit(loadedAudit); setCursor(page.cursor);
      if (!more) setSelectedUid(previous => page.items.some(item => item.uid === previous) ? previous : page.items[0]?.uid || '');
    } catch (error) {
      if (version === request.current) setError(authErrorMessage(error));
    } finally { if (version === request.current) setLoading(false); }
  };

  useEffect(() => {
    if (user?.role === 'admin' && !isDemoSession) void load();
    return () => { ++request.current; };
  }, [user?.id, user?.role, isDemoSession]);

  const selected = users.find(item => item.uid === selectedUid);
  const selectedAccess = access[selectedUid];
  useEffect(() => {
    selectRole(selectedAccess?.role || 'user');
    selectCompany(selectedAccess?.companyId || '');
  }, [selectedUid, selectedAccess?.role, selectedAccess?.companyId]);

  const perform = async (operation: () => Promise<void>, message: string) => {
    const identity = user?.id || '';
    setBusy(true); setError(null); setSuccess(null);
    try {
      await operation();
      authService.assertSession(identity);
      setSuccess(message);
      await load();
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setBusy(false); }
  };

  const editCompany = (company: Company | null) => {
    setEditingCompany(company);
    setCompanyName(company?.name || ''); setWebsite(company?.website || '');
    setDomains(company?.allowedDomains.join('\n') || ''); setCompanyStatus(company?.status || 'active');
  };

  const submitCompany = (event: React.FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const saved = await organizationRepository.saveCompany({ ...(editingCompany ? { id: editingCompany.id, version: editingCompany.version } : {}),
        name: companyName, website, allowedDomains: domains.split(/[\n,]/).map(value => value.trim()).filter(Boolean), status: companyStatus });
      editCompany(saved);
    }, 'Компанію збережено.');
  };

  if (isDemoSession || user?.role !== 'admin' || user.isBlocked) return <Navigate to="/app/dashboard" replace />;
  const term = search.trim().toLocaleLowerCase('uk');
  const visibleUsers = users.filter(item => `${item.email} ${item.displayName} ${item.uid}`.toLocaleLowerCase('uk').includes(term));
  const companyNames = new Map(companies.map(company => [company.id, company.name]));

  return <div className="max-w-6xl space-y-6 text-neutral-900 dark:text-white">
    <div className="flex flex-wrap justify-between gap-3 items-start">
      <div><h2 className="text-xl font-bold">Користувачі та компанії</h2><p className="text-xs text-neutral-500 mt-1">Призначення ролей, доступ компаній та журнал адміністративних змін.</p></div>
      <Button variant="outline" size="sm" onClick={() => { setSuccess(null); void load(); }} disabled={loading || busy}>Оновити дані</Button>
    </div>
    {error && <p role="alert" className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {success && <p role="status" className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}
    {loading && <p role="status" className="text-sm text-neutral-500">Завантаження…</p>}

    <section className={panelClass} aria-labelledby="users-title">
      <h3 id="users-title" className="font-semibold">Користувачі</h3>
      <Input id="admin-user-search" label="Пошук за поштою, ім’ям або ID" value={search} onChange={event => setSearch(event.target.value)} helperText={`Пошук серед ${users.length} завантажених користувачів. Наступні записи можна завантажити кнопкою нижче.`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-neutral-500"><tr><th className="p-2">Користувач</th><th className="p-2">Роль / компанія</th><th className="p-2">Стан</th><th className="p-2">Дія</th></tr></thead>
          <tbody>{visibleUsers.map(item => <tr key={item.uid} className="border-t border-neutral-100 dark:border-neutral-800">
            <td className="p-2"><p>{item.email}</p><p className="text-xs text-neutral-500">{item.displayName || item.uid}</p></td>
            <td className="p-2">{roleLabels[access[item.uid]?.role || 'user']}{access[item.uid]?.companyId && <p className="text-xs text-neutral-500">{companyNames.get(access[item.uid].companyId!) || access[item.uid].companyId}</p>}</td>
            <td className="p-2">{access[item.uid]?.blocked ? 'Заблоковано' : item.verified ? 'Активний' : 'Пошта не підтверджена'}</td>
            <td className="p-2"><Button variant={selectedUid === item.uid ? 'secondary' : 'outline'} size="sm" onClick={() => setSelectedUid(item.uid)} disabled={busy || loading}>Обрати</Button></td>
          </tr>)}</tbody>
        </table>
      </div>
      {!visibleUsers.length && !loading && <p className="text-sm text-neutral-500">Користувачів не знайдено серед завантажених записів.</p>}
      {cursor && <Button variant="outline" size="sm" onClick={() => { void load(true); }} disabled={busy || loading}>Завантажити ще</Button>}
      {selected && selectedAccess && <form className="border-t border-neutral-200 dark:border-neutral-800 pt-4 space-y-3" onSubmit={event => {
        event.preventDefault();
        void perform(() => organizationRepository.setRole(selected.uid, role, role === 'manager' ? companyId : undefined), 'Роль користувача оновлено.');
      }}>
        <p className="text-sm font-medium">Права для {selected.email}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-xs space-y-1.5"><span>Роль</span><select aria-label={`Роль для ${selected.email}`} className={selectClass} value={role} onChange={event => selectRole(event.target.value as Role)} disabled={busy || loading || selectedAccess.blocked || !selected.verified}>
            {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {role === 'manager' && <label className="text-xs space-y-1.5"><span>Компанія менеджера</span><select aria-label="Компанія менеджера" className={selectClass} value={companyId} onChange={event => selectCompany(event.target.value)} disabled={busy || loading} required>
            <option value="">Оберіть активну компанію</option>{companies.filter(company => company.status === 'active').map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
          </select></label>}
        </div>
        <p className="text-xs text-neutral-500">Менеджер працює лише з пропозиціями призначеної компанії. Блокування скасовує роль; після розблокування доступ відновлюється як у користувача.</p>
        {!selected.verified && <p className="text-xs text-amber-700 dark:text-amber-400">Спочатку користувач має підтвердити електронну пошту.</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" size="sm" isLoading={busy} disabled={loading || !selected.verified || selectedAccess.blocked || (role === 'manager' && !companyId)}>Зберегти роль</Button>
          <Button type="button" variant={selectedAccess.blocked ? 'outline' : 'danger'} size="sm" disabled={busy || loading} onClick={() => { void perform(() => organizationRepository.setBlocked(selected.uid, !selectedAccess.blocked), selectedAccess.blocked ? 'Користувача розблоковано.' : 'Користувача заблоковано.'); }}>{selectedAccess.blocked ? 'Розблокувати' : 'Заблокувати'}</Button>
        </div>
      </form>}
    </section>

    <section className={panelClass} aria-labelledby="companies-title">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="companies-title" className="font-semibold">Компанії</h3><Button variant="outline" size="sm" onClick={() => editCompany(null)} disabled={busy}>Нова компанія</Button></div>
      <div className="flex flex-wrap gap-2">{companies.map(company => <Button key={company.id} variant={editingCompany?.id === company.id ? 'secondary' : 'outline'} size="sm" onClick={() => editCompany(company)} disabled={busy}>{company.name}{company.status === 'disabled' ? ' · призупинено' : ''}</Button>)}</div>
      <form className="space-y-3" onSubmit={submitCompany}>
        <h4 className="text-sm font-medium">{editingCompany ? `Редагування: ${editingCompany.name}` : 'Створення компанії'}</h4>
        <div className="grid sm:grid-cols-2 gap-3">
          <Input id="admin-company-name" label="Назва компанії" value={companyName} onChange={event => setCompanyName(event.target.value)} maxLength={200} required disabled={busy} />
          <Input id="admin-company-website" label="Сайт компанії (HTTPS)" type="url" value={website} onChange={event => setWebsite(event.target.value)} placeholder="https://example.com" disabled={busy} required />
        </div>
        <label className="block text-xs space-y-1.5"><span>Дозволені домени посилань на пропозиції</span><textarea id="admin-company-domains" className={`${selectClass} min-h-20`} value={domains} onChange={event => setDomains(event.target.value)} placeholder={'example.com\nshop.example.com'} maxLength={2000} disabled={busy} /><span className="block text-neutral-500">Один домен на рядок, без протоколу та шляху. Вкажіть усі магазини, посилання яких може додавати менеджер.</span></label>
        <label className="block text-xs space-y-1.5"><span>Стан компанії</span><select aria-label="Стан компанії" className={selectClass} value={companyStatus} onChange={event => setCompanyStatus(event.target.value as Company['status'])} disabled={busy}><option value="active">Активна</option><option value="disabled">Призупинена</option></select></label>
        <p className="text-xs text-neutral-500">Після призупинення компанії її менеджери втрачають можливість публікувати пропозиції.</p>
        <Button type="submit" size="sm" isLoading={busy} disabled={loading}>{editingCompany ? 'Зберегти компанію' : 'Створити компанію'}</Button>
      </form>
    </section>

    <section className={panelClass} aria-labelledby="audit-title">
      <h3 id="audit-title" className="font-semibold">Журнал змін доступу</h3>
      <p className="text-xs text-neutral-500">Останні 100 подій. Записи створюються разом зі зміною прав і не редагуються.</p>
      <div className="overflow-x-auto"><table className="w-full text-xs text-left">
        <thead className="text-neutral-500"><tr><th className="p-2">Час</th><th className="p-2">Дія</th><th className="p-2">Хто змінив</th><th className="p-2">Кого / що</th><th className="p-2">Результат</th></tr></thead>
        <tbody>{audit.map((event, index) => <tr key={`${event.createdAt}-${event.registryVersion}-${index}`} className="border-t border-neutral-100 dark:border-neutral-800">
          <td className="p-2 whitespace-nowrap">{event.createdAt.toDate().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' })}</td><td className="p-2">{actionLabels[event.action]}</td>
          <td className="p-2 break-all">{users.find(item => item.uid === event.actorUid)?.email || event.actorUid}</td><td className="p-2 break-all">{event.action === 'company' ? companyNames.get(event.companyId || event.targetUid) || event.companyId || event.targetUid : users.find(item => item.uid === event.targetUid)?.email || event.targetUid}</td>
          <td className="p-2">{event.action === 'company' ? 'Дані компанії оновлено' : <>{event.role ? roleLabels[event.role] : ''}{event.companyId ? ` · ${companyNames.get(event.companyId) || event.companyId}` : ''}{typeof event.blocked === 'boolean' ? event.blocked ? ' · заблоковано' : ' · активний' : ''}</>}</td>
        </tr>)}</tbody>
      </table></div>
      {!audit.length && !loading && <p className="text-sm text-neutral-500">Записів ще немає.</p>}
    </section>
  </div>;
};
