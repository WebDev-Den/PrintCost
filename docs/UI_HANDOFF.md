# UI Handoff Specification — KILO·G

Історичний опис раннього інтерфейсу. Згадки Supabase, Vercel, OAuth і серверного парсера нижче не описують поточний застосунок. Актуальний стек Cloudflare Worker + Firebase Spark, права, перевірки й запуск описані в [README.md](../README.md), [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md) та [OPERATIONS.md](../OPERATIONS.md).

---

## 1. Загальний огляд проєкту

**KILO·G** (колишня робоча назва PrintCost) — це вебзастосунок для розрахунку собівартості та продажної ціни FDM/FFF 3D-друку на основі файлів проєктів Bambu Studio (`.gcode.3mf`). Гасло бренду: *«Кожен грам на своєму місці»*.

- **Frontend-стек**: React 19, TypeScript strict, Vite, React Router 7, Tailwind CSS v4, Decimal.js, Lucide Icons.
- **Цільове середовище**: Vercel.
- **Майбутній backend**: Supabase (Auth + PostgreSQL з Row Level Security) та серверний/Edge парсер метаданих `.gcode.3mf`.

---

## 2. Маршрути та навігація

### Публічні маршрути (`src/pages/public/`):
- `/` — Компактний лендинг з поясненням FDM-розрахунку, архітектури та кнопками входу і демо-доступу.
- `/auth/login` — Форма входу (email + password, показ/приховування пароля, прапорець Google OAuth).
- `/auth/register` — Реєстрація (перевірка пароля, повтор, перехід на Onboarding).
- `/auth/forgot-password` — Запит на відновлення пароля.
- `/auth/reset-password` — Встановлення нового пароля (з підтримкою стану `?expired=true`).
- `/auth/callback` — Екран обробки OAuth / Magic Link callback.
- `/auth/check-email` — Повідомлення про перевірку пошти після реєстрації.

### Кабінет майстерні (`src/pages/app/` під спільним `AppLayout`):
- `/app/dashboard` — Огляд майстерні, ключові метрики (розрахунки, матеріали, принтери, середній чек), попередження про незаповнені тарифи.
- `/app/calculator` — Головний робочий екран: завантаження `.gcode.3mf`, селектор пластин із повторами, таблиця зіставлення філаментів, швидкі перевизначення, плаваюча картка собівартості та ціни.
- `/app/calculations` — Історія розрахунків: пошук, фільтр за статусом (готовий/чернетка), дублювання, видалення, пагінація.
- `/app/calculations/:id` — Детальний перегляд розрахунку із зафіксованими тарифами на той момент та дією «Перерахувати за поточними тарифами» (створює новий знімок).
- `/app/materials` — Каталог матеріалів: додавання, редагування, архівування, дублювання, вбудований перерахунок ціни котушки у грн/кг.
- `/app/printers` — Парк принтерів: налаштування середньої потужності друку (Вт), вибір взаємовиключного режиму вартості години (ручна ставка або амортизація за ресурсом).
- `/app/settings` — Глобальні налаштування тарифу світла, націнки, цільової маржі, резерву браку, округлення та JSON експорт/імпорт.
- `/app/account` — Профіль оператора, зміна пароля, логаут, секція автоімпорту з локальної папки.
- `/app/onboarding` — 5-кроковий майстер початкового налаштування для нових користувачів.

---

## 3. Доменні моделі (`src/domain/types.ts`)

