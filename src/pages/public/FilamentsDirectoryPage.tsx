import React, { useState, useEffect, useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Search,
  ExternalLink,
  Plus,
  Thermometer,
  Gauge,
  ShoppingCart,
  Check,
  ArrowRight,
  Filter,
  Sparkles,
  Building2,
  Globe,
  Flame,
  Heart,
  Palette,
  CheckCircle2,
  XCircle,
  SlidersHorizontal,
  ArrowUpDown,
  Lock,
  Disc,
  RefreshCw,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PublicNavbar } from '../../components/layout/PublicNavbar.tsx';
import { Footer } from '../../components/layout/Footer.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import {
  PublicFilamentItem,
  ManufacturerBrand,
  TemperatureProfile,
  ColorTone,
  COLOR_TONES_CONFIG,
  PackagingType,
  ConcreteFilamentSku,
  buildConcreteFilamentSkus,
} from '../../domain/filamentsDirectory.ts';
import { catalogAdminRepository } from '../../services/catalogAdminRepository.ts';
import { api, STORAGE_KEYS } from '../../services/api.ts';
import { useAppData } from '../../context/AppDataContext.tsx';
import { formatUah } from '../../domain/formatters.ts';
import { FilamentDirectoryCard } from '../../components/filaments/FilamentDirectoryCard.tsx';
import { FilamentDetailsModal } from '../../components/filaments/FilamentDetailsModal.tsx';

