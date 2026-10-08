# KILO·G — Кабінет розрахунку собівартості FDM 3D-друку

Професійний веб-сервіс майстерні FDM/FFF 3D-друку для точного розрахунку собівартості та ціни за файлами `.gcode.3mf` (Bambu Studio, OrcaSlicer, PrusaSlicer, Creality Print), управління складом матеріалів, парком принтерів та публічним каталогом філаментів.

---

## 🛠️ Для розробників бекенду (Codex / Backend Team)

Повна специфікація API, схеми бази даних (PostgreSQL/SQLite), контракти ендпоінтів та інструкції з реалізації сервера знаходяться у файлі:

👉 **[`SERVER_SPECIFICATION.md`](./SERVER_SPECIFICATION.md)**

В ньому детально описано:
* Архітектуру та контракти REST API (`/api/auth`, `/api/filaments`, `/api/manufacturers`, `/api/temperature-profiles`, `/api/materials`, `/api/printers`, `/api/calculations`, `/api/files/analyze`, `/api/settings`);
* Схему бази даних (8 таблиць, зв'язки, типи полів);
* Обробку та розпакування слайсерних проектів `.gcode.3mf`;
* Покроковий план розгортання сервера через Express/TypeScript.

---

## 🚀 Запуск клієнтської частини (Frontend)

```bash
# Встановлення залежностей
npm install

# Запуск локального dev-сервера (порт 3000)
npm run dev

# Збірка продакшен-бандлу
npm run build

# Перевірка типів та лінтинг
npm run lint
```
