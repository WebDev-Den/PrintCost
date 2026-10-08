# KILO·G — Server & Backend Architecture Specification

> **Історична специфікація.** Описаний нижче Express / REST / SQL-сервер і fallback на мок-дані замінено стеком **Cloudflare Pages + Firebase Authentication + Cloud Firestore Spark**. Поточний клієнт читає файли локально та працює з Firebase SDK; `/api/*` для запуску не потрібен. Актуальні налаштування, правила доступу, підтримка файлів і деплой описані в [README.md](./README.md). Не використовуйте наведені нижче API-контракти як інструкцію до поточного розгортання.

> **Призначення документа:** цей файл створено як технічне завдання та архітектурне керівництво для Codex (або іншого AI / розробника) для швидкого та безпомилкового розгортання бекенд-сервера, бази даних та REST API, що повністю сумісні з клієнтським додатком KILO·G.

---

## 1. Загальний огляд проєкту (Project Overview)

**KILO·G** — професійний веб-сервіс майстерні FDM/FFF 3D-друку для розрахунку собівартості, ціноутворення, аналізу файлів `.gcode.3mf` (з Bambu Studio, OrcaSlicer, PrusaSlicer, Creality Print), ведення складських залишків пластиків та публічного каталогу філаментів з технічними температурними профілями.

* **Frontend:** React 19 SPA, TypeScript, Vite, Tailwind CSS v4, Lucide Icons.
* **API Клієнт фронтенду:** реалізований у `src/services/api.ts` з префіксом `/api` (налаштовується через `VITE_API_BASE_URL`).
* **Моделі даних:** строго типізовані в `src/domain/types.ts` та `src/domain/filamentsDirectory.ts`.
* **Поточний режим:** на фронтенді діє гібридний шар: спроба звернення до реального сервера `/api/*`, а при його недоступності або в демо-режимі — fallback на `localStorage` / мок-репозиторії. Завдання Codex — реалізувати повноцінний сервер, який прийме всі ці запити.

---

## 2. Рекомендований стек технологій для сервера

* **Runtime:** Node.js 20+ (або Bun)
* **Мова:** TypeScript
* **Фреймворк:** Express 4.x (вже встановлено в `package.json` разом із `@types/express` та `tsx`)
* **База даних:** PostgreSQL (рекомендовано для продакшену) або SQLite (через `better-sqlite3` для локальної розробки)
* **ORM / Query Builder:** Drizzle ORM або Prisma
* **Автентифікація:** JWT (JSON Web Tokens) в заголовку `Authorization: Bearer <token>`, паролі хешуються через `bcrypt` або `argon2`
* **Робота з файлами .3mf/.zip:** `adm-zip` або `yauzl` для розпакування 3MF проектів та читання `Metadata/slice_info.config`, `plate_*.gcode`.

---

## 3. Структура файлів сервера (Рекомендована)

```
server/
├── index.ts                # Точка входу Express сервера (порт 3000 в dev або 3001)
├── config/
│   ├── env.ts              # Валідація змінних середовища (JWT_SECRET, DATABASE_URL)
│   └── db.ts               # Підключення до БД (Postgres / SQLite)
├── db/
│   ├── schema.ts           # Схеми таблиць (Drizzle / Prisma)
│   └── seed.ts             # Початкові дані (виробники, типи пластиків, базові філаменти)
├── middleware/
│   ├── auth.ts             # Перевірка JWT токена
│   ├── errorHandler.ts     # Уніфікований обробник помилок
│   └── upload.ts           # Multer для завантаження .3mf / .gcode
├── routes/
│   ├── auth.routes.ts      # /api/auth/*
│   ├── filaments.routes.ts # /api/filaments/*
│   ├── manufacturers.routes.ts # /api/manufacturers/*
│   ├── temperatures.routes.ts  # /api/temperature-profiles/*
│   ├── materials.routes.ts # /api/materials/*
│   ├── printers.routes.ts  # /api/printers/*
│   ├── calculations.routes.ts # /api/calculations/*
│   ├── files.routes.ts     # /api/files/analyze
│   ├── settings.routes.ts  # /api/settings/*
│   └── profile.routes.ts   # /api/profile/*
└── services/
    ├── parser3mf.service.ts # Парсер .gcode.3mf архівів
    └── costEngine.service.ts# Серверний розрахунок собівартості (опціонально)
```

