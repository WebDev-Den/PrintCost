import React, { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { ACCOUNT_DELETE_CONFIRMATION, type AccountDeletionProgress } from '../../domain/accountData.ts';
import { accountDataService, downloadAccountExport } from '../../services/accountDataService.ts';
import { authErrorMessage, authService } from '../../services/authService.ts';

const progressLabels: Record<AccountDeletionProgress['stage'], string> = {
  reauthenticate: 'Перевірка пароля…', revoke: 'Відкликання ролей і доступу…', cleanup: 'Очищення приватних даних…',
  identity: 'Видалення профілю та запису користувача…', auth: 'Видалення можливості входу…',
};

export const AccountDeletionPage: React.FC = () => {
  const { user, isLoading, isDemoSession, authError, reloadUser, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [progress, setProgress] = useState<AccountDeletionProgress | null>(null);
  const operationUid = useRef('');
  const operationRevision = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    setPassword(''); setConfirmation(''); setError(null); setProgress(null);
    if (user?.id && user.id !== operationUid.current) {
      ++operationRevision.current;
      operationUid.current = user.id;
      inFlight.current = false;
      setBusy(false); setExporting(false); setCompleted(false);
    }
  }, [user?.id]);

  const handleDelete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user || isDemoSession || inFlight.current) return;
    const uid = user.id;
    const enteredPassword = password;
    const enteredConfirmation = confirmation;
    setPassword('');
    setError(null);
    setBusy(true);
    inFlight.current = true;
    operationUid.current = uid;
    const revision = ++operationRevision.current;
    try {
      await accountDataService.deleteOwnAccount(uid, enteredPassword, enteredConfirmation, next => {
        if (operationUid.current === uid && operationRevision.current === revision && authService.getSessionIdentity() === uid) setProgress(next);
      });
      if (operationUid.current !== uid || operationRevision.current !== revision) return;
      if (!authService.getSessionIdentity()) setCompleted(true);
      else throw new Error('Акаунт змінився під час завершення операції.');
    } catch (error) {
      if (operationUid.current === uid && operationRevision.current === revision && authService.getSessionIdentity() === uid) {
        setError(authErrorMessage(error));
        try { await reloadUser(); } catch { /* Original operation error remains visible. */ }
      }
    } finally {
      if (operationUid.current === uid && operationRevision.current === revision && ['', uid].includes(authService.getSessionIdentity())) {
        setPassword(''); setBusy(false); inFlight.current = false;
      }
    }
  };

  const handleExport = async () => {
    if (!user || isDemoSession || busy || exporting) return;
    const uid = user.id;
    operationUid.current = uid;
    const revision = ++operationRevision.current;
    setExporting(true); setError(null);
    try {
      const data = await accountDataService.exportOwnData(uid);
      authService.assertSession(uid);
      if (operationUid.current !== uid || operationRevision.current !== revision) return;
      downloadAccountExport(data);
    } catch (error) {
      if (operationUid.current === uid && operationRevision.current === revision && authService.getSessionIdentity() === uid) setError(authErrorMessage(error));
    } finally {
      if (operationUid.current === uid && operationRevision.current === revision && ['', uid].includes(authService.getSessionIdentity())) setExporting(false);
    }
  };

  if (isLoading && !busy) return <div role="status" className="p-12 text-center">Завантаження акаунта…</div>;
  if (!user && !busy && !completed && !authError) return <Navigate to="/auth/login" state={{ from: { pathname: '/auth/delete-account' } }} replace />;
  return <div className="min-h-screen bg-neutral-100/70 dark:bg-neutral-950 flex items-center justify-center p-6">
    <div className="w-full max-w-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 space-y-5">
      <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">{completed ? 'Акаунт видалено' : user?.deletionPending ? 'Продовження видалення акаунта' : 'Видалення акаунта'}</h1>
      {completed ? <>
        <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">Усі приватні дані та можливість входу видалено. Пропозиції компаній і журнал адміністративних дій збережено.</p>
        <NavLink to="/" className="text-sm underline text-emerald-600">На головну</NavLink>
      </> : <>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">Акаунт: <strong>{user?.email}</strong>. Видалення незворотне: профіль, матеріали, принтери, усі розрахунки, шаблони, налаштування та вподобання буде видалено разом із можливістю входу.</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Пропозиції компаній, журнал дій, позначка видалення та мінімальні записи відкликаного доступу залишаться для цілісності системи. Останній адміністратор має спочатку призначити іншого адміністратора.</p>
        {user?.deletionPending && <p role="status" className="rounded-lg bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">Видалення вже розпочато. Доступ і ролі відкликано, частина даних могла бути очищена. Підтвердьте пароль і продовжте; повернути очищені дані неможливо.</p>}
        {isDemoSession ? <p className="text-sm text-neutral-600">Видалення в деморежимі недоступне.</p> : <>
          <Button variant="outline" size="sm" onClick={handleExport} isLoading={exporting} disabled={busy || !user || (user.isBlocked && !user.deletionPending) || (!user.emailVerified && !user.deletionPending)}>{user?.deletionPending ? 'Експортувати дані, що залишилися' : 'Спочатку експортувати всі власні дані'}</Button>
          <form onSubmit={handleDelete} className="space-y-4">
            <Input label="Поточний пароль" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={busy || exporting} />
            <Input label={`Для підтвердження введіть ${ACCOUNT_DELETE_CONFIRMATION}`} value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" required disabled={busy || exporting} />
            <Button variant="danger" type="submit" size="sm" isLoading={busy} disabled={!user || exporting || !password || confirmation !== ACCOUNT_DELETE_CONFIRMATION}>{user?.deletionPending ? 'Продовжити незворотне видалення' : 'Назавжди видалити акаунт'}</Button>
          </form>
        </>}
        {progress && <p role="status" className="text-sm text-neutral-600 dark:text-neutral-400">{busy ? progressLabels[progress.stage] : 'Операцію зупинено.'} {progress.deletedDocuments > 0 && `Очищено записів за цю спробу: ${progress.deletedDocuments}.`}</p>}
        {(error || authError) && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error || authError}</p>}
        {authError && !busy && <Button variant="outline" size="sm" onClick={() => { void reloadUser().catch(error => setError(authErrorMessage(error))); }}>Повторити завантаження</Button>}
        {!busy && <div className="flex flex-wrap gap-4 text-sm">
          {!user?.deletionPending && <NavLink className="underline text-emerald-600" to={isDemoSession ? '/app/account' : user?.emailVerified ? '/app/account' : '/auth/check-email'}>Повернутися</NavLink>}
          <button className="underline text-neutral-600 dark:text-neutral-400" onClick={() => { void logout().catch(error => setError(authErrorMessage(error))); }}>Вийти з акаунта</button>
        </div>}
      </>}
    </div>
  </div>;
};
