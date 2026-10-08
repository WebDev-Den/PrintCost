import React, { useRef, useState } from 'react';
import { Plus, Printer, Edit2, Trash2, Check, Star, AlertCircle } from 'lucide-react';
import { useAppData } from '../../context/AppDataContext.tsx';
import type { PrinterProfile } from '../../domain/types.ts';
import { Button } from '../../components/common/Button.tsx';
import { PrinterModal } from '../../components/printers/PrinterModal.tsx';
import { Modal } from '../../components/common/Modal.tsx';
import { formatUah } from '../../domain/formatters.ts';

export const PrintersPage: React.FC = () => {
  const { printers, addPrinter, updatePrinter, deletePrinter, setDefaultPrinter, actionError } = useAppData();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrinter, setEditingPrinter] = useState<PrinterProfile | null>(null);
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

  const handleOpenAdd = () => {
    setEditingPrinter(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (p: PrinterProfile) => {
    setEditingPrinter(p);
    setIsModalOpen(true);
  };

  const handleSavePrinter = async (data: Omit<PrinterProfile, 'id' | 'createdAt'>) => {
    if (editingPrinter) {
      await updatePrinter(editingPrinter.id, data);
    } else {
      await addPrinter(data);
    }
  };

  const confirmDelete = async () => {
    if (deletingId) {
      if (await runAction(() => deletePrinter(deletingId))) setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
            Парк 3D-принтерів
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
            Налаштування потужності (Вт) та машинної ставки (грн/год) для розрахунку тривалості друку
          </p>
        </div>

        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus className="w-4 h-4" />}
          onClick={handleOpenAdd}
        >
          Додати принтер
        </Button>
      </div>

      {/* Info Notice about Average Printing Power & Electricity */}
      <div className="p-4 bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 rounded-xl flex items-start gap-3 text-xs text-neutral-600 dark:text-neutral-400">
        <AlertCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <div className="space-y-1 leading-relaxed">
          <p className="font-semibold text-neutral-900 dark:text-white">
            Як розраховуються витрати на роботу принтера:
          </p>
          <p>
            Середня потужність друку (зазвичай 80–130 Вт для закритого FDM столу) множиться на тривалість і ваш тариф електроенергії. Машинна ставка (грн/год) враховує знос ременів, підшипників, сопел та окупність станка окремо.
          </p>
        </div>
      </div>

      {/* Printers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {printers.map((p) => (
          <div
            key={p.id}
            className={`bg-white dark:bg-neutral-900 rounded-xl border p-5 space-y-4 shadow-2xs relative flex flex-col justify-between ${
              p.isDefault
                ? 'border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-500/20'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
                    <Printer className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                      {p.name}
                    </h3>
                    {p.modelId && (
                      <p className="text-xs text-neutral-500">{p.modelId}</p>
                    )}
                  </div>
                </div>

                {p.isDefault ? (
                  <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 shrink-0">
                    Типовий
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => runAction(() => setDefaultPrinter(p.id))}
                    disabled={isPending}
                    title="Зробити типовим"
                    className="text-xs text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400"
                  >
                    Зробити типовим
                  </button>
                )}
              </div>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-4">
                <div className="p-2 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                  <span className="text-[11px] text-neutral-500 block">Середня потужність:</span>
                  <span className="font-mono font-semibold text-neutral-900 dark:text-white">
                    {p.averagePowerWatts} Вт
                  </span>
                </div>

                <div className="p-2 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg">
                  <span className="text-[11px] text-neutral-500 block">Машинна ставка:</span>
                  <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatUah(p.machineHourlyRateUah)}/год
                  </span>
                </div>
              </div>

              <div className="text-[11px] text-neutral-500 pt-2">
                Режим вартості:{' '}
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {p.costCalculationMode === 'manual_rate'
                    ? 'Ручна ставка на годину'
                    : 'Амортизація за ресурсом'}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => handleOpenEdit(p)}
                className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs flex items-center gap-1"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Редагувати</span>
              </button>
              <button
                type="button"
                onClick={() => setDeletingId(p.id)}
                className="p-1.5 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Видалити</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Printer Modal */}
      <PrinterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSavePrinter}
        initialPrinter={editingPrinter}
      />

      {/* Confirmation Modal */}
      <Modal
        isOpen={Boolean(deletingId)}
        onClose={() => { if (!isPending) setDeletingId(null); }}
        title="Видалити принтер?"
        description="Цей принтер буде вилучено зі списку вашого обладнання."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)} disabled={isPending}>
              Скасувати
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} isLoading={isPending}>
              Видалити
            </Button>
          </>
        }
      >
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          Ви дійсно бажаєте видалити цей принтер?
        </p>
        {actionError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
      </Modal>
    </div>
  );
};