---

## 4. Специфікація REST API (API Contracts)

Усі відповіді мають повертатися у форматі JSON з HTTP статус-кодами (200, 201, 400, 401, 403, 404, 500).
Формат помилки:
```json
{
  "success": false,
  "error": "Опис причини помилки"
}
```

### 4.1. Автентифікація (`/api/auth`)

#### `POST /api/auth/register`
* **Тіло запиту:**
  ```json
  {
    "email": "user@example.com",
    "password": "secure_password",
    "fullName": "Іван Коваленко",
    "workshopName": "3D Lab Kyiv"
  }
  ```
* **Відповідь 201:**
  ```json
  {
    "user": {
      "id": "usr_abc123",
      "email": "user@example.com",
      "fullName": "Іван Коваленко",
      "workshopName": "3D Lab Kyiv",
      "createdAt": "2026-10-08T10:00:00.000Z",
      "isDemoUser": false
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

#### `POST /api/auth/login`
* **Тіло запиту:** `{"email": "user@example.com", "password": "secure_password"}`
* **Відповідь 200:** об'єкт `{ "user": {...}, "token": "..." }`

#### `GET /api/auth/me`
* **Заголовки:** `Authorization: Bearer <token>`
* **Відповідь 200:** `UserProfile`

#### `POST /api/auth/forgot-password`
* **Тіло запиту:** `{"email": "user@example.com"}`
* **Відповідь 200:** `{"success": true, "message": "Лист для відновлення надіслано"}`

#### `POST /api/auth/reset-password`
* **Тіло запиту:** `{"token": "reset_token_abc", "newPassword": "new_secure_password"}`
* **Відповідь 200:** `{"success": true}`

---

### 4.2. Публічний каталог пластиків (`/api/filaments`)

#### `GET /api/filaments`
* **Query параметри:**
  * `brand` (string, optional) — id виробника (напр. `bambu-lab`, `plexiwire`)
  * `type` (string, optional) — тип пластику (напр. `PLA`, `PETG`, `ABS`)
  * `tone` (string, optional) — колірна група (`black`, `white`, `red`, `multicolor` тощо)
  * `colorType` (string, optional) — `solid` | `dual` | `tri` | `rainbow` | `glow` | `marble`
  * `inStockOnly` (boolean, optional) — тільки в наявності в магазинах
  * `search` (string, optional) — пошуковий запит за назвою чи артикулом
* **Відповідь 200:** масив об'єктів `PublicFilamentItem[]`.
* **Приклад структури філаменту:**
  ```json
  {
    "id": "plexiwire-petg-black",
    "name": "Plexiwire PETG Чорний",
    "brand": "Plexiwire",
    "manufacturerId": "plexiwire",
    "type": "PETG",
    "family": "Стандартні",
    "weightGrams": 1000,
    "diameterMm": 1.75,
    "colorName": "Глибокий чорний",
    "colorHex": "#111827",
    "colorTone": "black",
    "colorType": "solid",
    "colorHexList": ["#111827"],
    "packagingType": "spool",
    "pricePerKgUah": 590,
    "temperatureProfile": {
      "nozzleTempMin": 220,
      "nozzleTempMax": 245,
      "bedTempMin": 70,
      "bedTempMax": 85,
      "chamberTemp": 0,
      "printSpeedMax": 250,
      "fanSpeedPercent": 50,
      "enclosureRequired": false
    },
    "technicalSpecs": {
      "densityGPerCm3": 1.27,
      "tensileStrengthMpa": 50,
      "dryingTempC": 65,
      "dryingTimeHours": 6
    },
    "stores": [
      {
        "storeName": "Plexiwire Official",
        "url": "https://plexiwire.com",
        "priceUah": 590,
        "inStock": true,
        "isOfficialDistributor": true
      }
    ],
    "likesCount": 24
  }
  ```

#### `POST /api/filaments` *(Admin JWT)*
* Створення нового філаменту в каталозі. Повертає `201 Created`.

#### `PUT /api/filaments/:id` *(Admin JWT)*
* Оновлення філаменту. Повертає `200 OK`.

#### `DELETE /api/filaments/:id` *(Admin JWT)*
* Видалення філаменту. Повертає `200 OK` або `204 No Content`.

#### `POST /api/filaments/:id/like`
* Збільшує лічильник лайків на 1. Повертає `{"likesCount": 25}`.

---

### 4.3. Виробники (`/api/manufacturers`)

* `GET /api/manufacturers` — список усіх брендів (`ManufacturerBrand[]`).
* `POST /api/manufacturers` *(Admin JWT)* — додати бренд:
  ```json
  {
    "id": "bambu-lab",
    "name": "Bambu Lab",
    "country": "Китай",
    "websiteUrl": "https://bambulab.com",
    "logoUrl": "https://...",
    "officialStore": "Офіційний дистриб'ютор в Україні",
    "description": "Високошвидкісні пластики з RFID-мітками",
    "isUkrainian": false
  }
  ```
* `PUT /api/manufacturers/:id` *(Admin JWT)* — оновити дані бренду.
* `DELETE /api/manufacturers/:id` *(Admin JWT)* — видалити бренд.

---

### 4.4. Температурні режими та типи пластику (`/api/temperature-profiles`)

* `GET /api/temperature-profiles` — список профілів (`TemperatureProfile[]`).
* `POST /api/temperature-profiles` *(Admin JWT)* — додати новий профіль.
* `PUT /api/temperature-profiles/:id` *(Admin JWT)* — редагування профілю.
* `DELETE /api/temperature-profiles/:id` *(Admin JWT)* — видалення профілю.

---

### 4.5. Матеріали майстерні користувача (`/api/materials`)
*(Усі запити вимагають `Authorization: Bearer <token>` і прив'язані до конкретного `userId`)*

* `GET /api/materials` — список матеріалів майстерні (`MaterialProfile[]`).
* `POST /api/materials` — додати котушку/профіль матеріалу:
  ```json
  {
    "name": "Plexiwire PETG Чорний",
    "type": "PETG",
    "family": "Стандартні",
    "brand": "Plexiwire",
    "colorHex": "#111827",
    "colorName": "Чорний",
    "pricePerKgUah": "590.00",
    "spoolWeightGrams": "1000",
    "spoolPriceUah": "590.00",
    "spoolsInStock": 3,
    "notes": "Основна партія для корпусів"
  }
  ```
* `PUT /api/materials/:id` — оновити ціну, колір або залишок на складі.
* `DELETE /api/materials/:id` — архівувати або видалити матеріал.

---

### 4.6. Принтери майстерні (`/api/printers`)
*(Вимагає `Authorization: Bearer <token>`)*

* `GET /api/printers` — список принтерів (`PrinterProfile[]`).
* `POST /api/printers` — додати принтер:
  ```json
  {
    "name": "Bambu Lab P1S #1",
    "modelId": "Bambu Lab P1S",
    "averagePowerWatts": "130",
    "costCalculationMode": "manual_rate",
    "machineHourlyRateUah": "25.00",
    "printerPurchasePriceUah": "28000.00",
    "lifespanHours": "4000",
    "maintenanceHourlyRateUah": "5.00",
    "isDefault": true
  }
  ```
* `PUT /api/printers/:id` — оновити параметри принтера.
* `DELETE /api/printers/:id` — видалити принтер.

---

### 4.7. Розрахунки собівартості (`/api/calculations`)
*(Вимагає `Authorization: Bearer <token>`)*

* `GET /api/calculations` — історія розрахунків (`CalculationSnapshot[]`).
* `GET /api/calculations/:id` — деталі конкретного розрахунку.
* `POST /api/calculations` — збереження розрахунку:
  ```json
  {
    "title": "Корпус датчика температури",
    "customerName": "ТОВ АгроТех",
    "status": "complete",
    "totalGrams": 85.5,
    "totalPrintHours": 2.75,
    "totalCostUah": 142.30,
    "recommendedPriceUah": 285.00,
    "breakdown": {
      "materialCost": 50.45,
      "electricityCost": 1.79,
      "machineCost": 68.75,
      "scrapCost": 12.10,
      "operatorCost": 9.21,
      "packagingCost": 0,
      "postProcessingCost": 0,
      "otherCost": 0,
      "netProfit": 142.70
    },
    "plates": [...],
    "rawJob": {...}
  }
  ```
* `PUT /api/calculations/:id` — оновлення статусу або параметрів.
* `DELETE /api/calculations/:id` — видалення розрахунку.

---

### 4.8. Парсер слайсерних файлів (`POST /api/files/analyze`)

* **Формат:** `multipart/form-data`, поле `file`.
* **Підтримувані розширення:** `.3mf`, `.gcode.3mf`, `.gcode`.
* **Логіка аналізу:**
  1. Якщо файл є ZIP-архівом (`.3mf`):
     * Відкрити архів у пам'яті.
     * Прочитати `Metadata/slice_info.config` або `Metadata/project_settings.config`.
     * Знайти блоки `<plate>`: індекс столу, тривалість друку (`prediction`), вагу кожного трею (`tray_weight`, `tray_info`), кольори філаментів (`filament_colors`).
     * Витягти назву моделі принтера та сопла.
     * Отримати прев'ю зображення (якщо є `Metadata/plate_1.png` або `Metadata/thumbnail.png`) та перетворити в Base64.
  2. Якщо файл є звичайним текстом `.gcode`:
     * Просканувати перші 200 та останні 200 рядків на коментарі слайсера (Bambu/Orca/Prusa headers: `; model printing time:`, `; filament used [g] =`, `; total filament used [g] =`).
* **Відповідь 200:** повертає `ParsedJob`:
  ```json
  {
    "fileName": "drone_arm.gcode.3mf",
    "fileSizeBytes": 4582910,
    "slicerSource": "Bambu Studio 1.9.3.50",
    "printerModelName": "Bambu Lab X1-Carbon",
    "nozzleDiameterMm": "0.4",
    "totalPredictionSeconds": 7320,
    "totalWeightGrams": 145.2,
    "warnings": [],
    "plates": [
      {
        "plateIndex": 1,
        "plateName": "Plate 1",
        "predictionSeconds": 7320,
        "totalWeightGrams": 145.2,
        "selected": true,
        "repeatsCount": 1,
        "filaments": [
          {
            "trayId": 1,
            "type": "PETG-CF",
            "colorHex": "#262626",
            "colorName": "Black Carbon",
            "weightGrams": 145.2
          }
        ]
      }
    ]
  }
  ```

---

### 4.9. Налаштування майстерні (`/api/settings`)
*(Вимагає `Authorization: Bearer <token>`)*

* `GET /api/settings` — отримати налаштування користувача (`PricingSettings`).
* `PUT /api/settings` — оновити тариф на електрику, націнку, резерв на брак, маржу, тему тощо.
* `POST /api/settings/reset` — скинути до дефолтних налаштувань.
* `GET /api/settings/export` — завантажити повну конфігурацію в JSON.
* `POST /api/settings/import` — імпортувати конфігурацію з JSON.

---

## 5. Схема реляційної бази даних (PostgreSQL / SQLite)

### Таблиця: `users`
* `id` (VARCHAR(36), PK)
* `email` (VARCHAR(255), UNIQUE, NOT NULL)
* `password_hash` (VARCHAR(255), NOT NULL)
* `full_name` (VARCHAR(255))
* `workshop_name` (VARCHAR(255))
* `role` (VARCHAR(32), DEFAULT 'user') — 'user' | 'admin'
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

### Таблиця: `pricing_settings`
* `user_id` (VARCHAR(36), PK, FK -> users.id ON DELETE CASCADE)
* `electricity_tariff_uah_per_kwh` (NUMERIC(10, 2), DEFAULT 4.32)
* `pricing_mode` (VARCHAR(32), DEFAULT 'markup')
* `default_markup_percent` (NUMERIC(10, 2), DEFAULT 100)
* `default_margin_percent` (NUMERIC(10, 2), DEFAULT 50)
* `scrap_reserve_percent` (NUMERIC(10, 2), DEFAULT 10)
* `min_order_price_uah` (NUMERIC(10, 2), DEFAULT 150)
* `rounding_mode` (VARCHAR(32), DEFAULT 'up_10')
* `default_operator_fee_uah` (NUMERIC(10, 2), DEFAULT 20)
* `theme` (VARCHAR(16), DEFAULT 'light')
* `timezone` (VARCHAR(64), DEFAULT 'Europe/Kyiv')

### Таблиця: `manufacturers`
* `id` (VARCHAR(64), PK) — e.g. 'plexiwire', 'bambu-lab'
* `name` (VARCHAR(128), NOT NULL)
* `country` (VARCHAR(64))
* `website_url` (VARCHAR(512))
* `logo_url` (VARCHAR(512))
* `official_store` (VARCHAR(255))
* `description` (TEXT)
* `is_ukrainian` (BOOLEAN, DEFAULT FALSE)
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

### Таблиця: `temperature_profiles`
* `id` (VARCHAR(64), PK)
* `name` (VARCHAR(128), NOT NULL)
* `plastic_type` (VARCHAR(32), NOT NULL)
* `nozzle_temp_min` (INT, NOT NULL)
* `nozzle_temp_max` (INT, NOT NULL)
* `bed_temp_min` (INT, NOT NULL)
* `bed_temp_max` (INT, NOT NULL)
* `chamber_temp` (INT, DEFAULT 0)
* `print_speed_max` (INT, DEFAULT 250)
* `fan_speed_percent` (INT, DEFAULT 50)
* `enclosure_required` (BOOLEAN, DEFAULT FALSE)

### Таблиця: `catalog_filaments`
* `id` (VARCHAR(128), PK)
* `name` (VARCHAR(255), NOT NULL)
* `brand` (VARCHAR(128), NOT NULL)
* `manufacturer_id` (VARCHAR(64), FK -> manufacturers.id)
* `type` (VARCHAR(32), NOT NULL)
* `family` (VARCHAR(64))
* `weight_grams` (INT, DEFAULT 1000)
* `diameter_mm` (NUMERIC(4, 2), DEFAULT 1.75)
* `color_name` (VARCHAR(128))
* `color_hex` (VARCHAR(16))
* `color_tone` (VARCHAR(32))
* `color_type` (VARCHAR(32), DEFAULT 'solid')
* `color_hex_list` (JSONB / TEXT) — масив HEX для мультиколірних / dual / tri
* `packaging_type` (VARCHAR(32), DEFAULT 'spool')
* `price_per_kg_uah` (NUMERIC(10, 2))
* `temperature_profile_id` (VARCHAR(64), FK -> temperature_profiles.id)
* `technical_specs` (JSONB / TEXT)
* `stores` (JSONB / TEXT)
* `likes_count` (INT, DEFAULT 0)
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

### Таблиця: `user_materials`
* `id` (VARCHAR(36), PK)
* `user_id` (VARCHAR(36), FK -> users.id ON DELETE CASCADE)
* `name` (VARCHAR(255), NOT NULL)
* `type` (VARCHAR(32), NOT NULL)
* `family` (VARCHAR(64))
* `brand` (VARCHAR(128))
* `color_hex` (VARCHAR(16))
* `color_name` (VARCHAR(128))
* `price_per_kg_uah` (NUMERIC(10, 2))
* `spool_weight_grams` (NUMERIC(10, 2), DEFAULT 1000)
* `spool_price_uah` (NUMERIC(10, 2))
* `spools_in_stock` (INT, DEFAULT 1)
* `is_archived` (BOOLEAN, DEFAULT FALSE)
* `notes` (TEXT)
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

### Таблиця: `user_printers`
* `id` (VARCHAR(36), PK)
* `user_id` (VARCHAR(36), FK -> users.id ON DELETE CASCADE)
* `name` (VARCHAR(255), NOT NULL)
* `model_id` (VARCHAR(128))
* `average_power_watts` (NUMERIC(10, 2), DEFAULT 120)
* `cost_calculation_mode` (VARCHAR(32), DEFAULT 'manual_rate')
* `machine_hourly_rate_uah` (NUMERIC(10, 2), DEFAULT 20)
* `printer_purchase_price_uah` (NUMERIC(10, 2))
* `lifespan_hours` (INT)
* `maintenance_hourly_rate_uah` (NUMERIC(10, 2))
* `is_default` (BOOLEAN, DEFAULT FALSE)
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

### Таблиця: `calculations`
* `id` (VARCHAR(36), PK)
* `user_id` (VARCHAR(36), FK -> users.id ON DELETE CASCADE)
* `title` (VARCHAR(255), NOT NULL)
* `customer_name` (VARCHAR(255))
* `status` (VARCHAR(32), DEFAULT 'complete')
* `total_grams` (NUMERIC(10, 2), NOT NULL)
* `total_print_hours` (NUMERIC(10, 2), NOT NULL)
* `total_cost_uah` (NUMERIC(10, 2), NOT NULL)
* `recommended_price_uah` (NUMERIC(10, 2), NOT NULL)
* `breakdown` (JSONB / TEXT)
* `plates` (JSONB / TEXT)
* `raw_job` (JSONB / TEXT)
* `created_at` (TIMESTAMP WITH TIME ZONE, DEFAULT NOW())

---

## 6. Покроковий план розгортання для Codex (Implementation Steps)

1. **Крок 1: Підготовка точки входу сервера `server.ts`**
   * Створити файл `server.ts` у корені проекту.
   * Використати Express для маршрутів `/api/*`.
   * Для продакшену роздавати статичні файли з папки `dist/`.
   * У режимі розробки підключити `vite.middlewares` або запустити проксі через `vite.config.ts` (`server.proxy['/api'] = 'http://localhost:3001'`).

2. **Крок 2: Ініціалізація бази даних та міграції**
   * Налаштувати Drizzle ORM або Prisma для створення описаних вище 8 таблиць.
   * Написати сид-скрипт (`server/db/seed.ts`), який переносить дефолтні дані з `src/domain/filamentsDirectory.ts` (виробники Bambu Lab, Plexiwire, Monofilament, eSUN, Devil Design тощо та їхні позиції).

3. **Крок 3: Реалізація роутів автентифікації та JWT**
   * Ендпоінти `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
   * Middleware перевірки Bearer токена.

4. **Крок 4: Реалізація роутів каталогу (Каталог, Бренди, Температури)**
   * Публічні `GET` маршрути.
   * Захищені адмінські `POST / PUT / DELETE` маршрути.

5. **Крок 5: Реалізація кабінету (Матеріали, Принтери, Розрахунки, Налаштування)**
   * Повний CRUD для матеріалів майстерні з підтримкою кількості котушок на складі.
   * Повний CRUD для принтерів майстерні.
   * Збереження розрахунків та генерація звітів.

6. **Крок 6: Реалізація ендпоінту аналізу файлів `POST /api/files/analyze`**
   * Встановити `adm-zip` (`npm install adm-zip @types/adm-zip`).
   * Читання архіву `.3mf`, парсинг XML/JSON конфігурації Bambu/Orca слайсерів.

7. **Крок 7: Тестування та перевірка з фронтендом**
   * Запустити `npm run build` і перевірити відповідність відповідей інтерфейсам `src/services/api.ts`.