- `UserProfile`: ідентифікатор, пошта, ім'я оператора, назва майстерні.
- `MaterialProfile`: назва, тип (PETG, PLA, ABS, ASA, TPU, PA-CF...), сімейство, бренд, колірний код, ціна за 1 кг у UAH (`pricePerKgUah: string | null`), статус архіву.
- `PrinterProfile`: назва, model ID, середня потужність друку (`averagePowerWatts: string`), машинна ставка (`machineHourlyRateUah: string`), режим розрахунку (`manual_rate` чи `depreciation`).
- `PricingSettings`: тариф електроенергії (`electricityTariffUahPerKwh`), режим (`markup` або `target_margin`), відсотки, мінімальне замовлення, режим округлення, фіксовані послуги оператора.
- `ParsedJob`, `ParsedPlate`, `ParsedFilamentLayer`: структура метаданих зрізаного файлу Bambu Studio.
- `FilamentUsage`: рядок зіставлення шару з каталогом користувача.
- `CalculationInput` & `CalculationResult`: вхідні дані та строго розраховані рядки Decimal.js.
- `CalculationSnapshot`: зафіксований історичний знімок розрахунку.

> **Примітка щодо типів**: Усі числові фінансові значення передаються рядками (`string`), щоб уникнути втрати точності IEEE-754. Невідомі або непропущені значення позначаються як `null`, а не `0`.

---

## 4. Математика собівартості (`src/domain/calculator.ts`)

Усі обчислення виконуються через `Decimal.js` у чистій функції `calculatePrintCost`:

1. **Матеріали**:
   $$\text{MaterialsCost} = \sum \left( \frac{\text{grams} \times \text{repeats}}{1000} \times \text{pricePerKg} \right)$$
2. **Електроенергія**:
   $$\text{DurationHours} = \frac{\sum (\text{plateSeconds} \times \text{repeats})}{3600}$$
   $$\text{EnergyKwh} = \text{DurationHours} \times \frac{\text{PowerWatts}}{1000}$$
   $$\text{ElectricityCost} = \text{EnergyKwh} \times \text{ElectricityTariff}$$
3. **Машинний час**:
   $$\text{MachineCost} = \text{DurationHours} \times \text{MachineHourlyRate}$$
4. **Фіксовані витрати замовлення** (застосовуються 1 раз на все замовлення, не множаться на кількість пластин):
   $$\text{FixedCosts} = \text{Operator} + \text{Packaging} + \text{PostProcessing} + \text{Other}$$
5. **Резерв браку та ризику**:
   $$\text{BaseSubtotal} = \text{MaterialsCost} + \text{ElectricityCost} + \text{MachineCost} + \text{FixedCosts}$$
   $$\text{ScrapReserve} = \text{BaseSubtotal} \times \frac{\text{ScrapReservePercent}}{100}$$
   $$\text{CostPrice (Собівартість)} = \text{BaseSubtotal} + \text{ScrapReserve}$$
6. **Ціноутворення**:
   - Режим **Націнка на собівартість**:
     $$\text{PreRoundPrice} = \text{CostPrice} \times \left(1 + \frac{\text{MarkupPercent}}{100}\right)$$
   - Режим **Цільова маржа від ціни продажу**:
     $$\text{PreRoundPrice} = \frac{\text{CostPrice}}{1 - \frac{\text{MarginPercent}}{100}}$$
7. **Мінімум та округлення**:
   $$\text{PriceWithMin} = \max(\text{PreRoundPrice}, \text{MinOrder})$$
   Округлення вгору за обраним кроком (`none`, `up_1`, `up_5`, `up_10`, `up_50`, `up_100`).

---

## 5. Сервісні контракти та заміна на Production

Зараз застосунок працює через Mock-репозиторії з однаковими інтерфейсами:

