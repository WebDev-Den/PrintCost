import React, { useState } from 'react';
import { Copy, Check, MessageSquare, Send } from 'lucide-react';
import { Modal } from '../common/Modal.tsx';
import { Button } from '../common/Button.tsx';
import type { CalculationSnapshot } from '../../domain/types.ts';
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
  };
}

export const ClientQuoteModal: React.FC<ClientQuoteModalProps> = ({
  isOpen,
  onClose,
  calcSnapshot,
}) => {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);

  const materialsList = Array.from(new Set(calcSnapshot.filaments.map((f) => f.typeFromFile))).join(', ');

  const quoteText = `Розрахунок вартості 3D-друку:
— Проєкт: ${calcSnapshot.fileName}
— Матеріал: ${materialsList || 'FDM/FFF пластик'}
— Орієнтовна маса деталей: ${formatWeightUk(calcSnapshot.totalWeightGrams)}
— Орієнтовний час виготовлення: ${formatDurationUk(calcSnapshot.totalDurationSeconds)}
— Вартість замовлення: ${formatUah(calcSnapshot.sellingPriceUah)}

${user?.workshopName ? `Майстерня: ${user.workshopName}` : ''}
З повагою, ${user?.fullName || 'команда 3D-друку'}.`;

  const handleCopy = () => {
    navigator.clipboard.writeText(quoteText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Пропозиція для клієнта"
      description="Чистий комерційний текст без внутрішньої собівартості, тарифів та маржі майстерні."
      maxWidth="lg"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose}>
            Закрити
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={copied ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
            onClick={handleCopy}
          >
            {copied ? 'Скопійовано в буфер' : 'Скопіювати текст'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
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
