import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Filter,
  Copy,
  Trash2,
  ExternalLink,
  Plus,
  AlertCircle,
  Clock,
  Layers,
} from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Input } from '../../components/common/Input.tsx';
import { StatusBadge } from '../../components/common/StatusBadge.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { formatUah, formatDurationUk, formatWeightUk } from '../../domain/formatters.ts';

export const CalculationsHistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { calculations, duplicateCalculation, deleteCalculation } = useAppData();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredCalculations = useMemo(() => {
    return calculations.filter((c) => {
      const matchesSearch =
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.fileName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.clientName && c.clientName.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus =
        statusFilter === 'all' || c.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [calculations, searchQuery, statusFilter]);

  const totalPages = Math.ceil(filteredCalculations.length / itemsPerPage) || 1;
  const paginatedCalculations = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredCalculations.slice(start, start + itemsPerPage);
  }, [filteredCalculations, currentPage, itemsPerPage]);

  const handleDuplicate = async (id: string) => {
    const copy = await duplicateCalculation(id);
    navigate(`/app/calculations/${copy.id}`);
  };

  const confirmDelete = async () => {
    if (deletingId) {
      await deleteCalculation(deletingId);
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Історія розрахунків
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Архів розрахунків собівартості із зафіксованими знімками параметрів
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={() => navigate('/app/calculator')}
        >
          Новий розрахунок
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-neutral-900 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xs">
        <div className="w-full sm:w-80">
          <Input
            placeholder="Пошук за назвою або файлом..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            leftAddon={<Search className="w-4 h-4" />}
          />
        </div>

        {/* Status segmented buttons */}
        <div className="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-800 rounded-lg self-stretch sm:self-auto">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('all');
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            Всі ({calculations.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('complete');
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              statusFilter === 'complete'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            Готові ({calculations.filter((c) => c.status === 'complete').length})
          </button>
          <button
            type="button"
            onClick={() => {
              setStatusFilter('incomplete');
              setCurrentPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              statusFilter === 'incomplete'
                ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-2xs font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
            }`}
          >
            Чернетки ({calculations.filter((c) => c.status === 'incomplete').length})
          </button>
        </div>
      </div>

      {/* Calculations Table */}
      <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 uppercase font-semibold border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="py-2.5 px-4">Назва розрахунку</th>
                <th className="py-2.5 px-4">Дата збереження</th>
                <th className="py-2.5 px-4">Матеріали</th>
                <th className="py-2.5 px-4">Маса / Час</th>
                <th className="py-2.5 px-4 text-right">Собівартість</th>
                <th className="py-2.5 px-4 text-right">Ціна клієнту</th>
                <th className="py-2.5 px-4 text-center">Статус</th>
                <th className="py-2.5 px-4 text-right min-w-[120px]">Дії</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {paginatedCalculations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-neutral-500">
                    Жодного розрахунку не знайдено за вибраними фільтрами
                  </td>
                </tr>
              ) : (
                paginatedCalculations.map((c) => {
                  const uniqueMaterials = Array.from(
                    new Set(c.input.filaments.map((f) => f.typeFromFile))
                  ).join(', ');

                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-semibold text-neutral-900 dark:text-white max-w-xs truncate">
                          {c.title}
                        </p>
                        <p className="text-[11px] text-neutral-500 font-mono max-w-xs truncate">
                          {c.fileName}
                        </p>
                      </td>

                      <td className="py-3 px-4 text-neutral-500 whitespace-nowrap">
                        {new Date(c.createdAt).toLocaleDateString('uk-UA', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>

                      <td className="py-3 px-4 text-neutral-700 dark:text-neutral-300 font-mono text-[11px]">
                        {uniqueMaterials || '—'}
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums whitespace-nowrap">
                        <div className="text-neutral-900 dark:text-white font-medium">
                          {formatWeightUk(c.result.totalWeightGrams)}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {formatDurationUk(c.result.totalDurationSeconds)}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                        {formatUah(c.result.costPriceUah)}
                      </td>

                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {formatUah(c.result.sellingPriceUah)}
                      </td>

                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <StatusBadge status={c.status} />
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => navigate(`/app/calculations/${c.id}`)}
                            title="Переглянути деталі розрахунку"
                            className="p-1.5 text-neutral-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDuplicate(c.id)}
                            title="Створити копію"
                            className="p-1.5 text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingId(c.id)}
                            title="Видалити розрахунок"
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

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-xs text-neutral-500">
            <span>
              Сторінка {currentPage} з {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Попередня
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Наступна
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Delete */}
      <Modal
        isOpen={Boolean(deletingId)}
        onClose={() => setDeletingId(null)}
        title="Видалити збережений розрахунок?"
        description="Цю дію неможливо скасувати. Запис буде вилучено з локальної історії розрахунків."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>
              Скасувати
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete}>
              Видалити запис
            </Button>
          </>
        }
      >
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Ви впевнені, що бажаєте видалити цей розрахунок собівартості?
        </p>
      </Modal>
    </div>
  );
};
