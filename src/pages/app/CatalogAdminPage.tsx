import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Building2,
  Layers,
  Thermometer,
  Plus,
  Edit2,
  Trash2,
  Save,
  RotateCcw,
  Check,
  ExternalLink,
  Flame,
  Globe,
  Coins,
  CheckCircle2,
  XCircle,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import {
  PublicFilamentItem,
  ManufacturerBrand,
  TemperatureProfile,
  ColorTone,
  COLOR_TONES_CONFIG,
} from '../../domain/filamentsDirectory.ts';
import { catalogAdminRepository } from '../../services/catalogAdminRepository.ts';
import { formatUah } from '../../domain/formatters.ts';

export const CatalogAdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'filaments' | 'manufacturers' | 'temperatures'>('filaments');

  // Loaded data
  const [filaments, setFilaments] = useState<PublicFilamentItem[]>([]);
  const [manufacturers, setManufacturers] = useState<ManufacturerBrand[]>([]);
  const [temperatures, setTemperatures] = useState<Record<string, TemperatureProfile>>({});

  const [notification, setNotification] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionText?: string;
    onConfirm: () => void;
  } | null>(null);

  // Filament modal & editing state
  const [isFilamentModalOpen, setIsFilamentModalOpen] = useState(false);
  const [editingFilament, setEditingFilament] = useState<PublicFilamentItem | null>(null);
  const [filamentForm, setFilamentForm] = useState<Partial<PublicFilamentItem>>({
    name: '',
    brand: '',
    manufacturerId: '',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 600,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    densityGPerCm3: 1.24,
    description: '',
    badge: '',
    printTempNozzle: '',
    printTempBed: '',
    popularColors: [{ name: 'Чорний', hex: '#111827', colorTone: 'black' }],
    stores: [{ storeName: 'Офіційний магазин', url: 'https://example.com', priceUah: 600, inStock: true }],
  });

  // Manufacturer modal & editing state
  const [isManufacturerModalOpen, setIsManufacturerModalOpen] = useState(false);
  const [editingManufacturer, setEditingManufacturer] = useState<ManufacturerBrand | null>(null);
  const [manufacturerForm, setManufacturerForm] = useState<Partial<ManufacturerBrand>>({
    name: '',
    country: 'Україна 🇺🇦',
    website: 'https://',
    logoText: 'BRAND',
    logoBg: 'bg-emerald-600',
    logoTextColor: 'text-white',
    description: '',
  });

  // Temperature profile modal & editing state
  const [isTempModalOpen, setIsTempModalOpen] = useState(false);
  const [editingTempType, setEditingTempType] = useState<string | null>(null);
  const [tempForm, setTempForm] = useState<Partial<TemperatureProfile>>({
    plasticType: 'PLA',
    nozzleRange: '190–220 °C',
    bedRange: '50–60 °C',
    chamberRange: 'Кімнатна',
    fanSpeed: '100%',
    notes: '',
    enclosureRequired: false,
    dryingTempTime: '50 °C (4 год)',
  });

  // Load from repository
  const reloadData = () => {
    setFilaments(catalogAdminRepository.getFilaments());
    setManufacturers(catalogAdminRepository.getManufacturers());
    setTemperatures(catalogAdminRepository.getTemperatureProfiles());
  };

  useEffect(() => {
    reloadData();
  }, []);

  const notify = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // --- FILAMENT ACTIONS ---
  const handleOpenAddFilament = () => {
    setFormError(null);
    setEditingFilament(null);
    setFilamentForm({
      name: '',
      brand: manufacturers[0]?.name || 'Plexiwire',
      manufacturerId: manufacturers[0]?.id || 'plexiwire',
      type: 'PLA',
      family: 'Стандартні',
      approxPricePerKgUah: 600,
      spoolWeightGrams: 1000,
      diameterMm: 1.75,
      inStock: true,
      stockStatusLabel: 'В наявності',
      primaryColorTone: 'black',
      densityGPerCm3: 1.24,
      description: '',
      badge: '',
      printTempNozzle: '',
      printTempBed: '',
      popularColors: [{ name: 'Чорний', hex: '#111827', colorTone: 'black' }],
      stores: [{ storeName: 'Магазин UA', url: 'https://', priceUah: 600, inStock: true }],
    });
    setIsFilamentModalOpen(true);
  };

  const handleOpenEditFilament = (item: PublicFilamentItem) => {
    setFormError(null);
    setEditingFilament(item);
    setFilamentForm({ ...item });
    setIsFilamentModalOpen(true);
  };

  const handleSaveFilament = () => {
    if (!filamentForm.name || !filamentForm.type) {
      setFormError('Будь ласка, заповніть назву та тип пластику');
      return;
    }

    if (editingFilament) {
      catalogAdminRepository.updateFilament(editingFilament.id, filamentForm as any);
      notify(`Філамент "${filamentForm.name}" успішно оновлено`);
    } else {
      catalogAdminRepository.createFilament(filamentForm as any);
      notify(`Новий філамент "${filamentForm.name}" додано до каталогу`);
    }

    setIsFilamentModalOpen(false);
    reloadData();
  };

  const handleDeleteFilament = (id: string, name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Видалити філамент?',
      message: `Ви впевнені, що хочете видалити позицію "${name}" з каталогу?`,
      actionText: 'Видалити',
      onConfirm: () => {
        catalogAdminRepository.deleteFilament(id);
        notify(`Філамент "${name}" видалено`);
        reloadData();
        setConfirmDialog(null);
      },
    });
  };

  const handleToggleStockStatus = (item: PublicFilamentItem) => {
    const nextStatus = !item.inStock;
    catalogAdminRepository.updateFilament(item.id, {
      inStock: nextStatus,
      stockStatusLabel: nextStatus ? 'В наявності' : 'Немає в наявності',
    });
    notify(`Статус для "${item.name}" змінено на: ${nextStatus ? 'В наявності' : 'Немає в наявності'}`);
    reloadData();
  };

  // --- MANUFACTURER ACTIONS ---
  const handleOpenAddManufacturer = () => {
    setFormError(null);
    setEditingManufacturer(null);
    setManufacturerForm({
      name: '',
      country: 'Україна 🇺🇦',
      website: 'https://',
      logoText: 'NEW',
      logoBg: 'bg-emerald-600',
      logoTextColor: 'text-white',
      description: '',
    });
    setIsManufacturerModalOpen(true);
  };

  const handleOpenEditManufacturer = (mfg: ManufacturerBrand) => {
    setFormError(null);
    setEditingManufacturer(mfg);
    setManufacturerForm({ ...mfg });
    setIsManufacturerModalOpen(true);
  };

  const handleSaveManufacturer = () => {
    if (!manufacturerForm.name) {
      setFormError('Вкажіть назву виробника');
      return;
    }

    if (editingManufacturer) {
      catalogAdminRepository.updateManufacturer(editingManufacturer.id, manufacturerForm as any);
      notify(`Виробника "${manufacturerForm.name}" оновлено`);
    } else {
      catalogAdminRepository.createManufacturer(manufacturerForm as any);
      notify(`Нового виробника "${manufacturerForm.name}" створено`);
    }

    setIsManufacturerModalOpen(false);
    reloadData();
  };

  const handleDeleteManufacturer = (id: string, name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Видалити компанію?',
      message: `Видалити виробника "${name}"?`,
      actionText: 'Видалити',
      onConfirm: () => {
        catalogAdminRepository.deleteManufacturer(id);
        notify(`Виробника "${name}" видалено`);
        reloadData();
        setConfirmDialog(null);
      },
    });
  };

  // --- TEMPERATURE PROFILE ACTIONS ---
  const handleOpenEditTemp = (type: string, profile: TemperatureProfile) => {
    setEditingTempType(type);
    setTempForm({ ...profile });
    setIsTempModalOpen(true);
  };

  const handleSaveTemp = () => {
    if (!editingTempType || !tempForm.nozzleRange) return;
    catalogAdminRepository.updateTemperatureProfile(editingTempType, tempForm as TemperatureProfile);
    notify(`Температурний профіль для "${editingTempType}" збережено`);
    setIsTempModalOpen(false);
    reloadData();
  };

  const handleResetToFactory = () => {
    setConfirmDialog({
      isOpen: true,
      title: 'Скинути всі дані каталогу?',
      message: 'Скинути всі дані каталогу (товари, виробники, профілі) до заводських еталонних значень?',
      actionText: 'Скинути до заводських',
      onConfirm: () => {
        catalogAdminRepository.resetAllToFactory();
        notify('Дані успішно скинуто до еталонних налаштувань');
        reloadData();
        setConfirmDialog(null);
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 rounded-full border border-amber-200 dark:border-amber-800 mb-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
            <span>Панель керування адміністратора KILO·G</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-neutral-900 dark:text-white">
            Керування каталогом: Товари, Бренди & Профілі
          </h1>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Повне фло редагування: додавайте та редагуйте позиції пластиків, перемикайте статус наявності, керуйте цінами, посиланнями на магазини, профілями температур та виробниками.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={handleResetToFactory}
            title="Скинути до стандартних значень"
          >
            Скинути до заводських
          </Button>

          <Button
            variant="outline"
            size="sm"
            leftIcon={<Eye className="w-3.5 h-3.5" />}
            onClick={() => window.open('/filaments', '_blank')}
            title="Відкрити публічну сторінку каталогу"
          >
            Публічний каталог
          </Button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex items-center gap-2 p-1.5 bg-neutral-200/80 dark:bg-neutral-800 rounded-2xl w-fit text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('filaments')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'filaments'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Layers className="w-4 h-4 text-emerald-600" />
          <span>Філаменти ({filaments.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('manufacturers')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'manufacturers'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Building2 className="w-4 h-4 text-blue-600" />
          <span>Виробники ({manufacturers.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('temperatures')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'temperatures'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Flame className="w-4 h-4 text-amber-500" />
          <span>Температурні стандарти ({Object.keys(temperatures).length})</span>
        </button>
      </div>

      {/* TAB 1: FILAMENTS MANAGEMENT */}
      {activeTab === 'filaments' && (
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white">
                Список товарних позицій каталогу
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Керуйте наявністю на складі, ціною за 1 кг, магазинами та кольоровими профілями.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddFilament}
            >
              Додати позицію філаменту
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase tracking-wider font-bold border-b border-neutral-200 dark:border-neutral-800">
                <tr>
                  <th className="py-3 px-3">Статус наявності</th>
                  <th className="py-3 px-3">Назва та Бренд</th>
                  <th className="py-3 px-3">Тип / Колір</th>
                  <th className="py-3 px-3">Ціна / кг</th>
                  <th className="py-3 px-3">Температури</th>
                  <th className="py-3 px-3">Магазини UA</th>
                  <th className="py-3 px-3 text-right">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {filaments.map((f) => (
                  <tr key={f.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40">
                    {/* Stock Status Switcher */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleToggleStockStatus(f)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold cursor-pointer transition-colors border ${
                          f.inStock
                            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        }`}
                        title="Натисніть для перемикання статусу"
                      >
                        {f.inStock ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>{f.stockStatusLabel || 'В наявності'}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3.5 h-3.5 text-rose-600" />
                            <span>{f.stockStatusLabel || 'Немає в наявності'}</span>
                          </>
                        )}
                      </button>
                    </td>

                    {/* Name & Brand */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-neutral-900 dark:text-white">
                        {f.name}
                      </div>
                      <div className="text-[11px] text-neutral-500 font-medium">
                        {f.brand}
                      </div>
                    </td>

                    {/* Type & Color Tone */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200">
                          {f.type}
                        </span>
                        <span
                          className="w-3 h-3 rounded-full border border-neutral-300 dark:border-neutral-700"
                          style={{
                            backgroundColor:
                              COLOR_TONES_CONFIG[f.primaryColorTone]?.hex || '#1e293b',
                          }}
                          title={`Колірна група: ${f.primaryColorTone}`}
                        />
                      </div>
                    </td>

                    {/* Price */}
                    <td className="py-3 px-3 font-mono font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      {formatUah(f.approxPricePerKgUah)}/кг
                    </td>

                    {/* Temps */}
                    <td className="py-3 px-3 font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                      <div>Сопло: {f.printTempNozzle || 'Стандартне'}</div>
                      <div>Стіл: {f.printTempBed || 'Стандартне'}</div>
                    </td>

                    {/* Store links count */}
                    <td className="py-3 px-3 text-neutral-600 dark:text-neutral-400">
                      {f.stores?.length || 0} посилання
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1.5"
                          onClick={() => handleOpenEditFilament(f)}
                          title="Редагувати"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-400" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1.5 text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteFilament(f.id, f.name)}
                          title="Видалити"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: MANUFACTURERS MANAGEMENT */}
      {activeTab === 'manufacturers' && (
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white">
                Компанії та виробники (Логотипи, сайти, країни)
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Керуйте офіційними ресурсами брендів, логотипами та посиланнями на сайти для користувачів.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddManufacturer}
            >
              Додати виробника
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {manufacturers.map((m) => (
              <div
                key={m.id}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-10 h-10 rounded-lg ${m.logoBg} flex items-center justify-center font-black text-xs ${m.logoTextColor} shadow-2xs`}
                      >
                        {m.logoText}
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-neutral-900 dark:text-white">
                          {m.name}
                        </h3>
                        <span className="text-[11px] text-neutral-500 block">
                          {m.country}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1"
                        onClick={() => handleOpenEditManufacturer(m)}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 text-red-600"
                        onClick={() => handleDeleteManufacturer(m.id, m.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2">
                    {m.description}
                  </p>

                  <a
                    href={m.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:underline flex items-center gap-1 font-medium pt-1"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>{m.website}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: TEMPERATURE STANDARDS MANAGEMENT */}
      {activeTab === 'temperatures' && (
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-5">
          <div className="border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <h2 className="text-base font-bold text-neutral-900 dark:text-white">
              Стандартні температурні профілі (Fallback за замовчуванням)
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Якщо конкретний виробник або котушка не має заданих температур, KILO·G автоматично використовує ці налаштування.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(temperatures).map(([typeKey, prof]) => (
              <div
                key={typeKey}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-sm px-2.5 py-1 rounded bg-neutral-900 text-white dark:bg-emerald-600 dark:text-white">
                      {typeKey}
                    </span>
                    <span className="font-semibold text-xs text-neutral-800 dark:text-neutral-200">
                      {prof.plasticType}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    leftIcon={<Edit2 className="w-3 h-3" />}
                    onClick={() => handleOpenEditTemp(typeKey, prof)}
                  >
                    Редагувати
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700">
                    <span className="text-[10px] text-neutral-400 block">Сопло (Nozzle):</span>
                    <span className="font-mono font-bold text-neutral-900 dark:text-white">
                      {prof.nozzleRange}
                    </span>
                  </div>
                  <div className="p-2 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700">
                    <span className="text-[10px] text-neutral-400 block">Стіл (Bed):</span>
                    <span className="font-mono font-bold text-neutral-900 dark:text-white">
                      {prof.bedRange}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-neutral-600 dark:text-neutral-400">
                  {prof.notes}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT FILAMENT */}
      <Modal
        isOpen={isFilamentModalOpen}
        onClose={() => setIsFilamentModalOpen(false)}
        title={editingFilament ? 'Редагування позиції філаменту' : 'Додати новий філамент у каталог'}
        description="Заповніть інформацію про товар, ціну, наявність та робочі температури."
        maxWidth="2xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsFilamentModalOpen(false)}>
              Скасувати
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveFilament}>
              Зберегти позицію
            </Button>
          </>
        }
      >
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {formError && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg font-medium">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Назва товару"
              value={filamentForm.name || ''}
              onChange={(e) => setFilamentForm({ ...filamentForm, name: e.target.value })}
              placeholder="e.g. Plexiwire PETG Black"
              required
            />

            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Виробник (Бренд)
              </label>
              <select
                value={filamentForm.manufacturerId || ''}
                onChange={(e) => {
                  const mfg = manufacturers.find((m) => m.id === e.target.value);
                  setFilamentForm({
                    ...filamentForm,
                    manufacturerId: e.target.value,
                    brand: mfg?.name || filamentForm.brand,
                  });
                }}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium"
              >
                {manufacturers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.country})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Тип пластику
              </label>
              <select
                value={filamentForm.type || 'PLA'}
                onChange={(e) => setFilamentForm({ ...filamentForm, type: e.target.value })}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono font-bold"
              >
                <option value="PLA">PLA</option>
                <option value="PETG">PETG</option>
                <option value="ABS">ABS</option>
                <option value="ASA">ASA</option>
                <option value="TPU">TPU</option>
                <option value="PA">PA (Nylon)</option>
                <option value="PLA-CF">PLA-CF</option>
                <option value="PC">PC</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Колірна група (сортування)
              </label>
              <select
                value={filamentForm.primaryColorTone || 'black'}
                onChange={(e) =>
                  setFilamentForm({ ...filamentForm, primaryColorTone: e.target.value as ColorTone })
                }
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-medium"
              >
                {(Object.keys(COLOR_TONES_CONFIG) as ColorTone[]).map((t) => (
                  <option key={t} value={t}>
                    {COLOR_TONES_CONFIG[t].label}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Ціна орієнтовна (грн/кг)"
              type="number"
              value={String(filamentForm.approxPricePerKgUah || '')}
              onChange={(e) =>
                setFilamentForm({
                  ...filamentForm,
                  approxPricePerKgUah: parseFloat(e.target.value) || 0,
                })
              }
            />
          </div>

          {/* Stock Status Configuration */}
          <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200 dark:border-neutral-700 space-y-2">
            <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block">
              Наявність товару на складі:
            </span>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
                <input
                  type="radio"
                  name="inStock"
                  checked={filamentForm.inStock === true}
                  onChange={() =>
                    setFilamentForm({
                      ...filamentForm,
                      inStock: true,
                      stockStatusLabel: 'В наявності',
                    })
                  }
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-emerald-700 dark:text-emerald-300 font-bold">✅ В наявності</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer font-medium">
                <input
                  type="radio"
                  name="inStock"
                  checked={filamentForm.inStock === false}
                  onChange={() =>
                    setFilamentForm({
                      ...filamentForm,
                      inStock: false,
                      stockStatusLabel: 'Немає в наявності',
                    })
                  }
                  className="text-rose-600 focus:ring-rose-500"
                />
                <span className="text-rose-700 dark:text-rose-300 font-bold">❌ Немає в наявності</span>
              </label>
            </div>

            <Input
              label="Текст статусу (для клієнтів)"
              value={filamentForm.stockStatusLabel || ''}
              onChange={(e) =>
                setFilamentForm({ ...filamentForm, stockStatusLabel: e.target.value })
              }
              placeholder="В наявності / Очікується поставка / Під замовлення"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Температура сопла (°C)"
              value={filamentForm.printTempNozzle || ''}
              onChange={(e) =>
                setFilamentForm({ ...filamentForm, printTempNozzle: e.target.value })
              }
              placeholder="e.g. 210–230 °C (якщо пусто — стандартна)"
            />

            <Input
              label="Температура столу (°C)"
              value={filamentForm.printTempBed || ''}
              onChange={(e) =>
                setFilamentForm({ ...filamentForm, printTempBed: e.target.value })
              }
              placeholder="e.g. 60–75 °C"
            />
          </div>

          <Input
            label="Опис"
            value={filamentForm.description || ''}
            onChange={(e) => setFilamentForm({ ...filamentForm, description: e.target.value })}
            placeholder="Короткий опис властивостей та призначення"
          />

          <Input
            label="Маркетинговий бейдж"
            value={filamentForm.badge || ''}
            onChange={(e) => setFilamentForm({ ...filamentForm, badge: e.target.value })}
            placeholder="e.g. Український виробник 🇺🇦 / Топ вибір"
          />
        </div>
      </Modal>

      {/* MODAL: ADD / EDIT MANUFACTURER */}
      <Modal
        isOpen={isManufacturerModalOpen}
        onClose={() => setIsManufacturerModalOpen(false)}
        title={editingManufacturer ? 'Редагувати виробника' : 'Додати виробника'}
        description="Компанія, логотип, країна та пряме посилання на офіційний сайт."
        maxWidth="lg"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsManufacturerModalOpen(false)}>
              Скасувати
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveManufacturer}>
              Зберегти компанію
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && (
            <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs rounded-lg font-medium">
              {formError}
            </div>
          )}

          <Input
            label="Назва бренду"
            value={manufacturerForm.name || ''}
            onChange={(e) => setManufacturerForm({ ...manufacturerForm, name: e.target.value })}
            placeholder="e.g. Plexiwire"
            required
          />

          <Input
            label="Країна"
            value={manufacturerForm.country || ''}
            onChange={(e) => setManufacturerForm({ ...manufacturerForm, country: e.target.value })}
            placeholder="Україна 🇺🇦"
          />

          <Input
            label="Офіційний сайт"
            value={manufacturerForm.website || ''}
            onChange={(e) => setManufacturerForm({ ...manufacturerForm, website: e.target.value })}
            placeholder="https://plexiwire.com.ua"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Текст логотипу (до 5 літер)"
              value={manufacturerForm.logoText || ''}
              onChange={(e) => setManufacturerForm({ ...manufacturerForm, logoText: e.target.value })}
              placeholder="PLEXI"
            />

            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Фон логотипу
              </label>
              <select
                value={manufacturerForm.logoBg || 'bg-emerald-600'}
                onChange={(e) => setManufacturerForm({ ...manufacturerForm, logoBg: e.target.value })}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-medium"
              >
                <option value="bg-emerald-600">Смарагдовий (Emerald)</option>
                <option value="bg-blue-600">Синій (Blue)</option>
                <option value="bg-amber-600">Бурштиновий (Amber)</option>
                <option value="bg-red-600">Червоний (Red)</option>
                <option value="bg-violet-600">Фіолетовий (Violet)</option>
                <option value="bg-sky-600">Блакитний (Sky)</option>
                <option value="bg-neutral-900">Чорний (Dark)</option>
              </select>
            </div>
          </div>

          <Input
            label="Опис виробника"
            value={manufacturerForm.description || ''}
            onChange={(e) => setManufacturerForm({ ...manufacturerForm, description: e.target.value })}
            placeholder="Короткий опис діяльності"
          />
        </div>
      </Modal>

      {/* MODAL: EDIT TEMPERATURE PROFILE */}
      <Modal
        isOpen={isTempModalOpen}
        onClose={() => setIsTempModalOpen(false)}
        title={`Редагування стандарту: ${editingTempType}`}
        description="Параметри за замовчуванням, якщо не задані котушкою."
        maxWidth="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsTempModalOpen(false)}>
              Скасувати
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveTemp}>
              Зберегти профіль
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Діапазон сопла (°C)"
            value={tempForm.nozzleRange || ''}
            onChange={(e) => setTempForm({ ...tempForm, nozzleRange: e.target.value })}
            placeholder="190–225 °C"
          />

          <Input
            label="Діапазон столу (°C)"
            value={tempForm.bedRange || ''}
            onChange={(e) => setTempForm({ ...tempForm, bedRange: e.target.value })}
            placeholder="50–60 °C"
          />

          <Input
            label="Термокамера"
            value={tempForm.chamberRange || ''}
            onChange={(e) => setTempForm({ ...tempForm, chamberRange: e.target.value })}
            placeholder="Кімнатна / 50 °C"
          />

          <Input
            label="Обдув деталі (Fan)"
            value={tempForm.fanSpeed || ''}
            onChange={(e) => setTempForm({ ...tempForm, fanSpeed: e.target.value })}
            placeholder="100%"
          />

          <Input
            label="Сушіння перед друком"
            value={tempForm.dryingTempTime || ''}
            onChange={(e) => setTempForm({ ...tempForm, dryingTempTime: e.target.value })}
            placeholder="50 °C (4 год)"
          />

          <Input
            label="Примітки технології друку"
            value={tempForm.notes || ''}
            onChange={(e) => setTempForm({ ...tempForm, notes: e.target.value })}
            placeholder="Рекомендації щодо усадки, адгезії тощо"
          />
        </div>
      </Modal>

      {/* CONFIRMATION DIALOG MODAL */}
      {confirmDialog && (
        <Modal
          isOpen={confirmDialog.isOpen}
          onClose={() => setConfirmDialog(null)}
          title={confirmDialog.title}
          maxWidth="sm"
          footer={
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirmDialog(null)}>
                Скасувати
              </Button>
              <Button variant="danger" size="sm" onClick={confirmDialog.onConfirm}>
                {confirmDialog.actionText || 'Підтвердити'}
              </Button>
            </>
          }
        >
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            {confirmDialog.message}
          </p>
        </Modal>
      )}
    </div>
  );
};
