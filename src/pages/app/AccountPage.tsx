import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { User, Building, Mail, Lock, FolderSync, LogOut, CheckCircle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { authService, authErrorMessage } from '../../services/authService.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';

export const AccountPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser, logout, isDemoSession } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [workshopName, setWorkshopName] = useState(user?.workshopName || '');
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedSuccess(false);
    setIsSaving(true);
    try {
      await updateUser({ fullName: fullName.trim(), workshopName: workshopName.trim() });
      setSavedSuccess(true);
    } catch (error) { setError(authErrorMessage(error)); }
    finally { setIsSaving(false); }
  };

  const closePasswordModal = () => {
    if (isChangingPassword) return;
    setIsPasswordModalOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setPasswordError(null);
    setPasswordSuccess(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setIsChangingPassword(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPasswordSuccess(true);
    } catch (error) { setPasswordError(authErrorMessage(error)); }
    finally { setIsChangingPassword(false); }
  };

  const handleLogout = async () => {
    setError(null);
    try { await logout(); navigate('/'); }
    catch (error) { setError(authErrorMessage(error)); }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">Профіль майстерні та акаунт</h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">Персональні дані оператора та реквізити майстерні</p>
      </div>
      {error && <p role="alert" className="p-3 bg-red-50 dark:bg-red-950/40 rounded-xl text-xs text-red-700 dark:text-red-300">{error}</p>}
      {savedSuccess && <p role="status" className="p-3 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl text-xs text-emerald-900 dark:text-emerald-200">Дані профілю збережено{isDemoSession ? ' у деморежимі цього браузера' : ''}</p>}

      <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-5 shadow-2xs">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Основні дані</h3>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input label="Ім'я та прізвище оператора" value={fullName} onChange={e => { setFullName(e.target.value); setSavedSuccess(false); }} maxLength={200} leftAddon={<User className="w-4 h-4" />} required />
          <Input label="Назва майстерні / бренду 3D-друку" placeholder="напр., 3D Studio Horizon" value={workshopName} onChange={e => { setWorkshopName(e.target.value); setSavedSuccess(false); }} maxLength={200} leftAddon={<Building className="w-4 h-4" />} />
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Електронна пошта</p>
            <div className="flex items-center gap-2 px-3 py-2 text-xs bg-neutral-100 dark:bg-neutral-800 rounded-lg text-neutral-600 dark:text-neutral-400 select-all"><Mail className="w-4 h-4" /><span>{user?.email}</span></div>
            {!isDemoSession && (user?.emailVerified ? <p className="text-xs text-emerald-600">Пошту підтверджено</p> : <NavLink to="/auth/check-email" className="text-xs text-amber-700 dark:text-amber-400 underline">Пошта ще не підтверджена — надіслати лист</NavLink>)}
          </div>
          <div className="pt-2 flex flex-wrap gap-3 items-center justify-between">
            <Button type="submit" variant="primary" size="sm" isLoading={isSaving}>Зберегти зміни</Button>
            <Button type="button" variant="outline" size="sm" leftIcon={<Lock className="w-3.5 h-3.5" />} onClick={() => setIsPasswordModalOpen(true)} disabled={isDemoSession}>Змінити пароль</Button>
          </div>
          {isDemoSession && <p className="text-xs text-neutral-500">Зміна пароля доступна після реєстрації власного акаунта.</p>}
        </form>
      </div>

      <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-3 shadow-2xs">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white"><FolderSync className="w-5 h-5 text-emerald-600" />Імпорт файлів Bambu Studio</h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">Збережіть нарізаний файл .gcode.3mf у слайсері й завантажте його в калькуляторі. Автоматичний моніторинг локальної папки в цій версії ще не реалізовано.</p>
        <NavLink to="/app/calculator" className="inline-block"><Button variant="outline" size="sm">Відкрити калькулятор</Button></NavLink>
      </div>

      <div className="pt-2 flex justify-end"><Button variant="outline" size="sm" leftIcon={<LogOut className="w-4 h-4 text-red-500" />} onClick={handleLogout}>Вийти з облікового запису</Button></div>

      <Modal isOpen={isPasswordModalOpen} onClose={closePasswordModal} title="Зміна пароля" description="Підтвердьте поточний пароль і введіть новий."
        footer={<>
          <Button variant="outline" size="sm" onClick={closePasswordModal} disabled={isChangingPassword}>{passwordSuccess ? 'Закрити' : 'Скасувати'}</Button>
          {!passwordSuccess && <Button type="submit" form="account-change-password" variant="primary" size="sm" isLoading={isChangingPassword} disabled={!currentPassword || newPassword.length < 6}>Зберегти новий пароль</Button>}
        </>}>
        {passwordSuccess ? <p role="status" className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg flex items-center gap-2"><CheckCircle className="w-4 h-4" />Пароль успішно оновлено</p> :
          <form id="account-change-password" onSubmit={handleChangePassword} className="space-y-4">
            {passwordError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{passwordError}</p>}
            <Input label="Поточний пароль" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
            <Input label="Новий пароль" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={6} placeholder="Мінімум 6 знаків" required />
          </form>}
      </Modal>
    </div>
  );
};
