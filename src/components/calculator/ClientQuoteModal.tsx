import React, { useState } from 'react';
import { Copy, Check, FileDown, Printer } from 'lucide-react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import type { TaxResult } from '../../domain/taxes.ts';
import { formatUah, formatWeightUk, formatDurationUk } from '../../domain/formatters.ts';
import { useAuth } from '../../context/AuthContext.tsx';

interface ClientQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  calcSnapshot: {
    fileName: string;
    sellingPriceUah: string;
    totalWeightGrams: string;
    totalDurationSeconds: number;
    filaments: Array<{ typeFromFile: string; colorHex?: string }>;
    tax?: Pick<TaxResult, 'netRevenueUah' | 'vatUah' | 'grossPriceUah'> & { vatPayer: boolean };
  };
}

export const ClientQuoteModal: React.FC<ClientQuoteModalProps> = ({
  isOpen,
  onClose,
  calcSnapshot,
}) => {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialsList = Array.from(new Set(calcSnapshot.filaments.map((f) => f.typeFromFile))).join(', ');
  const priceText = calcSnapshot.tax?.vatPayer ? `— Вартість без ПДВ: ${formatUah(calcSnapshot.tax.netRevenueUah)}\n— ПДВ продажу: ${formatUah(calcSnapshot.tax.vatUah)}\n— Усього до сплати: ${formatUah(calcSnapshot.tax.grossPriceUah)}`
    : `— Вартість замовлення: ${formatUah(calcSnapshot.tax?.grossPriceUah || calcSnapshot.sellingPriceUah)}${calcSnapshot.tax ? '\n— ПДВ не застосовується' : ''}`;

  const quoteText = `Розрахунок вартості 3D-друку:
— Проєкт: ${calcSnapshot.fileName}
— Матеріал: ${materialsList || 'FDM/FFF пластик'}
— Орієнтовна маса деталей: ${formatWeightUk(calcSnapshot.totalWeightGrams)}
— Орієнтовний час виготовлення: ${formatDurationUk(calcSnapshot.totalDurationSeconds)}
${priceText}

${user?.workshopName ? `Майстерня: ${user.workshopName}` : ''}
З повагою, ${user?.fullName || 'команда 3D-друку'}.`;

  const handleCopy = async () => {
    setError(null);
    try { await navigator.clipboard.writeText(quoteText); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Не вдалося скопіювати текст. Виділіть його та скопіюйте вручну.'); }
  };
  const handleDownload = () => {
    const url = URL.createObjectURL(new Blob([quoteText], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'kilog-client-quote.txt'; link.click();
    URL.revokeObjectURL(url);
  };
  const handlePrint = () => {
    setError(null);
    const printWindow = window.open('', '_blank');
    if (!printWindow) { setError('Браузер заблокував вікно друку. Дозвольте спливні вікна або завантажте текст пропозиції.'); return; }
    const escaped = quoteText.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
    printWindow.opener = null;
    printWindow.document.write(`<!doctype html><html lang="uk"><head><meta charset="utf-8"><title>Пропозиція 3D-друку</title></head><body><pre style="white-space:pre-wrap;font:16px/1.6 sans-serif">${escaped}</pre></body></html>`);
    printWindow.document.close(); printWindow.focus(); printWindow.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Пропозиція для клієнта"
      description="Чистий комерційний текст без внутрішньої собівартості, тарифів та маржі майстерні."
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Закрити
          </Button>
          <Button variant="outline" size="sm" leftIcon={<FileDown className="w-4 h-4" />} onClick={handleDownload}>Завантажити TXT</Button>
          <Button variant="outline" size="sm" leftIcon={<Printer className="w-4 h-4" />} onClick={handlePrint}>Друк / PDF</Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
            onClick={handleCopy}
          >
            {copied ? 'Скопійовано в буфер' : 'Скопіювати текст'}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/60 rounded-lg border border-neutral-200 dark:border-neutral-700">
          <pre className="font-sans text-xs whitespace-pre-wrap text-neutral-800 dark:text-neutral-200 leading-relaxed select-all">
            {quoteText}
          </pre>
        </div>

        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          Цей текст можна відправити клієнту в Telegram, Viber, Instagram або електронною поштою.
        </p>
      </div>
    </Modal>
  );
};
