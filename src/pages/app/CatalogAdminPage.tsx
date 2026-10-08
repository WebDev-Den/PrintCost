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
  Disc,
  RefreshCw,
  Palette,
  Scale,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import {
  PublicFilamentItem,
  ManufacturerBrand,
  TemperatureProfile,
  ColorTone,
  ColorType,
  COLOR_TONES_CONFIG,
  PackagingType,
} from '../../domain/filamentsDirectory.ts';
import { catalogAdminRepository } from '../../services/catalogAdminRepository.ts';
import { formatUah } from '../../domain/formatters.ts';
import { FilamentColorVisual } from '../../components/filaments/FilamentColorVisual.tsx';

export const CatalogAdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'filaments' | 'manufacturers' | 'plastic_types' | 'temperatures'>('filaments');

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
  
  // Quick Add Manufacturer inline in filament modal
  const [isAddingNewMfgInline, setIsAddingNewMfgInline] = useState(false);
  const [newMfgName, setNewMfgName] = useState('');
  const [newMfgCountry, setNewMfgCountry] = useState('Україна 🇺🇦');
  const [newMfgWebsite, setNewMfgWebsite] = useState('');
  const [quickMfgError, setQuickMfgError] = useState<string | null>(null);

  // Custom plastic type
  const [isCustomPlasticType, setIsCustomPlasticType] = useState(false);
  const [customPlasticTypeName, setCustomPlasticTypeName] = useState('');

  // 1-card attributes state for filament form
  const [formColorName, setFormColorName] = useState('Чорний');
  const [formColorHex, setFormColorHex] = useState('#111827');
  const [formColorType, setFormColorType] = useState<ColorType>('solid');
  const [formSecondaryHex, setFormSecondaryHex] = useState('#3b82f6');
  const [formStoreUrl, setFormStoreUrl] = useState('');
  const [formStoreName, setFormStoreName] = useState('Офіційний магазин');
  const [formSpoolPrice, setFormSpoolPrice] = useState<number>(600);

  const [filamentForm, setFilamentForm] = useState<Partial<PublicFilamentItem>>({
    name: '',
    brand: '',
    manufacturerId: '',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 600,
    spoolWeightGrams: 1000,
    packagingType: 'spool',
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    densityGPerCm3: 1.24,
    description: '',
    badge: '',
    printTempNozzle: '',
    printTempBed: '',
    popularColors: [{ name: 'Чорний', hex: '#111827', colorTone: 'black', packagingType: 'spool' }],
    stores: [{ storeName: 'Офіційний магазин', url: '', priceUah: 600, spoolWeightGrams: 1000, inStock: true }],
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

  // Temperature profile & plastic types modal & editing state
  const [isTempModalOpen, setIsTempModalOpen] = useState(false);
  const [isCreatingNewTemp, setIsCreatingNewTemp] = useState(false);
  const [editingTempType, setEditingTempType] = useState<string | null>(null);
  const [newTempTypeKey, setNewTempTypeKey] = useState('');
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

  // Plastic Type Create/Edit modal state
  const [isPlasticTypeModalOpen, setIsPlasticTypeModalOpen] = useState(false);
  const [editingPlasticTypeOriginal, setEditingPlasticTypeOriginal] = useState<string | null>(null);
  const [plasticTypeFormName, setPlasticTypeFormName] = useState('');
  const [plasticTypeFormFamily, setPlasticTypeFormFamily] = useState<'Стандартні' | 'Інженерні' | 'Гнучкі' | 'Композитні' | 'Підтримки'>('Стандартні');
  const [plasticTypeFormDensity, setPlasticTypeFormDensity] = useState(1.24);
  const [plasticTypeFormDescription, setPlasticTypeFormDescription] = useState('');

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
    setIsAddingNewMfgInline(false);
    setQuickMfgError(null);
    setNewMfgName('');
    setNewMfgWebsite('');
    setIsCustomPlasticType(false);
    setCustomPlasticTypeName('');
    setFormColorName('Чорний');
    setFormColorHex('#111827');
    setFormColorType('solid');
    setFormSecondaryHex('#3b82f6');
    setFormStoreUrl('');
    setFormStoreName('Офіційний магазин');
    setFormSpoolPrice(600);

    const defaultMfg = manufacturers[0] || { id: 'plexiwire', name: 'Plexiwire' };
    setFilamentForm({
      name: '',
      brand: defaultMfg.name,
      manufacturerId: defaultMfg.id,
      type: 'PLA',
      family: 'Стандартні',
      approxPricePerKgUah: 600,
      spoolWeightGrams: 1000,
      packagingType: 'spool',
      diameterMm: 1.75,
      inStock: true,
      stockStatusLabel: 'В наявності',
      primaryColorTone: 'black',
      densityGPerCm3: 1.24,
      description: '',
      badge: '',
      printTempNozzle: '',
      printTempBed: '',
      popularColors: [{ name: 'Чорний', hex: '#111827', colorTone: 'black', packagingType: 'spool' }],
      stores: [{ storeName: 'Офіційний магазин', url: '', priceUah: 600, spoolWeightGrams: 1000, inStock: true }],
    });
    setIsFilamentModalOpen(true);
  };

  const handleOpenEditFilament = (item: PublicFilamentItem) => {
    setFormError(null);
    setEditingFilament(item);
    setIsAddingNewMfgInline(false);
    setQuickMfgError(null);

    const standardTypes = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PLA-CF', 'PC', 'HIPS', 'PVA'];
    if (!standardTypes.includes(item.type)) {
      setIsCustomPlasticType(true);
      setCustomPlasticTypeName(item.type);
    } else {
      setIsCustomPlasticType(false);
      setCustomPlasticTypeName('');
    }

    const firstColor = item.popularColors?.[0] || { name: 'Стандартний', hex: '#111827', colorTone: item.primaryColorTone || 'black' };
    setFormColorName(firstColor.name);
    setFormColorHex(firstColor.hex || '#111827');
    setFormColorType(firstColor.colorType || (firstColor.colorTone === 'multicolor' ? 'rainbow' : 'solid'));
    setFormSecondaryHex(firstColor.hexList?.[1] || '#3b82f6');

    const firstStore = firstColor.stores?.[0] || item.stores?.[0] || { storeName: 'Офіційний магазин', url: '', priceUah: item.approxPricePerKgUah || 600 };
    setFormStoreUrl(firstStore.url || '');
    setFormStoreName(firstStore.storeName || 'Офіційний магазин');
    setFormSpoolPrice(firstStore.priceUah || item.approxPricePerKgUah || 600);

    const isRefill = item.packagingType === 'refill' || item.name.toLowerCase().includes('refill') || item.name.toLowerCase().includes('рефіл');

    setFilamentForm({
      ...item,
      packagingType: isRefill ? 'refill' : 'spool',
      spoolWeightGrams: firstStore.spoolWeightGrams || item.spoolWeightGrams || 1000,
    });
    setIsFilamentModalOpen(true);
  };

  // Quick save new manufacturer directly from the filament modal
  const handleSaveQuickManufacturer = () => {
    if (!newMfgName.trim()) {
      setQuickMfgError('Вкажіть назву нового бренду');
      return;
    }

    const created = catalogAdminRepository.createManufacturer({
      name: newMfgName.trim(),
      country: newMfgCountry,
      website: newMfgWebsite.trim() || 'https://',
      logoText: newMfgName.trim().substring(0, 5).toUpperCase(),
      logoBg: 'bg-emerald-600',
      logoTextColor: 'text-white',
      description: `Виробник філаментів для 3D-друку ${newMfgName.trim()}`,
    });

    const updated = catalogAdminRepository.getManufacturers();
    setManufacturers(updated);

    // Immediately select this newly added manufacturer in filamentForm
    setFilamentForm((prev) => ({
      ...prev,
      manufacturerId: created.id,
      brand: created.name,
    }));

    setIsAddingNewMfgInline(false);
    setQuickMfgError(null);
    setNewMfgName('');
    setNewMfgWebsite('');
    notify(`Виробника "${created.name}" успішно створено та вибрано!`);
  };

  const handleSaveFilament = () => {
    const finalType = isCustomPlasticType
      ? customPlasticTypeName.trim() || filamentForm.type || 'PLA'
      : filamentForm.type || 'PLA';

    if (!filamentForm.name || !finalType) {
      setFormError('Будь ласка, заповніть назву та тип пластику');
      return;
    }

    const spoolGrams = filamentForm.spoolWeightGrams || 1000;
    const spoolPrice = formSpoolPrice || filamentForm.approxPricePerKgUah || 600;
    const calcPricePerKg = Math.round((spoolPrice / spoolGrams) * 1000);
    const packagingType: PackagingType = filamentForm.packagingType || 'spool';

    const isMultiType =
      formColorType === 'rainbow' ||
      formColorType === 'dual' ||
      formColorType === 'tri' ||
      formColorType === 'gradient';

    const hexList =
      formColorType === 'dual'
        ? [formColorHex, formSecondaryHex]
        : formColorType === 'rainbow'
        ? ['#ef4444', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6', '#a855f7']
        : undefined;

    const finalColorTone: ColorTone = isMultiType ? 'multicolor' : filamentForm.primaryColorTone || 'black';

    const colorItem = {
      name: formColorName || 'Кольоровий',
      hex: formColorHex || '#111827',
      hexList,
      colorType: formColorType,
      colorTone: finalColorTone,
      packagingType,
      stores: [
        {
          storeName: formStoreName || 'Офіційний магазин',
          url: formStoreUrl || 'https://',
          productTitle: `${filamentForm.brand || ''} ${finalType} ${formColorName || ''} ${spoolGrams}г`,
          colorName: formColorName || 'Кольоровий',
          spoolWeightGrams: spoolGrams,
          priceUah: spoolPrice,
          inStock: filamentForm.inStock ?? true,
          isOfficialDistributor: true,
        },
      ],
    };

    const payload: Partial<PublicFilamentItem> = {
      ...filamentForm,
      type: finalType,
      spoolWeightGrams: spoolGrams,
      packagingType,
      approxPricePerKgUah: calcPricePerKg,
      popularColors: [colorItem],
      stores: colorItem.stores,
    };

    if (editingFilament) {
      catalogAdminRepository.updateFilament(editingFilament.id, payload as any);
      notify(`Філамент "${filamentForm.name}" успішно оновлено`);
    } else {
      catalogAdminRepository.createFilament(payload as any);
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

  // --- TEMPERATURE PROFILE CRUD ACTIONS ---
  const handleOpenAddTemp = () => {
    setIsCreatingNewTemp(true);
    setEditingTempType(null);
    setNewTempTypeKey('');
    setTempForm({
      plasticType: '',
      nozzleRange: '200–230 °C',
      bedRange: '50–70 °C',
      chamberRange: 'Кімнатна',
      fanSpeed: '100%',
      notes: '',
      enclosureRequired: false,
      dryingTempTime: '50 °C (4 год)',
    });
    setIsTempModalOpen(true);
  };

  const handleOpenEditTemp = (type: string, profile: TemperatureProfile) => {
    setIsCreatingNewTemp(false);
    setEditingTempType(type);
    setNewTempTypeKey(type);
    setTempForm({ ...profile });
    setIsTempModalOpen(true);
  };

  const handleSaveTemp = () => {
    const finalKey = isCreatingNewTemp ? newTempTypeKey.trim().toUpperCase() : editingTempType;
    if (!finalKey) {
      notify('Вкажіть унікальний ідентифікатор типу (наприклад, PETG, ABS, PC)');
      return;
    }
    if (!tempForm.nozzleRange) {
      notify('Вкажіть робочу температуру сопла');
      return;
    }

    const payload: TemperatureProfile = {
      plasticType: tempForm.plasticType || finalKey,
      nozzleRange: tempForm.nozzleRange || '200–230 °C',
      bedRange: tempForm.bedRange || '50–70 °C',
      chamberRange: tempForm.chamberRange || 'Кімнатна',
      fanSpeed: tempForm.fanSpeed || '100%',
      notes: tempForm.notes || '',
      enclosureRequired: tempForm.enclosureRequired || false,
      dryingTempTime: tempForm.dryingTempTime || '50 °C (4 год)',
    };

    catalogAdminRepository.updateTemperatureProfile(finalKey, payload);
    notify(isCreatingNewTemp ? `Створено новий температурний профіль "${finalKey}"` : `Температурний профіль для "${finalKey}" збережено`);
    setIsTempModalOpen(false);
    reloadData();
  };

  const handleDeleteTemp = (typeKey: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Видалити температурний стандарт?',
      message: `Видалити стандарт температур для типу "${typeKey}"?`,
      actionText: 'Видалити',
      onConfirm: () => {
        catalogAdminRepository.deleteTemperatureProfile(typeKey);
        notify(`Температурний стандарт "${typeKey}" видалено`);
        reloadData();
        setConfirmDialog(null);
      },
    });
  };

  // --- PLASTIC TYPES CRUD ACTIONS ---
  const handleOpenAddPlasticType = () => {
    setEditingPlasticTypeOriginal(null);
    setPlasticTypeFormName('');
    setPlasticTypeFormFamily('Стандартні');
    setPlasticTypeFormDensity(1.24);
    setPlasticTypeFormDescription('');
    setIsPlasticTypeModalOpen(true);
  };

  const handleOpenEditPlasticType = (typeName: string) => {
    setEditingPlasticTypeOriginal(typeName);
    setPlasticTypeFormName(typeName);
    const existingTemp = temperatures[typeName];
    const relatedFilament = filaments.find((f) => f.type.toLowerCase() === typeName.toLowerCase());
    setPlasticTypeFormFamily(relatedFilament?.family || 'Стандартні');
    setPlasticTypeFormDensity(relatedFilament?.densityGPerCm3 || 1.24);
    setPlasticTypeFormDescription(existingTemp?.notes || relatedFilament?.description || '');
    setIsPlasticTypeModalOpen(true);
  };

  const handleSavePlasticType = () => {
    const cleanName = plasticTypeFormName.trim().toUpperCase();
    if (!cleanName) {
      notify('Вкажіть назву типу пластику');
      return;
    }

    // 1. If renaming, update all existing filaments of this type
    if (editingPlasticTypeOriginal && editingPlasticTypeOriginal !== cleanName) {
      const allFilaments = catalogAdminRepository.getFilaments();
      const updatedFilaments = allFilaments.map((f) =>
        f.type.toUpperCase() === editingPlasticTypeOriginal.toUpperCase()
          ? { ...f, type: cleanName, family: plasticTypeFormFamily, densityGPerCm3: plasticTypeFormDensity }
          : f
      );
      catalogAdminRepository.saveFilaments(updatedFilaments);

      // If temp profile existed under old name, transfer it
      if (temperatures[editingPlasticTypeOriginal]) {
        const oldProf = temperatures[editingPlasticTypeOriginal];
        catalogAdminRepository.deleteTemperatureProfile(editingPlasticTypeOriginal);
        catalogAdminRepository.updateTemperatureProfile(cleanName, {
          ...oldProf,
          plasticType: cleanName,
          notes: plasticTypeFormDescription || oldProf.notes,
        });
      }
    } else {
      // 2. Ensure matching temperature standard profile exists
      if (!temperatures[cleanName]) {
        catalogAdminRepository.updateTemperatureProfile(cleanName, {
          plasticType: cleanName,
          nozzleRange: '210–235 °C',
          bedRange: '60–80 °C',
          chamberRange: 'Кімнатна',
          fanSpeed: '80%',
          notes: plasticTypeFormDescription || `Інженерний пластик ${cleanName}`,
          enclosureRequired: false,
          dryingTempTime: '50 °C (4 год)',
        });
      }
    }

    notify(`Тип пластику "${cleanName}" успішно збережено`);
    setIsPlasticTypeModalOpen(false);
    reloadData();
  };

  const handleDeletePlasticType = (typeName: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Видалити тип пластику?',
      message: `Видалити тип "${typeName}"? Пов'язані позиції товарів у каталозі залишаться, але потребуватимуть оновлення.`,
      actionText: 'Видалити тип',
      onConfirm: () => {
        catalogAdminRepository.deleteTemperatureProfile(typeName);
        notify(`Тип пластику "${typeName}" видалено`);
        reloadData();
        setConfirmDialog(null);
      },
    });
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

      {/* Admin Tabs - Responsively scrollable on mobile */}
      <div className="flex items-center gap-2 p-1.5 bg-neutral-200/80 dark:bg-neutral-800 rounded-2xl w-fit max-w-full overflow-x-auto no-scrollbar text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab('filaments')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
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
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
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
          onClick={() => setActiveTab('plastic_types')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
            activeTab === 'plastic_types'
              ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
          }`}
        >
          <Sparkles className="w-4 h-4 text-purple-600" />
          <span>Типи пластику ({Array.from(new Set(filaments.map((f) => f.type))).length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('temperatures')}
          className={`px-4 py-2 rounded-xl transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
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
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-4 sm:p-5">
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
              className="w-full sm:w-auto justify-center"
            >
              Додати позицію філаменту
            </Button>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <table className="w-full min-w-[680px] text-left text-xs">
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
                        <FilamentColorVisual
                          colorHex={f.popularColors?.[0]?.hex || COLOR_TONES_CONFIG[f.primaryColorTone]?.hex || '#1e293b'}
                          colorHexList={f.popularColors?.[0]?.hexList}
                          colorType={f.popularColors?.[0]?.colorType || (f.primaryColorTone === 'multicolor' ? 'rainbow' : 'solid')}
                          colorName={f.popularColors?.[0]?.name || f.primaryColorTone}
                          size="xs"
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

      {/* TAB 3: PLASTIC TYPES CRUD MANAGEMENT */}
      {activeTab === 'plastic_types' && (
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white">
                Типи пластику для 3D-друку (PLA, PETG, ABS, TPU, PC, тощо)
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Керуйте номенклатурою типів полімерів, групами складності, густиною (г/см³) та пов'язаними профілями.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddPlasticType}
            >
              Додати тип пластику
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from(new Set([...Object.keys(temperatures), ...filaments.map((f) => f.type)])).map((typeKey) => {
              const matchedFilaments = filaments.filter((f) => f.type.toLowerCase() === typeKey.toLowerCase());
              const tempProfile = temperatures[typeKey];
              const family = matchedFilaments[0]?.family || 'Стандартні';
              const density = matchedFilaments[0]?.densityGPerCm3 || 1.24;

              return (
                <div
                  key={typeKey}
                  className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/40 space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-black text-sm px-2.5 py-1 rounded bg-neutral-900 text-white dark:bg-purple-600 dark:text-white shadow-2xs">
                          {typeKey}
                        </span>
                        <div>
                          <span className="text-xs font-bold text-neutral-900 dark:text-white block">
                            {tempProfile?.plasticType || typeKey}
                          </span>
                          <span className="text-[10px] text-neutral-500 block">
                            {family} · {density} г/см³
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1"
                          onClick={() => handleOpenEditPlasticType(typeKey)}
                          title="Редагувати тип пластику"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1 text-red-600 hover:text-red-700"
                          onClick={() => handleDeletePlasticType(typeKey)}
                          title="Видалити тип пластику"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1">
                      <div className="bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <span className="text-neutral-400 block text-[10px]">У каталозі:</span>
                        <span className="font-bold text-neutral-800 dark:text-neutral-200">
                          {matchedFilaments.length} поз.
                        </span>
                      </div>
                      <div className="bg-white dark:bg-neutral-900 p-2 rounded-lg border border-neutral-200 dark:border-neutral-700">
                        <span className="text-neutral-400 block text-[10px]">Темп. сопла:</span>
                        <span className="font-mono font-bold text-neutral-800 dark:text-neutral-200">
                          {tempProfile?.nozzleRange || 'Не задано'}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-neutral-600 dark:text-neutral-400 line-clamp-2 pt-1">
                      {tempProfile?.notes || `Полімер для 3D друку типу ${typeKey}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 4: TEMPERATURE STANDARDS MANAGEMENT */}
      {activeTab === 'temperatures' && (
        <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs space-y-4 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 className="text-base font-bold text-neutral-900 dark:text-white">
                Стандартні температурні профілі (Fallback за замовчуванням)
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Якщо конкретний виробник або котушка не має заданих температур, KILO·G автоматично використовує ці налаштування.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              leftIcon={<Plus className="w-4 h-4" />}
              onClick={handleOpenAddTemp}
            >
              Додати температурний стандарт
            </Button>
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

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      leftIcon={<Edit2 className="w-3 h-3" />}
                      onClick={() => handleOpenEditTemp(typeKey, prof)}
                      title="Редагувати профіль"
                    >
                      Редагувати
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-1.5 text-red-600 hover:text-red-700"
                      onClick={() => handleDeleteTemp(typeKey)}
                      title="Видалити температурний стандарт"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
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
              label="Назва товару *"
              value={filamentForm.name || ''}
              onChange={(e) => setFilamentForm({ ...filamentForm, name: e.target.value })}
              placeholder="e.g. Plexiwire PETG Black"
              required
            />

            {/* MANUFACTURER SELECTION WITH DIRECT ADD CAPABILITY */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Виробник (Бренд) <span className="text-rose-500">*</span>
                </label>
                {!isAddingNewMfgInline && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingNewMfgInline(true);
                      setQuickMfgError(null);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline cursor-pointer bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800"
                    title="Додати нового виробника безпосередньо тут"
                  >
                    <Plus className="w-3 h-3" />
                    <span>+ Додати виробника</span>
                  </button>
                )}
              </div>

              {!isAddingNewMfgInline ? (
                <div className="relative">
                  <select
                    value={filamentForm.manufacturerId || ''}
                    onChange={(e) => {
                      if (e.target.value === '__ADD_NEW__') {
                        setIsAddingNewMfgInline(true);
                        setQuickMfgError(null);
                        return;
                      }
                      const mfg = manufacturers.find((m) => m.id === e.target.value);
                      setFilamentForm({
                        ...filamentForm,
                        manufacturerId: e.target.value,
                        brand: mfg?.name || filamentForm.brand,
                      });
                    }}
                    className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-2 focus:ring-emerald-500"
                  >
                    {manufacturers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.country})
                      </option>
                    ))}
                    <option value="__ADD_NEW__" className="font-bold text-emerald-600">
                      ➕ + Додати нового виробника...
                    </option>
                  </select>
                </div>
              ) : (
                /* INLINE QUICK ADD MANUFACTURER CARD */
                <div className="p-3 bg-emerald-50/90 dark:bg-emerald-950/50 border-2 border-emerald-400 dark:border-emerald-700 rounded-xl space-y-2.5 shadow-xs animate-in fade-in duration-200">
                  <div className="flex items-center justify-between pb-1 border-b border-emerald-200 dark:border-emerald-800">
                    <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                      Створити та вибрати нового виробника:
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAddingNewMfgInline(false)}
                      className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 cursor-pointer"
                    >
                      Скасувати
                    </button>
                  </div>

                  {quickMfgError && (
                    <div className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold bg-rose-50 dark:bg-rose-950/50 p-1.5 rounded border border-rose-200">
                      {quickMfgError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Назва бренду *
                      </label>
                      <input
                        type="text"
                        value={newMfgName}
                        onChange={(e) => setNewMfgName(e.target.value)}
                        placeholder="e.g. Creality, Anycubic, Fiberlogy"
                        className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-semibold focus:ring-2 focus:ring-emerald-500"
                        autoFocus
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                        Країна виробника
                      </label>
                      <select
                        value={newMfgCountry}
                        onChange={(e) => setNewMfgCountry(e.target.value)}
                        className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                      >
                        <option value="Україна 🇺🇦">Україна 🇺🇦</option>
                        <option value="Китай 🇨🇳">Китай 🇨🇳</option>
                        <option value="Польща 🇵🇱">Польща 🇵🇱</option>
                        <option value="Чехія 🇨🇿">Чехія 🇨🇿</option>
                        <option value="США 🇺🇸">США 🇺🇸</option>
                        <option value="Німеччина 🇩🇪">Німеччина 🇩🇪</option>
                        <option value="Нідерланди 🇳🇱">Нідерланди 🇳🇱</option>
                        <option value="Інша країна 🌐">Інша країна 🌐</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                      Офіційний сайт (необов'язково)
                    </label>
                    <input
                      type="url"
                      value={newMfgWebsite}
                      onChange={(e) => setNewMfgWebsite(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      leftIcon={<Check className="w-3.5 h-3.5" />}
                      onClick={handleSaveQuickManufacturer}
                      className="text-xs"
                    >
                      Зберегти та вибрати
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setIsAddingNewMfgInline(false)}
                      className="text-xs"
                    >
                      Скасувати
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* PLASTIC TYPE WITH CUSTOM ADD OPTION */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Тип пластику <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsCustomPlasticType(!isCustomPlasticType)}
                  className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  {isCustomPlasticType ? 'Стандартні типи' : '+ Інший тип'}
                </button>
              </div>

              {!isCustomPlasticType ? (
                <select
                  value={filamentForm.type || 'PLA'}
                  onChange={(e) => {
                    if (e.target.value === '__CUSTOM__') {
                      setIsCustomPlasticType(true);
                      return;
                    }
                    setFilamentForm({ ...filamentForm, type: e.target.value });
                  }}
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
                  <option value="HIPS">HIPS</option>
                  <option value="PVA">PVA</option>
                  <option value="__CUSTOM__">➕ + Інший власний тип...</option>
                </select>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={customPlasticTypeName}
                    onChange={(e) => setCustomPlasticTypeName(e.target.value)}
                    placeholder="e.g. PETG-CF, Silk PLA, TPU 95A"
                    className="flex-1 py-2 px-3 text-xs rounded-lg border border-emerald-400 dark:border-emerald-700 bg-white dark:bg-neutral-900 font-mono font-bold uppercase"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsCustomPlasticType(false)}
                    className="text-xs"
                  >
                    Списком
                  </Button>
                </div>
              )}
            </div>

            {/* PACKAGING FORMAT (SPOOL VS REFILL) */}
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Фасування (Формат)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFilamentForm({ ...filamentForm, packagingType: 'spool' })}
                  className={`p-2 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                    (filamentForm.packagingType || 'spool') === 'spool'
                      ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-200 ring-2 ring-emerald-500/20 font-bold'
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300'
                  }`}
                >
                  <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center shrink-0 text-emerald-700 dark:text-emerald-300">
                    <Disc className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">З котушкою</div>
                    <div className="text-[10px] text-neutral-500 font-normal">Стандарт</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setFilamentForm({ ...filamentForm, packagingType: 'refill' })}
                  className={`p-2 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                    filamentForm.packagingType === 'refill'
                      ? 'border-purple-600 bg-purple-50/70 dark:bg-purple-950/40 text-purple-950 dark:text-purple-200 ring-2 ring-purple-500/20 font-bold'
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:border-neutral-300'
                  }`}
                >
                  <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center shrink-0 text-purple-700 dark:text-purple-300">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold leading-tight">Рефіл (Refill)</div>
                    <div className="text-[10px] text-neutral-500 font-normal">Без котушки</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* SPOOL WEIGHT (1 ВАГА) */}
          <div>
            <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
              Вага котушки / мотка (нетто)
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {[
                { label: '1.0 кг (1000 г)', grams: 1000 },
                { label: '0.75 кг (750 г)', grams: 750 },
                { label: '0.5 кг (500 г)', grams: 500 },
                { label: '0.33 кг (330 г)', grams: 330 },
              ].map((preset) => (
                <button
                  key={preset.grams}
                  type="button"
                  onClick={() => setFilamentForm({ ...filamentForm, spoolWeightGrams: preset.grams })}
                  className={`px-2.5 py-1 text-xs rounded-lg border cursor-pointer font-medium transition-colors ${
                    (filamentForm.spoolWeightGrams || 1000) === preset.grams
                      ? 'bg-neutral-900 text-white dark:bg-emerald-600 border-transparent font-bold'
                      : 'bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
              <div className="flex items-center gap-1 ml-auto sm:ml-0">
                <input
                  type="number"
                  value={filamentForm.spoolWeightGrams || 1000}
                  onChange={(e) =>
                    setFilamentForm({
                      ...filamentForm,
                      spoolWeightGrams: parseInt(e.target.value) || 1000,
                    })
                  }
                  className="w-20 py-1 px-2 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-mono text-center font-bold"
                  placeholder="грам"
                />
                <span className="text-xs text-neutral-500 font-medium">г</span>
              </div>
            </div>
          </div>

          {/* COLOR CONFIGURATION (ПІДТРИМКА МОНО, ДУАЛ, ВЕСЕЛКА, ГРАДІЄНТ) */}
          <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200 dark:border-neutral-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-emerald-600" />
                Колір позиції (Моно або Мультиколір)
              </span>
              {/* Visual color icon preview with real gradient/dual/rainbow */}
              <div className="flex items-center gap-2 px-2.5 py-1 bg-white dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-2xs">
                <FilamentColorVisual
                  colorHex={formColorHex}
                  colorHexList={formColorType === 'dual' ? [formColorHex, formSecondaryHex] : undefined}
                  colorType={formColorType}
                  colorName={formColorName || 'Колір'}
                  size="sm"
                />
                <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">
                  {formColorName || 'Без назви'}
                </span>
              </div>
            </div>

            {/* COLOR TYPE SELECTION (Однорідний, Co-extrusion 2 кольори, Веселка, Мармур, Люмінесцент) */}
            <div>
              <label className="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1">
                Тип забарвлення:
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'solid', label: 'Однорідний (Solid)' },
                  { id: 'dual', label: 'Двоколірний (Dual / 2-Color)' },
                  { id: 'rainbow', label: 'Веселка (Rainbow Gradient)' },
                  { id: 'glow', label: 'Люмінесцентний (Glow)' },
                  { id: 'marble', label: 'Мармур (Marble)' },
                ].map((ct) => (
                  <button
                    key={ct.id}
                    type="button"
                    onClick={() => {
                      setFormColorType(ct.id as ColorType);
                      if (ct.id === 'rainbow' && (!formColorName || formColorName === 'Чорний')) {
                        setFormColorName('Веселка (Rainbow)');
                      } else if (ct.id === 'dual' && (!formColorName || formColorName === 'Чорний')) {
                        setFormColorName('Двоколірний Silk Dual');
                      }
                    }}
                    className={`px-2.5 py-1 text-xs rounded-lg border font-medium cursor-pointer transition-colors ${
                      formColorType === ct.id
                        ? 'bg-neutral-900 text-white dark:bg-emerald-600 border-transparent font-bold'
                        : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400'
                    }`}
                  >
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Назва кольору *"
                value={formColorName}
                onChange={(e) => setFormColorName(e.target.value)}
                placeholder="e.g. Silk Dual Золото-Синій / Веселка (Rainbow)"
                required
              />

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
            </div>

            {/* Visual Color Palette Picker for primary color */}
            <div>
              <label className="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">
                {formColorType === 'dual' ? 'Перший колір нитки:' : 'Візуальний вибір кольору:'}
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { hex: '#111827', name: 'Чорний' },
                  { hex: '#ffffff', name: 'Білий' },
                  { hex: '#64748b', name: 'Сірий' },
                  { hex: '#ef4444', name: 'Червоний' },
                  { hex: '#3b82f6', name: 'Синій' },
                  { hex: '#10b981', name: 'Зелений' },
                  { hex: '#eab308', name: 'Жовтий' },
                  { hex: '#f97316', name: 'Помаранчевий' },
                  { hex: '#8b5cf6', name: 'Фіолетовий' },
                  { hex: '#d97706', name: 'Бронза / Золото' },
                ].map((preset) => (
                  <button
                    key={preset.hex}
                    type="button"
                    title={preset.name}
                    onClick={() => {
                      setFormColorHex(preset.hex);
                      if (!formColorName || formColorName === 'Чорний') {
                        setFormColorName(preset.name);
                      }
                    }}
                    className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer hover:scale-110 shadow-2xs ${
                      formColorHex.toLowerCase() === preset.hex.toLowerCase()
                        ? 'border-emerald-600 ring-2 ring-emerald-500/30 scale-110'
                        : 'border-white dark:border-neutral-800'
                    }`}
                    style={{ backgroundColor: preset.hex }}
                  />
                ))}

                <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer ml-2">
                  <input
                    type="color"
                    value={formColorHex}
                    onChange={(e) => setFormColorHex(e.target.value)}
                    className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                  />
                  <span className="text-[11px] font-medium">Палітра</span>
                </label>
              </div>
            </div>

            {/* Secondary Color Picker when Dual color is selected */}
            {formColorType === 'dual' && (
              <div className="pt-2 border-t border-neutral-200 dark:border-neutral-700/80">
                <label className="block text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">
                  Другий колір ко-екструзії (Dual):
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { hex: '#2563eb', name: 'Синій' },
                    { hex: '#db2777', name: 'Малиновий' },
                    { hex: '#f59e0b', name: 'Золотий' },
                    { hex: '#10b981', name: 'Смарагдовий' },
                    { hex: '#9333ea', name: 'Пурпуровий' },
                    { hex: '#111827', name: 'Чорний' },
                  ].map((preset) => (
                    <button
                      key={preset.hex}
                      type="button"
                      title={preset.name}
                      onClick={() => setFormSecondaryHex(preset.hex)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer hover:scale-110 shadow-2xs ${
                        formSecondaryHex.toLowerCase() === preset.hex.toLowerCase()
                          ? 'border-emerald-600 ring-2 ring-emerald-500/30 scale-110'
                          : 'border-white dark:border-neutral-800'
                      }`}
                      style={{ backgroundColor: preset.hex }}
                    />
                  ))}

                  <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer ml-2">
                    <input
                      type="color"
                      value={formSecondaryHex}
                      onChange={(e) => setFormSecondaryHex(e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-[11px] font-medium">Палітра другого кольору</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* DIRECT STORE LINK & SPOOL PRICE (1 СИЛКА) */}
          <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl border border-neutral-200 dark:border-neutral-700 space-y-3">
            <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block">
              Пряме посилання на товар та ціна (1 силка):
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Пряме посилання на товар (URL)"
                value={formStoreUrl}
                onChange={(e) => setFormStoreUrl(e.target.value)}
                placeholder="https://plexiwire.com.ua/shop/..."
              />

              <Input
                label="Назва магазину / продавця"
                value={formStoreName}
                onChange={(e) => setFormStoreName(e.target.value)}
                placeholder="e.g. Plexiwire Офіційний / 3D-Format"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
              <Input
                label="Ціна за цю конкретну котушку (грн)"
                type="number"
                value={String(formSpoolPrice || '')}
                onChange={(e) => setFormSpoolPrice(parseFloat(e.target.value) || 0)}
                placeholder="600"
              />

              <div className="p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-xs">
                <span className="text-neutral-500 block text-[10px]">Розрахована ціна за 1 кг:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {Math.round(((formSpoolPrice || 0) / (filamentForm.spoolWeightGrams || 1000)) * 1000)} грн / кг
                </span>
              </div>
            </div>
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

      {/* MODAL: ADD / EDIT TEMPERATURE PROFILE */}
      <Modal
        isOpen={isTempModalOpen}
        onClose={() => setIsTempModalOpen(false)}
        title={isCreatingNewTemp ? 'Додати новий температурний стандарт' : `Редагування стандарту: ${editingTempType}`}
        description="Параметри температур за замовчуванням для розрахунку та каталогу."
        maxWidth="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsTempModalOpen(false)}>
              Скасувати
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSaveTemp}>
              {isCreatingNewTemp ? 'Створити стандарт' : 'Зберегти профіль'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {isCreatingNewTemp && (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Ключ типу пластику (e.g. PETG, PC, PVA) *"
                value={newTempTypeKey}
                onChange={(e) => setNewTempTypeKey(e.target.value.toUpperCase())}
                placeholder="PC"
                required
              />
              <Input
                label="Повна назва матеріалу"
                value={tempForm.plasticType || ''}
                onChange={(e) => setTempForm({ ...tempForm, plasticType: e.target.value })}
                placeholder="PC (Полікарбонат)"
              />
            </div>
          )}

          <Input
            label="Діапазон сопла (°C) *"
            value={tempForm.nozzleRange || ''}
            onChange={(e) => setTempForm({ ...tempForm, nozzleRange: e.target.value })}
            placeholder="190–225 °C"
            required
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

      {/* MODAL: ADD / EDIT PLASTIC TYPE */}
      <Modal
        isOpen={isPlasticTypeModalOpen}
        onClose={() => setIsPlasticTypeModalOpen(false)}
        title={editingPlasticTypeOriginal ? `Редагувати тип пластику: ${editingPlasticTypeOriginal}` : 'Додати новий тип пластику'}
        description="Тип полімеру для класифікації у калькуляторі та фільтрації каталогу."
        maxWidth="md"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setIsPlasticTypeModalOpen(false)}>
              Скасувати
            </Button>
            <Button variant="primary" size="sm" leftIcon={<Save className="w-4 h-4" />} onClick={handleSavePlasticType}>
              {editingPlasticTypeOriginal ? 'Зберегти зміни' : 'Створити тип'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label="Назва типу пластику (e.g. PLA, PETG, ABS, PC, ASA) *"
            value={plasticTypeFormName}
            onChange={(e) => setPlasticTypeFormName(e.target.value.toUpperCase())}
            placeholder="PETG"
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1">
                Група складності
              </label>
              <select
                value={plasticTypeFormFamily}
                onChange={(e) => setPlasticTypeFormFamily(e.target.value as any)}
                className="w-full py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 font-medium"
              >
                <option value="Стандартні">Стандартні</option>
                <option value="Інженерні">Інженерні</option>
                <option value="Гнучкі">Гнучкі</option>
                <option value="Композитні">Композитні</option>
                <option value="Підтримки">Підтримки</option>
              </select>
            </div>

            <Input
              label="Густина полімеру (г/см³)"
              type="number"
              step="0.01"
              value={plasticTypeFormDensity}
              onChange={(e) => setPlasticTypeFormDensity(parseFloat(e.target.value) || 1.24)}
              placeholder="1.24"
            />
          </div>

          <Input
            label="Опис та властивості"
            value={plasticTypeFormDescription}
            onChange={(e) => setPlasticTypeFormDescription(e.target.value)}
            placeholder="Короткий опис для підказок у калькуляторі"
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