| Інтерфейс | Файл | Що зараз робить | Що має підключити Codex |
|---|---|---|---|
| `AuthService` | `src/services/authService.ts` | Локальна сесія, прапорець демо | `supabase.auth.signInWithPassword`, `signUp`, `resetPasswordForEmail` |
| `ProfileRepository` | `src/services/profileRepository.ts` | LocalStorage | Запити до таблиці `profiles` у PostgreSQL |
| `MaterialRepository` | `src/services/materialRepository.ts` | LocalStorage + seed | Запити до таблиці `materials` з RLS (`user_id = auth.uid()`) |
| `PrinterRepository` | `src/services/printerRepository.ts` | LocalStorage + seed | Запити до таблиці `printers` з RLS |
| `SettingsRepository` | `src/services/settingsRepository.ts` | LocalStorage + seed | Запити до таблиці `pricing_settings` |
| `CalculationRepository` | `src/services/calculationRepository.ts` | LocalStorage + snapshots | Запити до таблиці `calculations` з JSONB-полями для snapshots |
| `FileAnalysisService` | `src/services/fileAnalysisService.ts` | Еталонний Bambu 3MF файл + тестові пресети | Повноцінний JSZip / Web Worker парсер `.gcode.3mf` для розпакування XML `Metadata/slice_info.xml` та `Metadata/plate_*.json` |

---

## 6. Що саме має зробити Codex:

1. **Ініціалізація клієнта Supabase**:
   Створити `src/services/supabaseClient.ts`:
   ```typescript
   import { createClient } from '@supabase/supabase-js';
   export const supabase = createClient(
     import.meta.env.VITE_SUPABASE_URL,
     import.meta.env.VITE_SUPABASE_ANON_KEY
   );
   ```
2. **Створення схеми бази даних (SQL DDL)**:
   - Таблиця `profiles (id uuid references auth.users, full_name text, workshop_name text, created_at timestamptz)`
   - Таблиця `materials (id uuid default gen_random_uuid(), user_id uuid references auth.users, name text, type text, family text, brand text, color_hex text, color_name text, price_per_kg_uah numeric, is_archived boolean, created_at timestamptz)`
   - Таблиця `printers (id uuid default gen_random_uuid(), user_id uuid references auth.users, name text, model_id text, average_power_watts numeric, cost_calculation_mode text, machine_hourly_rate_uah numeric, is_default boolean, created_at timestamptz)`
   - Таблиця `pricing_settings (user_id uuid references auth.users primary key, electricity_tariff_uah_per_kwh numeric, pricing_mode text, default_markup_percent numeric, default_margin_percent numeric, scrap_reserve_percent numeric, min_order_price_uah numeric, rounding_mode text, ...)`
   - Таблиця `calculations (id uuid default gen_random_uuid(), user_id uuid references auth.users, title text, file_name text, status text, input_snapshot jsonb, result_snapshot jsonb, created_at timestamptz)`
   - Налаштувати RLS політики для кожної таблиці на базі `auth.uid()`.
3. **Реалізація Supabase-адаптерів**:
   Створити класи `SupabaseAuthService`, `SupabaseMaterialRepository`, тощо, що реалізують відповідні інтерфейси, та замінити експорти у `src/services/`. Жоден компонент чи сторінка не потребує зміни розмітки.
4. **Клієнтський парсер `.gcode.3mf`**:
   Підключити `jszip` до `FileAnalysisService.analyzeUploadedFile`:
   - Розпакувати архів у браузері.
   - Прочитати `Metadata/slice_info.xml` або `Metadata/project_settings.config`.
   - Вилучити теги `<plate>`, тривалість друку `prediction`, розкладки лотків AMS (`filament_type`, `tray_color`, `used_g`, `used_m`).
   - Повернути об'єкт типу `ParsedJob`.

---

## 7. Дизайн-токени та візуальний стиль

- **Шрифтовий стек**:
  - Основний текст: `Plus Jakarta Sans` (400, 500, 600, 700)
  - Числа, таблиці, тарифи: `JetBrains Mono` (`tabular-nums`)
- **Кольорова палітра**:
  - Фон світлий: `#f8fafc` (нейтральний холодний світло-сірий)
  - Поверхні світлі: `#ffffff`
  - Текст: `#0f172a` (графітовий)
  - Акцент: `#059669` (стриманий смарагдовий / emerald)
  - Попередження: `#d97706` (янтар / помаранчевий)
  - Помилки: `#dc2626` (червоний)
- **Підтримка темної теми**:
  - Активація через селектор `.dark` на корені `<html>`.
