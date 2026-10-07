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
} from 'lucide-react';
import { PublicNavbar } from '../../components/layout/PublicNavbar.tsx';
import { Footer } from '../../components/layout/Footer.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import {
  PublicFilamentItem,
  ManufacturerBrand,
  ColorTone,
  COLOR_TONES_CONFIG,
  getFilamentEffectiveTemp,
} from '../../domain/filamentsDirectory.ts';
import { catalogAdminRepository } from '../../services/catalogAdminRepository.ts';
import { useAppData } from '../../context/AppDataContext.tsx';
import { formatUah } from '../../domain/formatters.ts';
import { SpoolCalculatorWidget } from '../../components/calculator/SpoolCalculatorWidget.tsx';
import { FilamentDirectoryCard } from '../../components/filaments/FilamentDirectoryCard.tsx';

export const FilamentsDirectoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { addMaterial } = useAppData();

  // Load dynamic data from catalog repository (allowing admin updates to reflect here)
  const [filaments, setFilaments] = useState<PublicFilamentItem[]>([]);
  const [manufacturers, setManufacturers] = useState<ManufacturerBrand[]>([]);
  const [tempProfiles, setTempProfiles] = useState<Record<string, any>>({});
  const [likedIds, setLikedIds] = useState<string[]>([]);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedManufacturer, setSelectedManufacturer] = useState<string>('all');
  const [selectedColorTone, setSelectedColorTone] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [likesOnlyFilter, setLikesOnlyFilter] = useState(false);
  const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'name' | 'color' | 'likes'>('price_asc');

  const [activeTab, setActiveTab] = useState<'catalog' | 'manufacturers' | 'temperatures'>('catalog');
  const [addedMaterialId, setAddedMaterialId] = useState<string | null>(null);
  const [showSpoolCalcBanner, setShowSpoolCalcBanner] = useState(false);

  // Refresh data on mount
  useEffect(() => {
    setFilaments(catalogAdminRepository.getFilaments());
    setManufacturers(catalogAdminRepository.getManufacturers());
    setTempProfiles(catalogAdminRepository.getTemperatureProfiles());
    setLikedIds(catalogAdminRepository.getLikedFilamentIds());
  }, []);

  // Distinct plastic types available
  const plasticTypes = useMemo(() => {
    const types = Array.from(new Set(filaments.map((f) => f.type)));
    return ['all', ...types];
  }, [filaments]);

  // Manufacturers map for quick lookup
  const manufacturerMap = useMemo(() => {
    const map = new Map<string, ManufacturerBrand>();
    manufacturers.forEach((m) => map.set(m.id, m));
    return map;
  }, [manufacturers]);

  // Toggle user like / favorite
  const handleToggleLike = (filamentId: string) => {
    catalogAdminRepository.toggleLike(filamentId);
    setLikedIds(catalogAdminRepository.getLikedFilamentIds());
  };

  // Filtered and Sorted filaments
  const filteredFilaments = useMemo(() => {
    const result = filaments.filter((f) => {
      // 1. Search Query
      const matchesSearch =
        f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.brand.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        f.description.toLowerCase().includes(searchQuery.toLowerCase());

      // 2. Plastic Type Filter (Primary)
      const matchesType = selectedType === 'all' || f.type === selectedType;

      // 3. Manufacturer Filter
      const matchesManufacturer =
        selectedManufacturer === 'all' || f.manufacturerId === selectedManufacturer;

      // 4. Color Tone Filter
      const matchesColor =
        selectedColorTone === 'all' ||
        f.primaryColorTone === selectedColorTone ||
        f.popularColors?.some((c) => c.colorTone === selectedColorTone);

      // 5. Stock Status Filter
      const matchesStock =
        stockFilter === 'all' ||
        (stockFilter === 'in_stock' && f.inStock) ||
        (stockFilter === 'out_of_stock' && !f.inStock);

      // 6. Likes Only Filter
      const matchesLikes = !likesOnlyFilter || likedIds.includes(f.id);

      return (
        matchesSearch &&
        matchesType &&
        matchesManufacturer &&
        matchesColor &&
        matchesStock &&
        matchesLikes
      );
    });

    // Sorting logic
    return result.sort((a, b) => {
      if (sortBy === 'price_asc') {
        return a.approxPricePerKgUah - b.approxPricePerKgUah;
      }
      if (sortBy === 'price_desc') {
        return b.approxPricePerKgUah - a.approxPricePerKgUah;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'uk');
      }
      if (sortBy === 'color') {
        return (a.primaryColorTone || '').localeCompare(b.primaryColorTone || '');
      }
      if (sortBy === 'likes') {
        const aLiked = likedIds.includes(a.id) ? 1 : 0;
        const bLiked = likedIds.includes(b.id) ? 1 : 0;
        return bLiked - aLiked;
      }
      return 0;
    });
  }, [
    filaments,
    searchQuery,
    selectedType,
    selectedManufacturer,
    selectedColorTone,
    stockFilter,
    likesOnlyFilter,
    sortBy,
    likedIds,
  ]);

  const handleAddMaterialToWorkshop = async (
    filament: PublicFilamentItem,
    selectedColorName?: string,
    selectedColorHex?: string
  ) => {
    const tempInfo = getFilamentEffectiveTemp(filament);
    const resolvedColorName = selectedColorName || filament.popularColors[0]?.name || 'Основний';
    const resolvedColorHex = selectedColorHex || filament.popularColors[0]?.hex || '#1e293b';
    const finalName = selectedColorName
      ? `${filament.brand} ${filament.type} (${selectedColorName})`
      : filament.name;

    await addMaterial({
      name: finalName,
      type: filament.type,
      family: filament.family,
      brand: filament.brand,
      colorHex: resolvedColorHex,
      colorName: resolvedColorName,
      pricePerKgUah: String(filament.approxPricePerKgUah),
      spoolWeightGrams: String(filament.spoolWeightGrams),
      spoolPriceUah: String(Math.round((filament.approxPricePerKgUah * filament.spoolWeightGrams) / 1000)),
      isArchived: false,
      notes: `Виробник: ${filament.brand}. Температура сопла: ${tempInfo.nozzle}, стіл: ${tempInfo.bed}. ${
        tempInfo.isCustom ? '(Профіль виробника)' : '(Стандартний температурний профіль)'
      }. Колір: ${resolvedColorName}. Додано з каталогу KILO·G.`,
    });

    setAddedMaterialId(filament.id);
    setTimeout(() => setAddedMaterialId(null), 2500);
  };

  const handleCalculatePrint = (filament: PublicFilamentItem, color?: any) => {
    const resolvedColorName = color?.name || filament.popularColors[0]?.name || 'Основний';
    const spoolGrams = filament.spoolWeightGrams;
    const spoolPrice = Math.round((filament.approxPricePerKgUah * spoolGrams) / 1000);

    sessionStorage.setItem(
      'kilog_preselect_material',
      JSON.stringify({
        filamentId: filament.id,
        name: color ? `${filament.brand} ${filament.type} (${resolvedColorName})` : filament.name,
        type: filament.type,
        brand: filament.brand,
        colorHex: color?.hex || filament.popularColors[0]?.hex || '#1e293b',
        colorName: resolvedColorName,
        pricePerKgUah: filament.approxPricePerKgUah.toString(),
        spoolWeightGrams: spoolGrams.toString(),
        spoolPriceUah: spoolPrice.toString(),
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

              {/* Quick Admin Dashboard Link */}
              <NavLink
                to="/app/admin/catalog"
                className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-emerald-600 dark:hover:text-emerald-400 bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors"
                title="Панель адміністратора каталогу"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Панель адміністратора</span>
              </NavLink>
            </div>

            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-neutral-900 dark:text-white">
                  Каталог пластиків та виробників 3D-друку
                </h1>
                <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-300 max-w-3xl leading-relaxed mt-2">
                  Фільтруйте за <strong>типом пластику</strong> та <strong>кольором</strong>, відстежуйте <strong>статус наявності</strong>, ставте <strong>лайки ❤️</strong> у вибране та використовуйте готові профілі температур для друку.
                </p>
              </div>

              {/* Navigation Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-xl text-xs shrink-0 self-start md:self-auto">
                <button
                  type="button"
                  onClick={() => setActiveTab('catalog')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                    activeTab === 'catalog'
                      ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-bold'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                  }`}
                >
                  Філаменти ({filaments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('manufacturers')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
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
                  className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
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
            {/* Interactive Spool Calculator Tool Banner */}
            <div className="bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 sm:p-5 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Disc className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                      <span>Калькулятор котушок та перерахунку за кг</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 font-semibold">
                        Швидкий розрахунок
                      </span>
                    </h3>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Введіть масу котушки (250г, 500г, 750г, 1000г, 2500г) та ціну — сервіс миттєво обчислить собівартість за 1 кг та за 1 грам.
                    </p>
                  </div>
                </div>

                <Button
                  variant={showSpoolCalcBanner ? 'outline' : 'primary'}
                  size="sm"
                  onClick={() => setShowSpoolCalcBanner(!showSpoolCalcBanner)}
                  className="self-start sm:self-auto shrink-0"
                >
                  {showSpoolCalcBanner ? 'Згорнути калькулятор' : 'Розрахувати котушку та ціну за кг'}
                </Button>
              </div>

              {showSpoolCalcBanner && (
                <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800">
                  <SpoolCalculatorWidget
                    title="Розрахунок вартості котушок і ціни за 1 кг"
                    description="Вкажіть параметри закупівлі котушок або партії пластику для точного розрахунку."
                    onApplyToRate={() => navigate('/app/calculator')}
                  />
                </div>
              )}
            </div>

            {/* Filter Toolbar Card */}
            <div className="bg-white dark:bg-neutral-900 p-4 sm:p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 space-y-4 shadow-2xs">
              {/* Row 1: Search, Manufacturer & Stock Status */}
              <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                <div className="w-full lg:w-80">
                  <Input
                    placeholder="Пошук (PLA, Plexiwire, eSUN, Bambu)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    leftAddon={<Search className="w-4 h-4 text-neutral-400" />}
                  />
                </div>

                <div className="flex items-center gap-2.5 flex-wrap">
                  {/* Manufacturer selector */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-500 whitespace-nowrap">
                      Виробник:
                    </label>
                    <select
                      value={selectedManufacturer}
                      onChange={(e) => setSelectedManufacturer(e.target.value)}
                      className="py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
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
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs text-neutral-500 whitespace-nowrap">
                      Наявність:
                    </label>
                    <select
                      value={stockFilter}
                      onChange={(e) => setStockFilter(e.target.value as any)}
                      className="py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="all">Всі статуси</option>
                      <option value="in_stock">✅ Тільки в наявності</option>
                      <option value="out_of_stock">⚠️ Немає в наявності</option>
                    </select>
                  </div>

                  {/* Sort selector */}
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5 text-neutral-400" />
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="py-1.5 px-2.5 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-medium focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="price_asc">Ціна: від низької</option>
                      <option value="price_desc">Ціна: від високої</option>
                      <option value="color">Сортування за кольором</option>
                      <option value="name">За назвою (А-Я)</option>
                      <option value="likes">Спочатку улюблені (❤️)</option>
                    </select>
                  </div>

                  {/* Likes Filter Button */}
                  <button
                    type="button"
                    onClick={() => setLikesOnlyFilter(!likesOnlyFilter)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border ${
                      likesOnlyFilter
                        ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                        : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:text-neutral-900'
                    }`}
                    title="Показати тільки обрані філаменти"
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${
                        likesOnlyFilter ? 'fill-rose-600 text-rose-600' : 'text-neutral-400'
                      }`}
                    />
                    <span>Обрані ({likedIds.length})</span>
                  </button>
                </div>
              </div>

              {/* Row 2: PRIMARY FILTER - Plastic Types */}
              <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-neutral-500 flex items-center gap-1.5 mr-1">
                  <Filter className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Тип пластику:</span>
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {plasticTypes.map((typeKey) => {
                    const count =
                      typeKey === 'all'
                        ? filaments.length
                        : filaments.filter((f) => f.type === typeKey).length;
                    const isSelected = selectedType === typeKey;

                    return (
                      <button
                        key={typeKey}
                        type="button"
                        onClick={() => setSelectedType(typeKey)}
                        className={`px-3 py-1 text-xs rounded-lg font-mono font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
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

              {/* Row 3: Color Palette Filter */}
              <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-neutral-500 flex items-center gap-1.5 mr-1">
                  <Palette className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Колір філаменту:</span>
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setSelectedColorTone('all')}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                      selectedColorTone === 'all'
                        ? 'bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900 font-bold'
                        : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    Всі кольори
                  </button>

                  {(Object.keys(COLOR_TONES_CONFIG) as ColorTone[]).map((toneKey) => {
                    const cfg = COLOR_TONES_CONFIG[toneKey];
                    const isSelected = selectedColorTone === toneKey;

                    return (
                      <button
                        key={toneKey}
                        type="button"
                        onClick={() => setSelectedColorTone(toneKey)}
                        className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 border ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 font-bold'
                            : 'border-transparent bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                        }`}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-neutral-300 dark:border-neutral-600"
                          style={{ backgroundColor: cfg.hex }}
                        />
                        <span>{cfg.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Filaments Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredFilaments.length === 0 ? (
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
                filteredFilaments.map((f) => (
                  <FilamentDirectoryCard
                    key={f.id}
                    filament={f}
                    manufacturer={manufacturerMap.get(f.manufacturerId)}
                    isLiked={likedIds.includes(f.id)}
                    onToggleLike={handleToggleLike}
                    onAddToWorkshop={handleAddMaterialToWorkshop}
                    isAdded={addedMaterialId === f.id}
                    activeColorToneFilter={selectedColorTone}
                    onCalculatePrint={handleCalculatePrint}
                    onSelectType={(t) => setSelectedType(t)}
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

      <Footer />
    </div>
  );
};
