import React, { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Copy,
  Edit2,
  Archive,
  Layers,
  Trash2,
  AlertCircle,
  CheckCircle,
  BookOpen,
  Scale,
  Coins,
  Package,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import type { MaterialProfile } from '../../domain/types.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { MaterialModal } from '../../components/materials/MaterialModal.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { formatUah } from '../../domain/formatters.ts';

export const MaterialsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    materials,
    addMaterial,
    updateMaterial,
    duplicateMaterial,
    archiveMaterial,
    deleteMaterial,
    actionError,
  } = useAppData();

  const [searchQuery, setSearchQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialProfile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const busy = useRef(false);

  const runAction = async (operation: () => Promise<unknown>) => {
    if (busy.current) return false;
    busy.current = true;
    setIsPending(true);
    try { await operation(); return true; }
    catch { return false; /* The shared context displays the error. */ }
    finally { busy.current = false; setIsPending(false); }
  };

  const families = useMemo(() => {
    const list = new Set(materials.map((m) => m.family || 'Стандартні'));
    return Array.from(list);
  }, [materials]);

  // Overall Inventory Stats (Auto-calculated)
  const inventoryStats = useMemo(() => {
    let totalGrams = 0;
    let totalValueUah = 0;
    let inStockItemsCount = 0;

    materials.forEach((m) => {
      if (m.isArchived) return;
      const count = m.spoolsInStock ?? 1;
      const spoolGrams = parseFloat(m.spoolWeightGrams || '1000') || 1000;
      const spoolPrice = parseFloat(m.spoolPriceUah || m.pricePerKgUah || '0') || 0;

      if (count > 0) {
        totalGrams += count * spoolGrams;
        totalValueUah += count * spoolPrice;
        inStockItemsCount += 1;
      }
    });

    return {
      totalWeightKg: (totalGrams / 1000).toFixed(2),
      totalValueUah,
      inStockItemsCount,
    };
  }, [materials]);

  const filteredMaterials = useMemo(() => {
    return materials.filter((m) => {
      if (!showArchived && m.isArchived) return false;
      if (showArchived && !m.isArchived) return false;

      const matchesSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.brand.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesFamily = familyFilter === 'all' || m.family === familyFilter;

      return matchesSearch && matchesFamily;
    });
  }, [materials, searchQuery, familyFilter, showArchived]);

  const handleOpenAdd = () => {
    setEditingMaterial(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (m: MaterialProfile) => {
    setEditingMaterial(m);
    setIsModalOpen(true);
  };

  const handleSaveMaterial = async (data: Omit<MaterialProfile, 'id' | 'createdAt'>) => {
    if (editingMaterial) {
      await updateMaterial(editingMaterial.id, data);
    } else {
      await addMaterial(data);
    }
  };

  const confirmDelete = async () => {
    if (deletingId) {
      if (await runAction(() => deleteMaterial(deletingId))) setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Склад та матеріали майстерні
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Введіть вагу в кг та ціну — наявність, вартість за кг, грам та сума розраховуються автоматично
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<BookOpen className="w-4 h-4" />}
            onClick={() => navigate('/filaments')}
            title="Переглянути відкритий довідник філаментів та імпортувати готові профілі"
          >
            Довідник філаментів
          </Button>

          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={handleOpenAdd}
          >
            Додати позицію
          </Button>
        </div>
      </div>

      {/* Auto-Calculated Inventory Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Загальна вага на складі</span>
            <Scale className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-1.5">
            {inventoryStats.totalWeightKg} кг
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            сумарний запас філаменту
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Вартість матеріалів складу</span>
            <Coins className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1.5">
            {formatUah(inventoryStats.totalValueUah)}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            капітал у запасах котушок
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-2xs">
          <div className="flex items-center justify-between text-neutral-500 dark:text-neutral-400 text-xs">
            <span>Позицій в наявності</span>
            <Package className="w-4 h-4 text-blue-600" />
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-neutral-900 dark:text-white mt-1.5">
            {inventoryStats.inStockItemsCount}
          </p>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            готових для друку матеріалів
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
        <div className="w-full sm:w-80">
          <Input
            placeholder="Пошук за назвою, типом чи брендом..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftAddon={<Search className="w-4 h-4" />}
          />
        </div>

        <div className="flex items-center gap-3 self-stretch sm:self-auto flex-wrap">
          {/* Family selector */}
          <select
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
            className="py-2 px-3 text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white focus:outline-none"
          >
            <option value="all">Усі сімейства</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          {/* Archived toggle */}
          <label className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded text-emerald-600 focus:ring-emerald-500 border-neutral-300"
            />
            <span>Показати архів</span>
          </label>
        </div>
      </div>

      {/* Materials Table with Auto-Calculated Availability & Cost */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase font-semibold border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2.5 px-4">Колір</th>
                <th className="py-2.5 px-4">Матеріал / Позиція</th>
                <th className="py-2.5 px-4">Тип / Бренд</th>
                <th className="py-2.5 px-4 text-right">Одиниця (вага / ціна)</th>
                <th className="py-2.5 px-4 text-center">Наявність на складі</th>
                <th className="py-2.5 px-4 text-right">Вартість (собівартість)</th>
                <th className="py-2.5 px-4 text-right min-w-[130px]">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {filteredMaterials.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-neutral-500">
                    Не знайдено матеріалів у вибраній категорії
                  </td>
                </tr>
              ) : (
                filteredMaterials.map((m) => {
                  const hasPrice = m.pricePerKgUah !== null && m.pricePerKgUah !== '';
                  const spoolWeightGrams = parseFloat(m.spoolWeightGrams || '1000') || 1000;
                  const spoolWeightKg = spoolWeightGrams / 1000;
                  const spoolPrice = parseFloat(m.spoolPriceUah || m.pricePerKgUah || '0') || 0;
                  const inStockCount = m.spoolsInStock ?? 1;
                  const totalKg = (inStockCount * spoolWeightGrams) / 1000;
                  const totalValue = inStockCount * spoolPrice;
                  const pricePerGram = spoolWeightGrams > 0 ? spoolPrice / spoolWeightGrams : 0;

                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      {/* Color chip */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-4 h-4 rounded-full border border-neutral-300 dark:border-neutral-700 shadow-xs shrink-0"
                            style={{ backgroundColor: m.colorHex || '#94a3b8' }}
                            title={m.colorName || m.colorHex}
                          />
                        </div>
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4">
                        <p className="font-semibold text-neutral-900 dark:text-white">
                          {m.name}
                        </p>
                        {m.colorName && (
                          <p className="text-[11px] text-neutral-500">{m.colorName}</p>
                        )}
                        {m.notes && (
                          <p className="text-[10px] text-neutral-400 italic truncate max-w-xs">{m.notes}</p>
                        )}
                      </td>

                      {/* Type & Brand */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 font-mono font-bold text-neutral-800 dark:text-neutral-200">
                            {m.type}
                          </span>
                          <span className="text-neutral-600 dark:text-neutral-400 text-[11px]">
                            {m.brand}
                          </span>
                        </div>
                        <div className="text-[10px] text-neutral-400 mt-0.5">
                          {m.family || 'Стандартні'}
                        </div>
                      </td>

                      {/* Unit Parameters: Weight in kg & Price */}
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-neutral-900 dark:text-white">
                          {spoolWeightKg} кг ({spoolWeightGrams} г)
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {formatUah(spoolPrice)}
                        </div>
                      </td>

                      {/* Availability (Calculated automatically) */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="inline-flex flex-col items-center gap-1">
                          {inStockCount === 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                              Немає на складі
                            </span>
                          ) : totalKg < 0.5 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                              Закінчується ({totalKg.toFixed(2)} кг)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                              В наявності ({totalKg.toFixed(2)} кг)
                            </span>
                          )}
                          <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400 font-mono">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => runAction(() =>
                                updateMaterial(m.id, {
                                  spoolsInStock: Math.max(0, inStockCount - 1),
                                })
                              )}
                              title="Зменшити залишок на 1 котушку"
                              className="w-4 h-4 rounded flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 font-bold"
                            >
                              -
                            </button>
                            <span className="font-semibold">{inStockCount} котуш.</span>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => runAction(() =>
                                updateMaterial(m.id, {
                                  spoolsInStock: inStockCount + 1,
                                })
                              )}
                              title="Додати 1 котушку на склад"
                              className="w-4 h-4 rounded flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 font-bold"
                            >
                              +
                            </button>
                            <span>· {inStockCount * spoolWeightGrams} г</span>
                          </div>
                        </div>
                      </td>

                      {/* Cost & Price (Calculated automatically) */}
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {hasPrice ? (
                          <>
                            <div className="font-bold text-emerald-700 dark:text-emerald-400">
                              {formatUah(m.pricePerKgUah)}/кг
                            </div>
                            <div className="text-[10px] text-neutral-500">
                              {pricePerGram > 0 ? `${pricePerGram.toFixed(3)} грн/г` : '—'}
                            </div>
                            <div className="text-[10px] text-neutral-400">
                              Запас: {formatUah(totalValue)}
                            </div>
                          </>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400 text-[11px] font-medium flex items-center justify-end gap-1">
                            <AlertCircle className="w-3.5 h-3.5" />
                            <span>Не задано</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(m)}
                            title="Редагувати"
                            className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(() => duplicateMaterial(m.id))}
                            disabled={isPending}
                            title="Дублювати"
                            className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => runAction(() => archiveMaterial(m.id))}
                            disabled={isPending}
                            title={m.isArchived ? 'Відновити з архіву' : 'Архівувати'}
                            className="p-1.5 text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(m.id)}
                            title="Видалити"
                            className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Material Modal */}
      <MaterialModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveMaterial}
        initialMaterial={editingMaterial}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingId)}
        onClose={() => { if (!isPending) setDeletingId(null); }}
        title="Видалити профіль матеріалу?"
        description="Цей матеріал буде вилучено з вашого каталогу. Попередні збережені знімки розрахунків збережуть свої значення."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)} disabled={isPending}>
              Скасувати
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} isLoading={isPending}>
              Видалити матеріал
            </Button>
          </>
        }
      >
        <p className="text-xs text-neutral-500">
          Ви впевнені, що хочете видалити цей матеріал? Дія незворотна для майбутніх розрахунків.
        </p>
        {actionError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
      </Modal>
    </div>
  );
};
