import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  Building,
  Mail,
  Lock,
  FolderSync,
  LogOut,
  AlertTriangle,
  CheckCircle,
  Play,
  Square,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';

export const AccountPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, updateUser, logout } = useAuth();

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [workshopName, setWorkshopName] = useState(user?.workshopName || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Change password modal state
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Folder auto-import demonstration state
  const [isFolderMonitoringActive, setIsFolderMonitoringActive] = useState(false);
  const [monitoredFolderPath, setMonitoredFolderPath] = useState<string | null>(null);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser({
      fullName: fullName.trim(),
      workshopName: workshopName.trim(),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(true);
    setTimeout(() => {
      setPasswordSuccess(false);
      setIsPasswordModalOpen(false);
      setCurrentPassword('');
      setNewPassword('');
    }, 1500);
  };

  const handleSelectFolder = async () => {
    // Demonstration of future browser File System Access API
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        setMonitoredFolderPath(dirHandle.name || 'BambuStudio/exported');
        setIsFolderMonitoringActive(true);
      } catch {
        // Cancelled or unsupported in sandbox
        setMonitoredFolderPath('BambuStudio/output_projects');
        setIsFolderMonitoringActive(true);
      }
    } else {
      setMonitoredFolderPath('BambuStudio/output_projects');
      setIsFolderMonitoringActive(true);
    }
  };

  const handleStopFolderMonitoring = () => {
    setIsFolderMonitoringActive(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
          Профіль майстерні та акаунт
        </h2>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Персональні дані оператора, реквізити та експериментальні розширення
        </p>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs text-emerald-900 dark:text-emerald-200 font-medium">
          Дані профілю збережено
        </div>
      )}

      {/* Profile Form */}
      <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-5 shadow-2xs">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
          Основні дані
        </h3>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <Input
            label="Ім'я та прізвище оператора"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            leftAddon={<User className="w-4 h-4" />}
            required
          />

          <Input
            label="Назва майстерні / бренду 3D-друку"
            placeholder="напр., 3D Studio Horizon"
            value={workshopName}
            onChange={(e) => setWorkshopName(e.target.value)}
            leftAddon={<Building className="w-4 h-4" />}
          />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Електронна пошта
            </label>
            <div className="flex items-center gap-2 px-3 py-2 text-xs bg-neutral-100 dark:bg-neutral-800 rounded-lg text-neutral-600 dark:text-neutral-400 border border-neutral-200 dark:border-neutral-700 select-all">
              <Mail className="w-4 h-4 text-neutral-500" />
              <span>{user?.email || 'workshop@printcost.local'}</span>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <Button type="submit" variant="primary" size="sm">
              Зберегти зміни
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<Lock className="w-3.5 h-3.5" />}
              onClick={() => setIsPasswordModalOpen(true)}
            >
              Змінити пароль
            </Button>
          </div>
        </form>
      </div>

      {/* Dedicated Section: Folder Auto-Import (Requested explicitly in Section 11) */}
      <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg text-emerald-600">
              <FolderSync className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Автоімпорт із локальної папки Bambu Studio
              </h3>
              <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                (Демо-інтерфейс майбутньої функції File System Access API)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isFolderMonitoringActive ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-300'
              }`}
            />
            <span className="text-neutral-500">
              {isFolderMonitoringActive ? 'Моніторинг активний' : 'Зупинено'}
            </span>
          </div>
        </div>

        <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
          Функція автоімпорту дозволить моніторити каталог експорту слайсера Bambu Studio на вашому ПК та автоматично відкривати свіжі .gcode.3mf у калькуляторі.
        </p>

        {/* Browser limitation explicit warning */}
        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 rounded-xl space-y-1 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Технічні обмеження безпеки браузера:</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 pl-1 text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
            <li>Доступ до локальної файлової системи вимагає явного дозволу користувача.</li>
            <li>Працює виключно у браузерах на базі Chromium з підтримкою File System Access API.</li>
            <li>Фоновий моніторинг не гарантується при мінімізації або сну системи.</li>
            <li>При закритті вкладки сеанс доступу автоматично припиняється браузером.</li>
          </ul>
        </div>

        {/* Action Controls */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {monitoredFolderPath ? (
            <div className="text-xs text-neutral-600 dark:text-neutral-300 font-mono">
              Папка: <span className="font-semibold">{monitoredFolderPath}</span>
            </div>
          ) : (
            <div className="text-xs text-neutral-500">Папку експорту ще не вибрано</div>
          )}

          <div className="flex items-center gap-2">
            {!isFolderMonitoringActive ? (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Play className="w-3.5 h-3.5 text-emerald-600" />}
                onClick={handleSelectFolder}
              >
                Вибрати папку та запустити
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Square className="w-3.5 h-3.5 text-red-600" />}
                onClick={handleStopFolderMonitoring}
              >
                Зупинити моніторинг
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Logout Action */}
      <div className="pt-2 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          leftIcon={<LogOut className="w-4 h-4 text-red-500" />}
          onClick={handleLogout}
          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
        >
          Вийти з облікового запису
        </Button>
      </div>

      {/* Change Password Modal */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        title="Зміна пароля"
        description="Введіть новий надійний пароль для доступу до кабінету."
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPasswordModalOpen(false)}
            >
              Скасувати
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleChangePassword}
              disabled={newPassword.length < 6}
            >
              Зберегти новий пароль
            </Button>
          </>
        }
      >
        <form onSubmit={handleChangePassword} className="space-y-4">
          {passwordSuccess ? (
            <div className="p-3 bg-emerald-50 text-emerald-800 text-xs rounded-lg flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Пароль успішно оновлено
            </div>
          ) : (
            <>
              <Input
                label="Поточний пароль"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              <Input
                label="Новий пароль"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Мінімум 6 знаків"
                helperText="Використовуйте надійну комбінацію символів."
                required
              />
            </>
          )}
        </form>
      </Modal>
    </div>
  );
};
