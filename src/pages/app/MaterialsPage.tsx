import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import type { MaterialProfile } from '../../domain/types.ts';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { MaterialModal } from '../../components/materials/MaterialModal.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { formatUah } from '../../domain/formatters.ts';

export const MaterialsPage: React.FC = () => {
  const {
    materials,
    addMaterial,
    updateMaterial,
    duplicateMaterial,
    archiveMaterial,
    deleteMaterial,
  } = useAppData();

  const [searchQuery, setSearchQuery] = useState('');
  const [familyFilter, setFamilyFilter] = useState<string>('all');
  const [showArchived, setShowArchived] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialProfile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const families = useMemo(() => {
    const list = new Set(materials.map((m) => m.family || 'Стандартні'));
    return Array.from(list);
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
      await deleteMaterial(deletingId);
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Каталог матеріалів майстерні
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Профілі пластиків, закупівельні ціни за кг та колірна палітра для розрахунку собівартості
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={handleOpenAdd}
        >
          Додати матеріал
        </Button>
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

      {/* Materials Table */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase font-semibold border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2.5 px-4">Колір</th>
                <th className="py-2.5 px-4">Назва матеріалу</th>
                <th className="py-2.5 px-4">Тип</th>
                <th className="py-2.5 px-4">Сімейство</th>
                <th className="py-2.5 px-4">Бренд</th>
                <th className="py-2.5 px-4 text-right">Ціна за 1 кг</th>
                <th className="py-2.5 px-4 text-right min-w-[140px]">Дії</th>
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

                      {/* Type */}
                      <td className="py-3 px-4 font-mono font-medium">
                        <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800">
                          {m.type}
                        </span>
                      </td>

                      {/* Family */}
                      <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                        {m.family || 'Стандартні'}
                      </td>

                      {/* Brand */}
                      <td className="py-3 px-4 text-neutral-600 dark:text-neutral-400">
                        {m.brand}
                      </td>

                      {/* Price per Kg (Shows "Не задано" if missing) */}
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {hasPrice ? (
                          <span className="font-semibold text-neutral-900 dark:text-white">
                            {formatUah(m.pricePerKgUah)}/кг
                          </span>
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
                            className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateMaterial(m.id)}
                            title="Дублювати"
                            className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => archiveMaterial(m.id)}
                            title={m.isArchived ? 'Відновити з архіву' : 'Архівувати'}
                            className="p-1.5 text-neutral-500 hover:text-amber-600 dark:hover:text-amber-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(m.id)}
                            title="Видалити"
                            className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
        onClose={() => setDeletingId(null)}
        title="Видалити профіль матеріалу?"
        description="Цей матеріал буде вилучено з вашого каталогу. Попередні збережені знімки розрахунків збережуть свої значення."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>
              Скасувати
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete}>
              Видалити матеріал
            </Button>
          </>
        }
      >
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Ви дійсно бажаєте безповоротно видалити цей матеріал?
        </p>
      </Modal>
    </div>
  );
};
