import React, { useId } from 'react';
import { NumberInput } from '../common/NumberInput.tsx';
import { Button } from '../common/Button.tsx';
import { createTaxPreset, TAX_PRESET_RESEARCHED_DATE, TAX_SOURCE_URLS, type TaxSettings } from '../../domain/taxes.ts';

interface TaxSettingsPanelProps { value: TaxSettings; onChange: (value: TaxSettings) => void; disabled?: boolean }
const regimes: Record<TaxSettings['regime'], string> = { fop1: 'ФОП 1 група', fop2: 'ФОП 2 група', fop3: 'ФОП 3 група', general: 'ФОП на загальній системі', manual: 'Ручні ставки та база' };
const selectClass = 'w-full px-3 py-2 text-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white disabled:opacity-50';

export const TaxSettingsPanel: React.FC<TaxSettingsPanelProps> = ({ value, onChange, disabled = false }) => {
  const id = useId();
  const monthlyTax = ['fop1', 'fop2', 'manual'].includes(value.regime);
  const explicitBase = value.regime === 'general' || value.regime === 'manual';
  const canPayVat = value.regime !== 'fop1' && value.regime !== 'fop2';
  const applyPreset = (regime = value.regime) => {
    const preset = createTaxPreset(regime, canPayVat && !['fop1', 'fop2'].includes(regime) ? value.vatPayer : false);
    onChange({ ...preset, enabled: value.enabled, scenario: value.scenario, customerPriceUah: value.customerPriceUah,
      netTaxableIncomeUah: value.netTaxableIncomeUah, monthlyOrders: value.monthlyOrders,
      monthlyBillableHours: value.monthlyBillableHours, allocationMode: value.allocationMode });
  };
  const number = (key: keyof TaxSettings, label: string, unit: string, max?: number, presetRate = false) => <NumberInput id={`${id}-${key}`} label={label} value={value[key] as string | null} onChange={next => onChange({ ...value, [key]: next })} unit={unit} min={0} max={max} disabled={disabled || presetRate} />;

  return <section className="p-5 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-4">
    <label className="flex items-center gap-2 text-sm font-semibold text-neutral-900 dark:text-white"><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} disabled={disabled} />Враховувати податки та ПДВ</label>
    {!value.enabled && <p className="text-xs text-neutral-500">Податкова оцінка вимкнена. Ціна та прибуток розраховуються без цього блоку.</p>}
    {value.enabled && <fieldset disabled={disabled} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs space-y-1.5"><span>Податковий режим</span><select aria-label="Податковий режим" className={selectClass} value={value.regime} onChange={event => applyPreset(event.target.value as TaxSettings['regime'])}>{Object.entries(regimes).map(([regime, title]) => <option key={regime} value={regime}>{title}</option>)}</select></label>
        <label className="text-xs space-y-1.5"><span>Сценарій ціни</span><select aria-label="Сценарій ціни" className={selectClass} value={value.scenario} onChange={event => onChange({ ...value, scenario: event.target.value as TaxSettings['scenario'] })}><option value="cover">Підібрати ціну з покриттям платежів і прибутком</option><option value="estimate">Оцінити платежі для заданої ціни клієнту</option></select></label></div>
      <p className="text-xs text-neutral-500">{value.scenario === 'cover' ? 'Націнка визначає бажаний прибуток після врахованих платежів. Цільова маржа — його частка у виручці без ПДВ. Мінімум та округлення застосовуються до кінцевої ціни.' : 'Вкажіть кінцеву ціну клієнту, включно з ПДВ, якщо ви платник. Мінімум та округлення не змінюють задану ціну; націнка й цільова маржа тут не задають результат.'}</p>
      {value.scenario === 'estimate' && <NumberInput id={`${id}-customer-price`} label="Задана ціна клієнту з ПДВ, якщо застосовується" value={value.customerPriceUah} onChange={next => onChange({ ...value, customerPriceUah: next.trim() || null })} unit="грн" min={0} disabled={disabled} />}
      <div className="space-y-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={value.vatPayer} onChange={event => onChange({ ...value, vatPayer: event.target.checked, unifiedTaxPercent: value.regime === 'fop3' ? event.target.checked ? '3' : '5' : value.unifiedTaxPercent })} disabled={disabled || !canPayVat} />Платник ПДВ</label>
        {!canPayVat && <p className="text-xs text-neutral-500">Для пресетів ФОП 1/2 групи ПДВ не застосовується.</p>}
        {value.vatPayer && <div className="sm:max-w-xs">{number('vatRatePercent', 'Ставка ПДВ продажу', '%', 100)}</div>}
        {value.vatPayer && <p className="text-xs text-neutral-500">Показуємо ПДВ у ціні продажу. Це не сума сплати до бюджету: податковий кредит тут не ведеться.</p>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {(value.regime === 'fop3' || value.regime === 'manual') && number('unifiedTaxPercent', value.regime === 'manual' ? 'Податок від виручки без ПДВ' : 'Єдиний податок від доходу без ПДВ', '%', 100, value.regime !== 'manual')}
        {explicitBase && number('incomeTaxPercent', 'ПДФО від явно заданої бази', '%', 100, value.regime !== 'manual')}
        {(!monthlyTax || value.regime === 'manual') && number('militaryTaxPercent', value.regime === 'fop3' ? 'Військовий збір від доходу без ПДВ' : 'Військовий збір від явно заданої бази', '%', 100, value.regime !== 'manual')}
      </div>
      {value.regime === 'fop3' && <p className="text-xs text-neutral-500">Пресет: ЄП 5% без ПДВ або 3% з ПДВ. Для іншої моделі ставок використайте ручний режим.</p>}
      {value.regime === 'general' && <p className="text-xs text-neutral-500">Пресет: ПДФО 18% та військовий збір 5% від явно заданої бази. Для інших ставок використайте ручний режим.</p>}
      {explicitBase && <div className="space-y-2"><NumberInput id={`${id}-net-taxable-income`} label="Чистий оподатковуваний дохід цього замовлення" value={value.netTaxableIncomeUah} onChange={next => onChange({ ...value, netTaxableIncomeUah: next.trim() || null })} unit="грн" disabled={disabled} helperText="Вкажіть базу з урахуванням документально підтверджених витрат. Виробничу собівартість автоматично не використовуємо як цю базу." />
        <p className="text-xs text-neutral-500">Нуль або від’ємна база не утворює від’ємного податку. Без бази та з ненульовими ставками розрахунок буде неповним.</p></div>}
      <div className="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-4"><h4 className="text-sm font-semibold">Місячні платежі та їх частка у замовленні</h4>
        <div className="grid sm:grid-cols-2 gap-3">
          {monthlyTax && number('monthlyUnifiedTaxUah', 'Єдиний податок за місяць', 'грн')}
          {monthlyTax && number('monthlyMilitaryTaxUah', 'Військовий збір за місяць', 'грн')}
          {number('monthlyEsvUah', 'ЄСВ за місяць', 'грн')}
          {number('monthlyOtherUah', 'Інші місячні платежі', 'грн')}
        </div>
        <p className="text-xs text-neutral-500">ЄСВ у пресеті — припущення про мінімальний місячний внесок. На загальній системі фактичний внесок за вашою базою може бути більшим. Вкажіть власну суму; пільгу або звільнення задайте явно значенням 0.</p>
        <div className="grid sm:grid-cols-2 gap-3"><label className="text-xs space-y-1.5"><span>Розподіл місячних платежів</span><select aria-label="Розподіл місячних платежів" className={selectClass} value={value.allocationMode} onChange={event => onChange({ ...value, allocationMode: event.target.value as TaxSettings['allocationMode'] })}><option value="orders">Порівну на замовлення</option><option value="hours">За годинами друку</option></select></label>
          {value.allocationMode === 'orders' ? number('monthlyOrders', 'Очікувана кількість замовлень за місяць', 'шт', 1e9) : number('monthlyBillableHours', 'Оплачувані години друку за місяць', 'год', 1e9)}</div>
        <p className="text-xs text-neutral-500">Частка фіксованих платежів додається один раз на замовлення. За годинами враховуємо час усіх вибраних пластин із повторами.</p>
      </div>
      <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 space-y-2"><div className="flex flex-wrap justify-between items-center gap-2"><p className="text-xs text-neutral-500">Пресет {value.presetVersion}, чинний з {value.presetEffectiveDate}. Джерела перевірено {TAX_PRESET_RESEARCHED_DATE}.</p><Button type="button" variant="outline" size="sm" onClick={() => applyPreset()} disabled={disabled}>Відновити ставки пресета</Button></div>
        <p className="text-xs text-neutral-500">Місячні суми можна скоригувати; довільні відсоткові ставки задаються у ручному режимі. Вибір групи не підтверджує дозволеність діяльності. Це оцінка ціни замовлення; податкова декларація тут не формується.</p>
        <div className="flex flex-wrap gap-3 text-xs">{TAX_SOURCE_URLS.map((url, index) => <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline">ДПС: {index === 0 ? 'спрощена система' : 'загальна система'}</a>)}</div></div>
    </fieldset>}
  </section>;
};
