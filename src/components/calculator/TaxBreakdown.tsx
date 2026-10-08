import React from 'react';
import type { TaxResult } from '../../domain/taxes.ts';
import { formatUah } from '../../domain/formatters.ts';

export const TaxBreakdown: React.FC<{ tax: TaxResult }> = ({ tax }) => {
  const fixedMonthly = tax.regime === 'fop1' || tax.regime === 'fop2';
  const rows: Array<[string, string]> = [
    ['Ціна без ПДВ / виручка', tax.netRevenueUah], ['ПДВ продажу', tax.vatUah], ['Ціна клієнту з ПДВ, якщо застосовується', tax.grossPriceUah],
    [fixedMonthly ? 'ЄП: частка місячного платежу' : 'ЄП / податок від виручки без ПДВ', tax.unifiedTaxUah],
    [fixedMonthly ? 'Військовий збір: частка місячного платежу' : tax.regime === 'fop3' ? 'Військовий збір від виручки без ПДВ' : 'Військовий збір від заданої бази', tax.militaryTaxUah], ['ПДФО від заданої бази', tax.incomeTaxUah],
    ['У складі ЄП: частка місячного платежу', tax.allocatedUnifiedTaxUah], ['У складі військового збору: частка місячного платежу', tax.allocatedMilitaryTaxUah],
    ['Частка місячного ЄСВ', tax.allocatedEsvUah], ['Частка інших місячних платежів', tax.allocatedOtherUah],
    ['Враховані податки без ПДВ продажу', tax.totalTaxesUah], ['Податки, ЄСВ та інші враховані платежі', tax.totalPaymentsUah],
    ['Прибуток до врахованих платежів', tax.profitBeforeTaxUah], ['Прибуток після врахованих платежів', tax.profitAfterTaxUah],
  ];
  return <section className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 space-y-3">
    <h4 className="text-sm font-semibold text-neutral-900 dark:text-white">Податкова оцінка</h4>
    <dl className="space-y-2 text-xs">{rows.map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt className="text-neutral-600 dark:text-neutral-400">{label}</dt><dd className="font-mono font-semibold text-neutral-900 dark:text-white shrink-0">{formatUah(amount)}</dd></div>)}
      <div className="flex justify-between gap-3"><dt>Маржа після платежів / виручка без ПДВ</dt><dd className="font-mono font-semibold shrink-0">{tax.marginAfterTaxPercent}%</dd></div>
      {tax.netTaxableIncomeUah !== null && <div className="flex justify-between gap-3"><dt>Явно задана оподатковувана база</dt><dd className="font-mono shrink-0">{formatUah(tax.netTaxableIncomeUah)}</dd></div>}
    </dl>
    <p className="text-[11px] text-neutral-500">ПДВ продажу наведено окремо; він не є обчисленням сплати до бюджету. Пресет {tax.presetVersion}, чинний з {tax.presetEffectiveDate}.</p>
    <div className="flex flex-wrap gap-2 text-[11px]">{tax.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline">Джерело ДПС {index + 1}</a>)}</div>
  </section>;
};