export const FilamentsDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { addMaterial } = useAppData();

  // Load dynamic data from catalog repository (allowing admin updates to reflect here)
  const [filaments, setFilaments] = useState<PublicFilamentItem[]>([]);
  const [manufacturers, setManufacturers] = useState<ManufacturerBrand[]>([]);
  const [tempProfiles, setTempProfiles] = useState<Record<string, any>>({});
  const [likedIds, setLikedIds] = useState<string[]>([]);

  // Detailed Product Modal Popup State
  const [selectedSkuForModal, setSelectedSkuForModal] = useState<ConcreteFilamentSku | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);

  const handleOpenDetails = (sku: ConcreteFilamentSku) => {
    setSelectedSkuForModal(sku);
    setIsDetailsModalOpen(true);
  };

  const handleCloseDetails = () => {
    setIsDetailsModalOpen(false);
    setSelectedSkuForModal(null);
  };

  // Toggle hiding the filter toolbar / menu (persisted in localStorage)
  const [filtersHidden, setFiltersHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.FILTERS_HIDDEN) === 'true';
    } catch {
      return false;
    }
  });

  const toggleFiltersHidden = () => {
    setFiltersHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEYS.FILTERS_HIDDEN, String(next));
      } catch {}
      return next;
    });
  };

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('all');
  const [selectedColorTone, setSelectedColorTone] = useState<string>('all');
  const [packagingFilter, setPackagingFilter] = useState<'all' | 'spool' | 'refill'>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [likesOnlyFilter, setLikesOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'name' | 'color' | 'likes'>('price_asc');

  const [activeTab, setActiveTab] = useState<'catalog' | 'manufacturers' | 'temperatures'>('catalog');
  const [addedMaterialId, setAddedMaterialId] = useState<string | null>(null);

  // Active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchQuery.trim()) count++;
    if (selectedType !== 'all') count++;
    if (selectedManufacturer !== 'all') count++;
    if (selectedColorTone !== 'all') count++;
    if (packagingFilter !== 'all') count++;
    if (stockFilter !== 'all') count++;
    if (likesOnlyFilter) count++;
    return count;
  }, [
    searchQuery,
    selectedType,
    selectedManufacturer,
    selectedColorTone,
    packagingFilter,
    stockFilter,
    likesOnlyFilter,
  ]);

  // Refresh data on mount
  useEffect(() => {
    // Load from repository / api
    setFilaments(catalogAdminRepository.getFilaments());
    setManufacturers(catalogAdminRepository.getManufacturers());
    setTempProfiles(catalogAdminRepository.getTemperatureProfiles());
    setLikedIds(catalogAdminRepository.getLikedFilamentIds());

    // Background sync via api
    api.filaments.getAll().then((data) => {
      if (data && data.length > 0) setFilaments(data);
    }).catch(() => {});
    api.manufacturers.getAll().then((data) => {
      if (data && data.length > 0) setManufacturers(data);
    }).catch(() => {});
  }, []);

  // Build concrete 1-card-1-item SKUs (1 card = 1 weight, 1 color, 1 manufacturer, 1 profile, 1 direct store link)
  const concreteSkus = useMemo(() => {
    return buildConcreteFilamentSkus(filaments);
  }, [filaments]);

  // Distinct plastic types available across concrete SKUs
  const plasticTypes = useMemo(() => {
    const types = Array.from(new Set(concreteSkus.map((s) => s.type)));
    return ['all', ...types];
  }, [concreteSkus]);

  // Manufacturers map for quick lookup
  const manufacturerMap = useMemo(() => {
    const map = new Map<string, ManufacturerBrand>();
    manufacturers.forEach((m) => map.set(m.id, m));
    return map;
  }, [manufacturers]);

  // Toggle user like / favorite
  const handleToggleLike = (id: string) => {
    catalogAdminRepository.toggleLike(id);
    setLikedIds(catalogAdminRepository.getLikedFilamentIds());
  };

  // Filtered and Sorted concrete SKU cards
  const filteredSkus = useMemo(() => {
    const result = concreteSkus.filter((sku) => {
      // 1. Search Query
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        sku.name.toLowerCase().includes(q) ||
        sku.brand.toLowerCase().includes(q) ||
        sku.type.toLowerCase().includes(q) ||
        sku.colorName.toLowerCase().includes(q) ||
        sku.packagingLabel.toLowerCase().includes(q) ||
        (q === 'рефіл' || q === 'refill' ? sku.packagingType === 'refill' : false) ||
        (q === 'котушка' || q === 'з котушкою' ? sku.packagingType === 'spool' : false) ||
        sku.storeName.toLowerCase().includes(q) ||
        sku.description.toLowerCase().includes(q);

      // 2. Plastic Type Filter
      const matchesType = selectedType === 'all' || sku.type === selectedType;

      // 3. Manufacturer Filter
      const matchesManufacturer =
        selectedManufacturer === 'all' || sku.manufacturerId === selectedManufacturer;

      // 4. Color Tone Filter (exact 1 color tone match)
      const matchesColor =
        selectedColorTone === 'all' || sku.colorTone === selectedColorTone;

      // 5. Packaging Filter (З котушкою vs Рефіл)
      const matchesPackaging =
        packagingFilter === 'all' || sku.packagingType === packagingFilter;

      // 6. Stock Status Filter
      const matchesStock =
        stockFilter === 'all' ||
        (stockFilter === 'in_stock' && sku.inStock) ||
        (stockFilter === 'out_of_stock' && !sku.inStock);

      // 7. Likes Only Filter
      const matchesLikes =
        !likesOnlyFilter ||
        likedIds.includes(sku.id) ||
        likedIds.includes(sku.parentFilamentId);

      return (
        matchesSearch &&
        matchesType &&
        matchesManufacturer &&
        matchesColor &&
        matchesPackaging &&
        matchesStock &&
        matchesLikes
      );
    });

    // Sorting logic
    return result.sort((a, b) => {
      if (sortBy === 'price_asc') {
        return a.priceUah - b.priceUah;
      }
      if (sortBy === 'price_desc') {
        return b.priceUah - a.priceUah;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'uk');
      }
      if (sortBy === 'color') {
        return (a.colorTone || '').localeCompare(b.colorTone || '');
      }
      if (sortBy === 'likes') {
        const aLiked = likedIds.includes(a.id) || likedIds.includes(a.parentFilamentId) ? 1 : 0;
        const bLiked = likedIds.includes(b.id) || likedIds.includes(b.parentFilamentId) ? 1 : 0;
        return bLiked - aLiked;
      }
      return 0;
    });
  }, [
    concreteSkus,
    searchQuery,
    selectedType,
    selectedManufacturer,
    selectedColorTone,
    stockFilter,
    likesOnlyFilter,
    sortBy,
    likedIds,
  ]);

  const handleAddMaterialToWorkshop = async (sku: ConcreteFilamentSku) => {
    await addMaterial({
      name: sku.name,
      type: sku.type,
      family: sku.family,
      brand: sku.brand,
      colorHex: sku.colorHex,
      colorName: sku.colorName,
      pricePerKgUah: String(sku.calculatedPricePerKg),
      spoolWeightGrams: String(sku.spoolWeightGrams),
      spoolPriceUah: String(sku.priceUah),
      spoolsInStock: 1,
      isArchived: false,
      notes: `Виробник: ${sku.brand}. Колір: ${sku.colorName}. Вага: ${sku.weightKgDisplay}. Сопло: ${sku.profileNozzle}, Стіл: ${sku.profileBed}. Магазин: ${sku.storeName}. Посилання: ${sku.storeUrl}. Додано з каталогу KILO·G.`,
    });

    setAddedMaterialId(sku.id);
    setTimeout(() => setAddedMaterialId(null), 2500);
  };

  const handleCalculatePrint = (sku: ConcreteFilamentSku) => {
    sessionStorage.setItem(
      'kilog_preselect_material',
      JSON.stringify({
        filamentId: sku.id,
        name: sku.name,
        type: sku.type,
        brand: sku.brand,
        colorHex: sku.colorHex,
        colorName: sku.colorName,
        pricePerKgUah: String(sku.calculatedPricePerKg),
        spoolWeightGrams: String(sku.spoolWeightGrams),
        spoolPriceUah: String(sku.priceUah),
      })
    );
    navigate('/app/calculator');
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 antialiased">
      <PublicNavbar />

      <main className="flex-1">
        {/* Header Hero Section */}
        <section className="bg-white dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800 py-10 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                <span>Відкритий каталог пластиків KILO·G</span>
              </div>

              {/* Quick Admin & Add Filament Link */}
              <div className="flex items-center gap-2">
                <NavLink
                  to="/app/admin/catalog"
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:text-emerald-600 dark:hover:text-emerald-400 bg-white dark:bg-neutral-800 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors shadow-2xs font-bold"
                  title="Додати новий філамент або бренд"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>+ Додати позицію / бренд</span>
                </NavLink>

                <NavLink
                  to="/app/admin/catalog"
                  className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 bg-neutral-100 dark:bg-neutral-800/80 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors"
                  title="Панель адміністратора каталогу"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Адмінка</span>
                </NavLink>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-neutral-900 dark:text-white">
                  Каталог пластиків та виробників 3D-друку
                </h1>
                <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-300 max-w-3xl leading-relaxed mt-2">
                  Кожна картка — це одна конкретна позиція: <strong>1 виробник</strong>, <strong>1 колір</strong>, <strong>1 вага котушки</strong>, <strong>1 профіль друку</strong> та <strong>1 пряме посилання</strong> на сторінку товару продавця.
                </p>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl text-xs shrink-0 self-start md:self-auto overflow-x-auto no-scrollbar max-w-full">
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    activeTab === 'catalog'
                      ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                  }`}
                >
                  Каталог карток ({concreteSkus.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('manufacturers')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    activeTab === 'manufacturers'
                      ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  Виробники ({manufacturers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('temperatures')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                    activeTab === 'temperatures'
                      ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-amber-500" />
                  Температурні стандарти
                </button>
              </div>
            </div>

            {/* Universal Slicer Support Notice */}
            <div className="p-3 bg-neutral-100/80 dark:bg-neutral-800/60 rounded-xl border border-neutral-200/80 dark:border-neutral-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-neutral-600 dark:text-neutral-300">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Сумісність:</strong> KILO·G підтримує <strong>будь-який файл нарізки .gcode.3mf</strong> з Bambu Studio, OrcaSlicer, PrusaSlicer, Creality Print, Elegoo Slicer.
                </span>
              </div>
              <NavLink
                to="/app/calculator"
                className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap flex items-center gap-1 self-end sm:self-auto"
              >
                <span>Розрахувати собівартість</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </NavLink>
            </div>
          </div>
        </section>

        {/* TAB 1: FILAMENTS CATALOG */}
        {activeTab === 'catalog' && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            {/* Filter Toolbar Header & Toggle Bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-neutral-900 dark:text-white">
                  Знайдено позицій: {filteredSkus.length}
                </span>
                {activeFiltersCount > 0 && (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    Активних фільтрів: {activeFiltersCount}
                  </span>
                )}
              </div>

              {/* Hide / Show Filters Menu Button */}
              <div className="flex items-center gap-2">
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedType('all');
                      setSelectedManufacturer('all');
                      setSelectedColorTone('all');
                      setPackagingFilter('all');
                      setStockFilter('all');
                      setLikesOnlyFilter(false);
                      setSearchQuery('');
                    }}
                    className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white underline cursor-pointer"
                  >
                    Скинути фільтри
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleFiltersHidden}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-750 transition-colors shadow-2xs cursor-pointer"
                  title={filtersHidden ? 'Розгорнути фільтри' : 'Приховати фільтри'}
                >
                  {filtersHidden ? (
                    <>
                      <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Показати фільтри {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ''}</span>
                      <ChevronDown className="w-3.5 h-3.5 text-neutral-400" />
                    </>
                  ) : (
                    <>
                      <EyeOff className="w-3.5 h-3.5 text-neutral-500" />
                      <span>Приховати меню фільтрів</span>
                      <ChevronUp className="w-3.5 h-3.5 text-neutral-400" />
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Filter Toolbar Card (Collapsible) */}
            {!filtersHidden ? (
              <div className="bg-white dark:bg-neutral-900 p-4 sm:p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs transition-all">
                {/* Row 1: Responsive Grid for Search & Controls */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Search Box (Takes full width on mobile, 1 col on desktop) */}
                  <div className="sm:col-span-2 lg:col-span-1">
                    <Input
                      placeholder="Пошук (PLA, eSUN, Bambu)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      leftAddon={<Search className="w-4 h-4 text-neutral-400" />}
                    />
                  </div>

                  {/* Manufacturer selector */}
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500 block mb-1">
                      Виробник (Бренд):
                    </label>
                    <select
                      value={selectedManufacturer}
                      onChange={(e) => setSelectedManufacturer(e.target.value)}
                      className="w-full py-2 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="all">Усі виробники ({manufacturers.length})</option>
                      {manufacturers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Stock filter */}
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500 block mb-1">
                      Наявність:
                    </label>
                    <select
                      value={stockFilter}
                      onChange={(e) => setStockFilter(e.target.value as any)}
                      className="w-full py-2 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="all">Всі статуси</option>
                      <option value="in_stock">✅ Тільки в наявності</option>
                      <option value="out_of_stock">⚠️ Немає в наявності</option>
                    </select>
                  </div>

                  {/* Sort selector + Likes */}
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500 block mb-1">
                      Сортування:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="w-full py-2 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
                      >
                        <option value="price_asc">Ціна: від низької</option>
                        <option value="price_desc">Ціна: від високої</option>
                        <option value="color">За кольором</option>
                        <option value="name">За назвою (А-Я)</option>
                        <option value="likes">Спочатку обрані (❤️)</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => setLikesOnlyFilter(!likesOnlyFilter)}
                        className={`p-2 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors cursor-pointer border shrink-0 ${
                          likesOnlyFilter
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                            : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:text-neutral-900'
                        }`}
                        title="Показати тільки обрані філаменти"
                        aria-label="Обрані"
                      >
                        <Heart
                          className={`w-4 h-4 ${
                            likesOnlyFilter ? 'fill-rose-600 text-rose-600' : 'text-neutral-400'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Row 2: Plastic Types (Horizontally scrollable on mobile) */}
                <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-500 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Тип пластику:</span>
                    </span>
                    <span className="text-[10px] text-neutral-400 sm:hidden">
                      прокрутіть вбік →
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0 sm:flex-wrap">
                    {plasticTypes.map((typeKey) => {
                      const count =
                        typeKey === 'all'
                          ? concreteSkus.length
                          : concreteSkus.filter((s) => s.type === typeKey).length;
                      const isSelected = selectedType === typeKey;

                      return (
                        <button
                          key={typeKey}
                          type="button"
                          onClick={() => setSelectedType(typeKey)}
                          className={`px-3 py-1 text-xs rounded-lg font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
                            isSelected
                              ? 'bg-neutral-900 text-white dark:bg-emerald-600 dark:text-white font-bold shadow-2xs ring-1 ring-neutral-900 dark:ring-emerald-500'
                              : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                          }`}
                        >
                          <span>{typeKey === 'all' ? 'Всі типи' : typeKey}</span>
                          <span
                            className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-neutral-200/80 dark:bg-neutral-700/80 text-neutral-500 dark:text-neutral-400'
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Row 3: Color Palette (Horizontally scrollable on mobile) */}
                <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-neutral-500 flex items-center gap-1.5">
                      <Palette className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Колір філаменту:</span>
                    </span>
                    <span className="text-[10px] text-neutral-400 sm:hidden">
                      прокрутіть вбік →
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0 sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => setSelectedColorTone('all')}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                        selectedColorTone === 'all'
                          ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900 font-bold'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      Всі кольори ({concreteSkus.length})
                    </button>

                    {(Object.keys(COLOR_TONES_CONFIG) as ColorTone[]).map((toneKey) => {
                      const cfg = COLOR_TONES_CONFIG[toneKey];
                      const isSelected = selectedColorTone === toneKey;
                      const toneCount = concreteSkus.filter((s) => s.colorTone === toneKey).length;
                      if (toneCount === 0) return null;

                      return (
                        <button
                          key={toneKey}
                          type="button"
                          onClick={() => setSelectedColorTone(toneKey)}
                          className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                            isSelected
                              ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 font-bold'
                              : 'border-transparent bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                          }`}
                        >
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-neutral-300 dark:border-neutral-600 shrink-0"
                            style={
                              toneKey === 'multicolor'
                                ? {
                                    backgroundImage:
                                      'linear-gradient(135deg, #ef4444, #f97316, #eab308, #10b981, #3b82f6, #a855f7)',
                                  }
                                : { backgroundColor: cfg.hex }
                            }
                          />
                          <span>{cfg.label}</span>
                          <span className="text-[10px] opacity-60">({toneCount})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Row 4: Packaging Filter (З котушкою / Рефіл) */}
                <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-1.5">
                  <span className="text-xs font-bold text-neutral-500 flex items-center gap-1.5">
                    <Disc className="w-3.5 h-3.5 text-sky-500" />
                    <span>Фасування:</span>
                  </span>

                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0 sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => setPackagingFilter('all')}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer shrink-0 ${
                        packagingFilter === 'all'
                          ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900 font-bold'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      Всі типи ({concreteSkus.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setPackagingFilter('spool')}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                        packagingFilter === 'spool'
                          ? 'border-sky-600 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200 font-bold'
                          : 'border-transparent bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                      }`}
                    >
                      <Disc className="w-3.5 h-3.5 text-sky-600" />
                      <span>З котушкою</span>
                      <span className="text-[10px] opacity-70">
                        ({concreteSkus.filter((s) => s.packagingType === 'spool').length})
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPackagingFilter('refill')}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 border shrink-0 ${
                        packagingFilter === 'refill'
                          ? 'border-violet-600 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200 font-bold'
                          : 'border-transparent bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                      }`}
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-violet-600" />
                      <span>Рефіл / Refill</span>
                      <span className="text-[10px] opacity-70">
                        ({concreteSkus.filter((s) => s.packagingType === 'refill').length})
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Compact quick bar when filters are collapsed */
              <div className="p-3 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <Search className="w-4 h-4 text-neutral-400 shrink-0" />
                  <input
                    type="text"
                    placeholder="Швидкий пошук у каталозі..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full text-xs bg-transparent border-0 focus:outline-none focus:ring-0 text-neutral-900 dark:text-white placeholder:text-neutral-400"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-xs text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    >
                      Очистити
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={toggleFiltersHidden}
                  className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Розгорнути всі фільтри</span>
                </button>
              </div>
            )}

            {/* Filaments Grid: 1 card = 1 manufacturer, 1 color, 1 weight, 1 profile, 1 direct store link */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {filteredSkus.length === 0 ? (
                <div className="col-span-full py-16 text-center text-neutral-500 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-8">
                  Нічого не знайдено за вибраними фільтрами.
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedType('all');
                        setSelectedManufacturer('all');
                        setSelectedColorTone('all');
                        setPackagingFilter('all');
                        setStockFilter('all');
                        setLikesOnlyFilter(false);
                        setSearchQuery('');
                      }}
                    >
                      Скинути всі фільтри
                    </Button>
                  </div>
                </div>
              ) : (
                filteredSkus.map((sku) => (
                  <FilamentDirectoryCard
                    key={sku.id}
                    item={sku}
                    manufacturer={manufacturerMap.get(sku.manufacturerId)}
                    isLiked={likedIds.includes(sku.id) || likedIds.includes(sku.parentFilamentId)}
                    onToggleLike={handleToggleLike}
                    onAddToWorkshop={handleAddMaterialToWorkshop}
                    isAdded={addedMaterialId === sku.id}
                    onCalculatePrint={handleCalculatePrint}
                    onSelectType={(t) => setSelectedType(t)}
                    onOpenDetails={handleOpenDetails}
                  />
                ))
              )}
            </div>
          </section>
        )}

        {/* TAB 2: MANUFACTURERS LIST */}
        {activeTab === 'manufacturers' && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-4">
              <h2 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-emerald-600" />
                <span>Виробники філаментів (Компанії, логотипи та офіційні сайти)</span>
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-3xl">
                Прямий доступ до офіційних ресурсів заводів-виробників для завантаження технічних паспортів (TDS) та фірмових профілів.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {manufacturers.map((m) => {
                const filamentsByBrand = filaments.filter((f) => f.manufacturerId === m.id);

                return (
                  <div
                    key={m.id}
                    className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 space-y-4 shadow-2xs flex flex-col justify-between hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-12 h-12 rounded-xl ${m.logoBg} flex items-center justify-center font-black text-sm ${m.logoTextColor} tracking-tighter shadow-sm`}
                          >
                            {m.logoText}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-neutral-900 dark:text-white leading-tight">
                              {m.name}
                            </h3>
                            <span className="text-xs text-neutral-500 block mt-0.5 font-medium">
                              {m.country}
                            </span>
                          </div>
                        </div>

                        <a
                          href={m.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg bg-neutral-100 hover:bg-emerald-50 text-neutral-600 hover:text-emerald-600 dark:bg-neutral-800 dark:hover:bg-neutral-700 dark:text-neutral-300 transition-colors"
                          title={`Відкрити офіційний сайт ${m.website}`}
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>

                      <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                        {m.description}
                      </p>

                      <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                        <span className="text-neutral-500">Доступно в каталозі:</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {filamentsByBrand.length} позицій
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
                      <a
                        href={m.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full py-2 px-3 rounded-lg bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
                      >
                        <Globe className="w-3.5 h-3.5 text-neutral-500" />
                        <span>Офіційний сайт</span>
                      </a>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => {
                          setSelectedManufacturer(m.id);
                          setActiveTab('catalog');
                        }}
                      >
                        Переглянути філаменти виробника
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* TAB 3: STANDARD TEMPERATURE PROFILES */}
        {activeTab === 'temperatures' && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
            <div className="bg-white dark:bg-neutral-900 p-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-4">
              <h2 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-amber-500" />
                <span>Стандартні температурні профілі друку</span>
              </h2>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed max-w-3xl">
                Базові температурні стандарти для кожного полімеру. У системі KILO·G, якщо виробник не вказав індивідуальні параметри, автоматично застосовується цей еталонний профіль.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(tempProfiles).map(([typeKey, profile]: [string, any]) => (
                <div
                  key={typeKey}
                  className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 space-y-4 shadow-2xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black font-mono px-2.5 py-1 rounded bg-neutral-900 text-white dark:bg-emerald-600 dark:text-white">
                        {typeKey}
                      </span>
                      <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                        {profile.plasticType}
                      </span>
                    </div>

                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-medium border ${
                        profile.enclosureRequired
                          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                      }`}
                    >
                      {profile.enclosureRequired ? 'Потрібна закрита камера' : 'Відкрита зона друку'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                      <span className="text-[10px] text-neutral-500 flex items-center gap-1 font-medium">
                        <Thermometer className="w-3.5 h-3.5 text-red-500" /> Сопло (Hotend):
                      </span>
                      <span className="font-mono font-bold text-sm text-neutral-900 dark:text-white mt-0.5 block">
                        {profile.nozzleRange}
                      </span>
                    </div>

                    <div className="p-2.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                      <span className="text-[10px] text-neutral-500 flex items-center gap-1 font-medium">
                        <Gauge className="w-3.5 h-3.5 text-amber-500" /> Стіл (Bed):
                      </span>
                      <span className="font-mono font-bold text-sm text-neutral-900 dark:text-white mt-0.5 block">
                        {profile.bedRange}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-relaxed">
                    {profile.notes}
                  </p>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => {
                      setSelectedType(typeKey);
                      setActiveTab('catalog');
                    }}
                  >
                    Переглянути філаменти {typeKey} у каталозі
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* POPUP: Detailed Product Information Modal */}
      <FilamentDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={handleCloseDetails}
        sku={selectedSkuForModal}
        manufacturer={
          selectedSkuForModal
            ? manufacturerMap.get(selectedSkuForModal.manufacturerId)
            : undefined
        }
        isLiked={
          selectedSkuForModal
            ? likedIds.includes(selectedSkuForModal.id) ||
              likedIds.includes(selectedSkuForModal.parentFilamentId)
            : false
        }
        onToggleLike={handleToggleLike}
        onAddToWorkshop={handleAddMaterialToWorkshop}
        isAdded={
          selectedSkuForModal ? addedMaterialId === selectedSkuForModal.id : false
        }
        onCalculatePrint={handleCalculatePrint}
      />

      <Footer />
    </div>
  );
};
