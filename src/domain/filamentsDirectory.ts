export interface FilamentStoreLink {
  storeName: string;
  url: string; // Пряме посилання на сторінку конкретного товару продавця (1 колір, 1 виробник, 1 артикул)
  priceUah: number;
  inStock: boolean;
  colorName?: string; // Назва кольору, наприклад "Чорний (Black)", "Білий", "Червоний"
  spoolWeightGrams?: number; // Вага котушки, наприклад 1000, 750, 500
  productTitle?: string; // Повна назва товару продавця, наприклад "Bambu Lab PETG Basic Black 1.75мм 1кг"
  isOfficialDistributor?: boolean;
}

export interface ManufacturerBrand {
  id: string;
  name: string;
  country: string;
  website: string;
  logoText: string;
  logoBg: string;
  logoTextColor: string;
  description: string;
}

export type ColorTone =
  | 'black'
  | 'white'
  | 'grey'
  | 'red'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'purple'
  | 'special';

export interface PopularColorItem {
  name: string;
  hex: string;
  colorTone?: ColorTone;
  sku?: string;
  stores?: FilamentStoreLink[]; // Індивідуальні посилання продавця саме на цей колір
}

export interface PublicFilamentItem {
  id: string;
  name: string;
  brand: string;
  manufacturerId: string;
  type: string; // PLA, PETG, ABS, ASA, TPU, PA, PLA-CF, PC, etc.
  family: 'Стандартні' | 'Інженерні' | 'Гнучкі' | 'Композитні' | 'Підтримки';
  approxPricePerKgUah: number;
  spoolWeightGrams: number;
  diameterMm: number; // 1.75
  inStock: boolean; // Статус наявності: true (в наявності), false (немає в наявності)
  stockStatusLabel?: string; // наприклад, 'В наявності' або 'Немає в наявності (очікується)'
  printTempNozzle?: string; // Optional custom: if empty or undefined, uses STANDARD_TEMPERATURE_PROFILES[type].nozzle
  printTempBed?: string; // Optional custom: if empty or undefined, uses STANDARD_TEMPERATURE_PROFILES[type].bed
  chamberTemp?: string; // Optional custom: if empty or undefined, uses STANDARD_TEMPERATURE_PROFILES[type].chamber
  coolingFan?: string; // Optional fan profile
  recommendedSpeedMmS?: string;
  densityGPerCm3: number;
  description: string;
  badge?: string;
  primaryColorTone: ColorTone; // Для сортування та фільтрації за кольором
  popularColors: PopularColorItem[];
  stores: FilamentStoreLink[];
}

export interface TemperatureProfile {
  plasticType: string;
  nozzleRange: string;
  bedRange: string;
  chamberRange: string;
  fanSpeed: string;
  notes: string;
  enclosureRequired: boolean;
  dryingTempTime: string;
}

// Стандартні температурні профілі за типами пластику (використовуються, якщо інший не заданий виробником)
export const STANDARD_TEMPERATURE_PROFILES: Record<string, TemperatureProfile> = {
  PLA: {
    plasticType: 'PLA / PLA+',
    nozzleRange: '190–225 °C',
    bedRange: '50–60 °C',
    chamberRange: 'Кімнатна (відкрита)',
    fanSpeed: '100% (активне охолодження)',
    notes: 'Легкий у друку, мінімальна усадка, не вимагає термокамери. Ідеальний для прототипів та декоративних виробів.',
    enclosureRequired: false,
    dryingTempTime: '45–50 °C (4–6 год)',
  },
  PETG: {
    plasticType: 'PETG',
    nozzleRange: '225–250 °C',
    bedRange: '70–85 °C',
    chamberRange: 'Кімнатна або пасивна',
    fanSpeed: '30–60% (помірне охолодження)',
    notes: 'Відмінна міжшарова адгезія, хімічна та вологостійкість. Чутливий до надмірного обдуву (втрата міцності).',
    enclosureRequired: false,
    dryingTempTime: '60–65 °C (6–8 год)',
  },
  ABS: {
    plasticType: 'ABS / ABS+',
    nozzleRange: '235–260 °C',
    bedRange: '95–110 °C',
    chamberRange: '45–60 °C (обов’язково закрита камера)',
    fanSpeed: '0–25% (без сильного протягу)',
    notes: 'Висока термостійкість та ударостійкість. Значна усадка — друкувати тільки у термокамері для запобігання деламінації.',
    enclosureRequired: true,
    dryingTempTime: '70–80 °C (4–6 год)',
  },
  ASA: {
    plasticType: 'ASA',
    nozzleRange: '240–260 °C',
    bedRange: '90–105 °C',
    chamberRange: '45–60 °C (закрита камера)',
    fanSpeed: '0–20%',
    notes: 'Аналог ABS з винятковою стійкістю до сонячного ультрафіолету (UV) та атмосферних опадів. Чудовий для зовнішнього використання.',
    enclosureRequired: true,
    dryingTempTime: '70–80 °C (4–6 год)',
  },
  TPU: {
    plasticType: 'TPU (Гнучкий / Flex)',
    nozzleRange: '210–235 °C',
    bedRange: '30–50 °C (або без підігріву)',
    chamberRange: 'Кімнатна',
    fanSpeed: '50–100%',
    notes: 'Гумоподібний еластомер (зазвичай 95A або 85A). Вимагає низької швидкості (20–50 мм/с) та Direct Drive екструдера.',
    enclosureRequired: false,
    dryingTempTime: '55–60 °C (6–8 год)',
  },
  PA: {
    plasticType: 'PA / Nylon (Нейлон)',
    nozzleRange: '250–290 °C',
    bedRange: '80–100 °C',
    chamberRange: '50–70 °C (закрита камера)',
    fanSpeed: '0–20%',
    notes: 'Висока зносостійкість та ковзання (для шестерень і втулок). Вкрай гігроскопічний — обов’язкове сушіння перед друком!',
    enclosureRequired: true,
    dryingTempTime: '80–90 °C (8–12 год)',
  },
  'PLA-CF': {
    plasticType: 'PLA-CF (Carbon Fiber)',
    nozzleRange: '210–240 °C',
    bedRange: '55–65 °C',
    chamberRange: 'Кімнатна (відкрита)',
    fanSpeed: '80–100%',
    notes: 'Вуглеволокно додає жорсткості та матової естетики без видимих шарів. Вимагає зносостійкого загартованого сопла (Hardened Steel).',
    enclosureRequired: false,
    dryingTempTime: '50–55 °C (4–6 год)',
  },
  PC: {
    plasticType: 'PC (Полікарбонат)',
    nozzleRange: '260–300 °C',
    bedRange: '100–120 °C',
    chamberRange: '60–80 °C (активна термокамера)',
    fanSpeed: '0–15%',
    notes: 'Екстремальна міцність та термостійкість до 115 °C. Вимагає високих температур хотенду та столу.',
    enclosureRequired: true,
    dryingTempTime: '80–90 °C (8–10 год)',
  },
};

// Довідник кольорових груп для сортування та фільтрації
export const COLOR_TONES_CONFIG: Record<
  ColorTone,
  { label: string; bgClass: string; textClass: string; hex: string }
> = {
  black: { label: 'Чорні', bgClass: 'bg-neutral-900', textClass: 'text-white', hex: '#111827' },
  white: { label: 'Білі', bgClass: 'bg-neutral-100', textClass: 'text-neutral-900', hex: '#f8fafc' },
  grey: { label: 'Сірі', bgClass: 'bg-neutral-400', textClass: 'text-white', hex: '#6b7280' },
  red: { label: 'Червоні', bgClass: 'bg-red-500', textClass: 'text-white', hex: '#ef4444' },
  orange: { label: 'Помаранчеві', bgClass: 'bg-orange-500', textClass: 'text-white', hex: '#f97316' },
  yellow: { label: 'Жовті', bgClass: 'bg-yellow-400', textClass: 'text-neutral-900', hex: '#eab308' },
  green: { label: 'Зелені', bgClass: 'bg-emerald-600', textClass: 'text-white', hex: '#059669' },
  blue: { label: 'Сині', bgClass: 'bg-blue-600', textClass: 'text-white', hex: '#2563eb' },
  purple: { label: 'Фіолетові', bgClass: 'bg-purple-600', textClass: 'text-white', hex: '#9333ea' },
  special: { label: 'Композитні/Спеціальні', bgClass: 'bg-amber-700', textClass: 'text-white', hex: '#b45309' },
};

// Довідник виробників
export const MANUFACTURERS_LIST: ManufacturerBrand[] = [
  {
    id: 'bambu-lab',
    name: 'Bambu Lab',
    country: 'Global / Сінгапур',
    website: 'https://bambulab.com',
    logoText: 'BAMBU',
    logoBg: 'bg-emerald-600',
    logoTextColor: 'text-white',
    description: 'Виробник швидкісних 3D-принтерів серій X1, P1, A1 та інженерних пластиків з вбудованими RFID чіпами для AMS.',
  },
  {
    id: 'plexiwire',
    name: 'Plexiwire',
    country: 'Україна 🇺🇦 (Харків / Київ)',
    website: 'https://plexiwire.com.ua',
    logoText: 'PLEXI',
    logoBg: 'bg-blue-600',
    logoTextColor: 'text-white',
    description: 'Провідний український виробник філаменту (PETG, PLA, ABS, Nylon) з 2017 року. Власне виробництво повного циклу в Україні.',
  },
  {
    id: 'esun',
    name: 'eSUN',
    country: 'Global / КНР',
    website: 'https://www.esun3d.com',
    logoText: 'eSUN',
    logoBg: 'bg-amber-600',
    logoTextColor: 'text-white',
    description: 'Один з найпопулярніших світових брендів матеріалів для 3D-друку, визнаний за еталонний PLA+, PETG та гнучкий TPU-95A.',
  },
  {
    id: 'devil-design',
    name: 'Devil Design',
    country: 'Польща 🇵🇱 / ЄС',
    website: 'https://devildesign.com',
    logoText: 'DEVIL',
    logoBg: 'bg-red-600',
    logoTextColor: 'text-white',
    description: 'Європейський завод з виробництва високоточного філаменту. Відомий своїм ABS+, PLA та TPU найвищої європейської якості.',
  },
  {
    id: 'polymaker',
    name: 'PolyMaker',
    country: 'Global / Нідерланди & США',
    website: 'https://polymaker.com',
    logoText: 'POLY',
    logoBg: 'bg-violet-600',
    logoTextColor: 'text-white',
    description: 'Преміальні полімерні матеріали для інженерних та аерокосмічних завдань (PolyLite ASA, PolyMide PA-CF, PolyMax).',
  },
  {
    id: 'sunlu',
    name: 'Sunlu',
    country: 'Global',
    website: 'https://www.sunlu.com',
    logoText: 'SUNLU',
    logoBg: 'bg-sky-600',
    logoTextColor: 'text-white',
    description: 'Масовий виробник високошвидкісних лінійок пластику High-Speed, сушарок FilaDryer та інженерних ниток.',
  },
];

// Каталог філаментів: кожне посилання ЧІТКО веде на 1 колір, 1 виробника, 1 сторінку товару продавця
export const PUBLIC_FILAMENTS_CATALOG: PublicFilamentItem[] = [
  {
    id: 'bambu-petg-basic',
    name: 'Bambu Lab PETG Basic',
    brand: 'Bambu Lab',
    manufacturerId: 'bambu-lab',
    type: 'PETG',
    family: 'Стандартні',
    approxPricePerKgUah: 650,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '230–260 °C',
    printTempBed: '70–80 °C',
    chamberTemp: 'Кімнатна або пасивна',
    coolingFan: '30–50%',
    recommendedSpeedMmS: 'до 300 мм/с (Bambu / OrcaSlicer)',
    densityGPerCm3: 1.25,
    description: 'Еталонний технічний пластик для Bambu Studio та OrcaSlicer з RFID та ідеальними профілями екструзії. Висока міцність на удар та стійкість до вологи.',
    badge: 'Оригінальний профіль Bambu / Orca',
    popularColors: [
      {
        name: 'Чорний (Black)',
        hex: '#1e293b',
        colorTone: 'black',
        sku: 'BAMBU-PETG-BLK-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-black-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Чорний (Black) 1.75мм 1кг',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 650,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Litye 3D',
            url: 'https://litye3d.com.ua/shop/filaments/bambu-lab/petg-basic-black-1kg/',
            productTitle: 'Bambu Lab PETG Basic Black 1.75 mm 1000g з котушкою',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 670,
            inStock: true,
          },
          {
            storeName: 'Prom.ua / Офіційний імпортер',
            url: 'https://prom.ua/ua/p1945123456-filament-bambu-lab-petg-basic-black.html',
            productTitle: 'Оригінал Bambu Lab PETG Basic 1кг Чорний (RFID)',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 660,
            inStock: true,
          },
        ],
      },
      {
        name: 'Білий (White)',
        hex: '#f8fafc',
        colorTone: 'white',
        sku: 'BAMBU-PETG-WHT-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-white-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Білий (White) 1.75мм 1кг',
            colorName: 'Білий (White)',
            spoolWeightGrams: 1000,
            priceUah: 650,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Litye 3D',
            url: 'https://litye3d.com.ua/shop/filaments/bambu-lab/petg-basic-white-1kg/',
            productTitle: 'Bambu Lab PETG Basic White 1.75 mm 1000g',
            colorName: 'Білий (White)',
            spoolWeightGrams: 1000,
            priceUah: 670,
            inStock: true,
          },
        ],
      },
      {
        name: 'Сірий (Grey)',
        hex: '#64748b',
        colorTone: 'grey',
        sku: 'BAMBU-PETG-GRY-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-grey-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Сірий (Grey) 1.75мм 1кг',
            colorName: 'Сірий (Grey)',
            spoolWeightGrams: 1000,
            priceUah: 650,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Помаранчевий (Orange)',
        hex: '#ea580c',
        colorTone: 'orange',
        sku: 'BAMBU-PETG-ORG-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-orange-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Помаранчевий (Orange) 1кг',
            colorName: 'Помаранчевий (Orange)',
            spoolWeightGrams: 1000,
            priceUah: 650,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-black-1kg/',
        productTitle: 'Bambu Lab PETG Basic Чорний (Black) 1.75мм 1кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 1000,
        priceUah: 650,
        inStock: true,
        isOfficialDistributor: true,
      },
      {
        storeName: 'Litye 3D',
        url: 'https://litye3d.com.ua/shop/filaments/bambu-lab/petg-basic-black-1kg/',
        productTitle: 'Bambu Lab PETG Basic Black 1.75 mm 1кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 1000,
        priceUah: 670,
        inStock: true,
      },
    ],
  },
  {
    id: 'plexiwire-petg-ua',
    name: 'Plexiwire PETG (Made in Ukraine)',
    brand: 'Plexiwire',
    manufacturerId: 'plexiwire',
    type: 'PETG',
    family: 'Стандартні',
    approxPricePerKgUah: 490,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'blue',
    printTempNozzle: '225–245 °C',
    printTempBed: '70–80 °C',
    recommendedSpeedMmS: '100–200 мм/с',
    densityGPerCm3: 1.27,
    description: 'Український філамент від виробника з Харкова/Києва. Стабільний діаметр 1.75 мм, відмінна міжшарова адгезія, доступна ціна для серійного комерційного друку.',
    badge: 'Український виробник 🇺🇦',
    popularColors: [
      {
        name: 'Яскраво-синій',
        hex: '#2563eb',
        colorTone: 'blue',
        sku: 'PLEXI-PETG-BLU-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/petg-1-75-siniy-1-kg/',
            productTitle: 'Пластик для 3D-принтера Plexiwire PETG 1.75 Синій 1 кг',
            colorName: 'Яскраво-синій',
            spoolWeightGrams: 1000,
            priceUah: 490,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: '3DTech Market',
            url: 'https://3dtech.com.ua/plexiwire-petg-blue-1kg/',
            productTitle: 'Plexiwire PETG Blue 1.75mm 1kg котушка',
            colorName: 'Яскраво-синій',
            spoolWeightGrams: 1000,
            priceUah: 510,
            inStock: true,
          },
        ],
      },
      {
        name: 'Графіт',
        hex: '#334155',
        colorTone: 'grey',
        sku: 'PLEXI-PETG-GRF-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/petg-1-75-grafit-1-kg/',
            productTitle: 'Пластик для 3D-принтера Plexiwire PETG 1.75 Графіт 1 кг',
            colorName: 'Графіт',
            spoolWeightGrams: 1000,
            priceUah: 490,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Прозорий (Clear)',
        hex: '#e2e8f0',
        colorTone: 'white',
        sku: 'PLEXI-PETG-CLR-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/petg-1-75-prozoriy-1-kg/',
            productTitle: 'Пластик Plexiwire PETG 1.75 Натуральний / Прозорий 1 кг',
            colorName: 'Прозорий (Clear)',
            spoolWeightGrams: 1000,
            priceUah: 490,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Жовтий',
        hex: '#eab308',
        colorTone: 'yellow',
        sku: 'PLEXI-PETG-YEL-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/petg-1-75-zhovtiy-1-kg/',
            productTitle: 'Пластик Plexiwire PETG 1.75 Жовтий 1 кг',
            colorName: 'Жовтий',
            spoolWeightGrams: 1000,
            priceUah: 490,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Plexiwire Офіційний магазин',
        url: 'https://plexiwire.com.ua/petg-1-75-siniy-1-kg/',
        productTitle: 'Plexiwire PETG 1.75 Синій 1 кг (Оригінал виробника)',
        colorName: 'Яскраво-синій',
        spoolWeightGrams: 1000,
        priceUah: 490,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'esun-pla-plus',
    name: 'eSUN PLA+ (High Speed)',
    brand: 'eSUN',
    manufacturerId: 'esun',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 600,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'white',
    printTempNozzle: '205–225 °C',
    printTempBed: '50–60 °C',
    chamberTemp: 'Кімнатна',
    coolingFan: '100%',
    recommendedSpeedMmS: 'до 250 мм/с',
    densityGPerCm3: 1.24,
    description: 'Модифікований PLA з підвищеною міцністю на злам у 2-3 рази вище стандартного PLA. Не дає усадки, чудовий для корпусів, прототипів та іграшок.',
    badge: 'Топ вибір для швидкісного друку',
    popularColors: [
      {
        name: 'Холодний білий',
        hex: '#ffffff',
        colorTone: 'white',
        sku: 'ESUN-PLAP-WHT-1KG',
        stores: [
          {
            storeName: '3D-Plast',
            url: 'https://3dplast.biz/ua/esun-pla-plus-cold-white-1kg/',
            productTitle: 'eSUN PLA+ Холодний білий (Cold White) 1.75мм 1кг',
            colorName: 'Холодний білий',
            spoolWeightGrams: 1000,
            priceUah: 600,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Rozetka / eSUN UA',
            url: 'https://rozetka.com.ua/ua/esun-pla-plus-cold-white-1-75-1kg/p34521099/',
            productTitle: 'Філамент eSUN PLA+ Cold White 1.75 мм 1 кг',
            colorName: 'Холодний білий',
            spoolWeightGrams: 1000,
            priceUah: 620,
            inStock: true,
          },
        ],
      },
      {
        name: 'Чорний',
        hex: '#111827',
        colorTone: 'black',
        sku: 'ESUN-PLAP-BLK-1KG',
        stores: [
          {
            storeName: '3D-Plast',
            url: 'https://3dplast.biz/ua/esun-pla-plus-black-1kg/',
            productTitle: 'eSUN PLA+ Чорний (Solid Black) 1.75мм 1кг',
            colorName: 'Чорний',
            spoolWeightGrams: 1000,
            priceUah: 600,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Rozetka / eSUN UA',
            url: 'https://rozetka.com.ua/ua/esun-pla-plus-black-1-75-1kg/p34521098/',
            productTitle: 'Філамент eSUN PLA+ Black 1.75 мм 1 кг',
            colorName: 'Чорний',
            spoolWeightGrams: 1000,
            priceUah: 620,
            inStock: true,
          },
        ],
      },
      {
        name: 'Сірий металік',
        hex: '#9ca3af',
        colorTone: 'grey',
        sku: 'ESUN-PLAP-GRY-1KG',
        stores: [
          {
            storeName: '3D-Plast',
            url: 'https://3dplast.biz/ua/esun-pla-plus-grey-metallic-1kg/',
            productTitle: 'eSUN PLA+ Сірий (Grey) 1.75мм 1кг',
            colorName: 'Сірий металік',
            spoolWeightGrams: 1000,
            priceUah: 600,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Plast',
        url: 'https://3dplast.biz/ua/esun-pla-plus-cold-white-1kg/',
        productTitle: 'eSUN PLA+ Cold White 1.75мм 1кг',
        colorName: 'Холодний білий',
        spoolWeightGrams: 1000,
        priceUah: 600,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'devil-design-abs-plus',
    name: 'Devil Design ABS+',
    brand: 'Devil Design',
    manufacturerId: 'devil-design',
    type: 'ABS',
    family: 'Інженерні',
    approxPricePerKgUah: 720,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'red',
    printTempNozzle: '235–255 °C',
    printTempBed: '90–105 °C',
    chamberTemp: '50–60 °C (закрита камера)',
    coolingFan: '0–20%',
    recommendedSpeedMmS: '80–180 мм/с (закрита камера)',
    densityGPerCm3: 1.05,
    description: 'Високоякісний європейський ABS+ зі зниженою усадкою. Чудово підходить для функціональних автомобільних деталей, шестерень та виробів під капот.',
    badge: 'Європейська якість (Польща)',
    popularColors: [
      {
        name: 'Red Blood (Червоний)',
        hex: '#dc2626',
        colorTone: 'red',
        sku: 'DEVIL-ABS-RED-1KG',
        stores: [
          {
            storeName: 'Devil Design UA',
            url: 'https://devildesign.com.ua/shop/abs-plus-red-blood-1kg/',
            productTitle: 'Devil Design ABS+ Red Blood (Криваво-червоний) 1.75мм 1кг',
            colorName: 'Red Blood (Червоний)',
            spoolWeightGrams: 1000,
            priceUah: 720,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: '3D-Hub',
            url: 'https://3dhub.com.ua/devil-design-abs-plus-czerwony-1kg/',
            productTitle: 'Пластик Devil Design ABS+ Червоний 1.75 мм 1 кг',
            colorName: 'Red Blood (Червоний)',
            spoolWeightGrams: 1000,
            priceUah: 740,
            inStock: true,
          },
        ],
      },
      {
        name: 'Super Black (Чорний)',
        hex: '#0f172a',
        colorTone: 'black',
        sku: 'DEVIL-ABS-BLK-1KG',
        stores: [
          {
            storeName: 'Devil Design UA',
            url: 'https://devildesign.com.ua/shop/abs-plus-super-black-1kg/',
            productTitle: 'Devil Design ABS+ Super Black (Глибокий чорний) 1.75мм 1кг',
            colorName: 'Super Black (Чорний)',
            spoolWeightGrams: 1000,
            priceUah: 720,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Devil Design UA',
        url: 'https://devildesign.com.ua/shop/abs-plus-red-blood-1kg/',
        productTitle: 'Devil Design ABS+ Red Blood 1.75мм 1кг',
        colorName: 'Red Blood (Червоний)',
        spoolWeightGrams: 1000,
        priceUah: 720,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'plexiwire-pla-standard',
    name: 'Plexiwire PLA Eco',
    brand: 'Plexiwire',
    manufacturerId: 'plexiwire',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 520,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'green',
    printTempNozzle: undefined,
    printTempBed: undefined,
    recommendedSpeedMmS: '80–200 мм/с',
    densityGPerCm3: 1.24,
    description: 'Екологічний полілактид українського виробництва. Мінімальний запах при друку, чисті яскраві кольори та відмінне склеювання шарів.',
    badge: 'Український виробник 🇺🇦',
    popularColors: [
      {
        name: 'Смарагдовий',
        hex: '#059669',
        colorTone: 'green',
        sku: 'PLEXI-PLA-GRN-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/pla-1-75-zeleniy-1-kg/',
            productTitle: 'Plexiwire PLA 1.75 Зелений Смарагдовий 1 кг',
            colorName: 'Смарагдовий',
            spoolWeightGrams: 1000,
            priceUah: 520,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'EpicentrK 3D',
            url: 'https://epicentrk.ua/ua/shop/plexiwire-pla-green-1kg.html',
            productTitle: 'Філамент для 3D-принтера Plexiwire PLA Зелений 1 кг',
            colorName: 'Смарагдовий',
            spoolWeightGrams: 1000,
            priceUah: 540,
            inStock: true,
          },
        ],
      },
      {
        name: 'Сніжно-білий',
        hex: '#ffffff',
        colorTone: 'white',
        sku: 'PLEXI-PLA-WHT-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/pla-1-75-biliy-1-kg/',
            productTitle: 'Plexiwire PLA 1.75 Сніжно-білий 1 кг',
            colorName: 'Сніжно-білий',
            spoolWeightGrams: 1000,
            priceUah: 520,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Глибокий чорний',
        hex: '#0a0a0a',
        colorTone: 'black',
        sku: 'PLEXI-PLA-BLK-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/pla-1-75-chorniy-1-kg/',
            productTitle: 'Plexiwire PLA 1.75 Глибокий чорний 1 кг',
            colorName: 'Глибокий чорний',
            spoolWeightGrams: 1000,
            priceUah: 520,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Plexiwire Офіційний магазин',
        url: 'https://plexiwire.com.ua/pla-1-75-zeleniy-1-kg/',
        productTitle: 'Plexiwire PLA Зелений 1.75мм 1кг',
        colorName: 'Смарагдовий',
        spoolWeightGrams: 1000,
        priceUah: 520,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'bambu-pla-cf',
    name: 'Bambu Lab PLA-CF (Carbon Fiber)',
    brand: 'Bambu Lab',
    manufacturerId: 'bambu-lab',
    type: 'PLA-CF',
    family: 'Композитні',
    approxPricePerKgUah: 1250,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: false,
    stockStatusLabel: 'Очікується поставка',
    primaryColorTone: 'black',
    printTempNozzle: '210–240 °C',
    printTempBed: '55–65 °C',
    recommendedSpeedMmS: 'до 350 мм/с (сопло Hardened Steel)',
    densityGPerCm3: 1.29,
    description: 'PLA наповнений нарізаними карбоновими мікроволокнами. Забезпечує надзвичайно матову текстуровану поверхню, яка майже повністю приховує шари друку.',
    badge: 'Карбоновий композит для корпусів',
    popularColors: [
      {
        name: 'Carbon Black (Чорний)',
        hex: '#18181b',
        colorTone: 'black',
        sku: 'BAMBU-PLACF-BLK-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-cf-black-1kg/',
            productTitle: 'Bambu Lab PLA-CF Carbon Fiber Чорний 1.75мм 1кг',
            colorName: 'Carbon Black (Чорний)',
            spoolWeightGrams: 1000,
            priceUah: 1250,
            inStock: false,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Bambu Ukraine Reseller',
            url: 'https://prom.ua/ua/p19894567-filament-bambu-pla-cf-black.html',
            productTitle: 'Карбоновий пластик Bambu Lab PLA-CF Black 1кг',
            colorName: 'Carbon Black (Чорний)',
            spoolWeightGrams: 1000,
            priceUah: 1290,
            inStock: false,
          },
        ],
      },
      {
        name: 'Lava Rusty Red (Іржаво-червоний)',
        hex: '#991b1b',
        colorTone: 'red',
        sku: 'BAMBU-PLACF-RED-1KG',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-cf-rusty-red-1kg/',
            productTitle: 'Bambu Lab PLA-CF Lava Rusty Red 1.75мм 1кг',
            colorName: 'Lava Rusty Red (Іржаво-червоний)',
            spoolWeightGrams: 1000,
            priceUah: 1250,
            inStock: false,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-cf-black-1kg/',
        productTitle: 'Bambu Lab PLA-CF Carbon Black 1.75мм 1кг',
        colorName: 'Carbon Black (Чорний)',
        spoolWeightGrams: 1000,
        priceUah: 1250,
        inStock: false,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'esun-tpu-95a',
    name: 'eSUN TPU-95A Flexible',
    brand: 'eSUN',
    manufacturerId: 'esun',
    type: 'TPU',
    family: 'Гнучкі',
    approxPricePerKgUah: 1100,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'red',
    printTempNozzle: '215–235 °C',
    printTempBed: '30–50 °C',
    recommendedSpeedMmS: '30–60 мм/с (Direct Drive)',
    densityGPerCm3: 1.21,
    description: 'Гнучкий поліуретановий еластомер твердістю 95A по Шору. Висока зносостійкість, стійкість до олив, бензину та стирання. Ідеальний для демпферів та ущільнень.',
    badge: 'Еластичний Shore 95A',
    popularColors: [
      {
        name: 'Насичено-червоний',
        hex: '#ef4444',
        colorTone: 'red',
        sku: 'ESUN-TPU-RED-1KG',
        stores: [
          {
            storeName: '3DPlast.biz',
            url: 'https://3dplast.biz/ua/esun-tpu-95a-red-1kg/',
            productTitle: 'Гнучкий філамент eSUN TPU-95A Червоний 1.75мм 1кг',
            colorName: 'Насичено-червоний',
            spoolWeightGrams: 1000,
            priceUah: 1100,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Master3D',
            url: 'https://master3d.com.ua/tpu-95a-esun-red-1kg/',
            productTitle: 'eSUN TPU-95A Red 1.75 mm 1 kg гнучкий',
            colorName: 'Насичено-червоний',
            spoolWeightGrams: 1000,
            priceUah: 1150,
            inStock: true,
          },
        ],
      },
      {
        name: 'Чорний',
        hex: '#0f172a',
        colorTone: 'black',
        sku: 'ESUN-TPU-BLK-1KG',
        stores: [
          {
            storeName: '3DPlast.biz',
            url: 'https://3dplast.biz/ua/esun-tpu-95a-black-1kg/',
            productTitle: 'Гнучкий пластик eSUN TPU-95A Чорний 1.75мм 1кг',
            colorName: 'Чорний',
            spoolWeightGrams: 1000,
            priceUah: 1100,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3DPlast.biz',
        url: 'https://3dplast.biz/ua/esun-tpu-95a-red-1kg/',
        productTitle: 'eSUN TPU-95A Red 1.75мм 1кг',
        colorName: 'Насичено-червоний',
        spoolWeightGrams: 1000,
        priceUah: 1100,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'polymaker-polylite-asa',
    name: 'PolyMaker PolyLite ASA (UV Resistant)',
    brand: 'PolyMaker',
    manufacturerId: 'polymaker',
    type: 'ASA',
    family: 'Інженерні',
    approxPricePerKgUah: 1050,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: false,
    stockStatusLabel: 'Немає в наявності',
    primaryColorTone: 'grey',
    printTempNozzle: '240–260 °C',
    printTempBed: '90–100 °C',
    recommendedSpeedMmS: '60–150 мм/с',
    densityGPerCm3: 1.07,
    description: 'Полімер преміум-класу, стійкий до ультрафіолетового випромінювання та перепадів температур (від -40°C до +95°C). Ідеальний вибір для зовнішнього застосування на відкритому повітрі.',
    badge: 'Стійкість до сонця та погоди',
    popularColors: [
      {
        name: 'Weather Grey (Сірий)',
        hex: '#64748b',
        colorTone: 'grey',
        sku: 'POLY-ASA-GRY-1KG',
        stores: [
          {
            storeName: 'PolyMaker UA Official',
            url: 'https://polymaker.com.ua/polylite-asa-weather-grey-1kg/',
            productTitle: 'PolyMaker PolyLite ASA Weather Grey 1.75мм 1кг',
            colorName: 'Weather Grey (Сірий)',
            spoolWeightGrams: 1000,
            priceUah: 1050,
            inStock: false,
            isOfficialDistributor: true,
          },
          {
            storeName: '3D-Hub Kyiv',
            url: 'https://3dhub.com.ua/polymaker-polylite-asa-grey-1kg/',
            productTitle: 'Філамент PolyMaker PolyLite ASA Сірий 1 кг',
            colorName: 'Weather Grey (Сірий)',
            spoolWeightGrams: 1000,
            priceUah: 1090,
            inStock: false,
          },
        ],
      },
      {
        name: 'Pure White (Білий)',
        hex: '#f8fafc',
        colorTone: 'white',
        sku: 'POLY-ASA-WHT-1KG',
        stores: [
          {
            storeName: 'PolyMaker UA Official',
            url: 'https://polymaker.com.ua/polylite-asa-white-1kg/',
            productTitle: 'PolyMaker PolyLite ASA Pure White 1.75мм 1кг',
            colorName: 'Pure White (Білий)',
            spoolWeightGrams: 1000,
            priceUah: 1050,
            inStock: false,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'PolyMaker UA Official',
        url: 'https://polymaker.com.ua/polylite-asa-weather-grey-1kg/',
        productTitle: 'PolyMaker PolyLite ASA Weather Grey 1.75мм 1кг',
        colorName: 'Weather Grey (Сірий)',
        spoolWeightGrams: 1000,
        priceUah: 1050,
        inStock: false,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'sunlu-abs-hs',
    name: 'Sunlu ABS High Speed',
    brand: 'Sunlu',
    manufacturerId: 'sunlu',
    type: 'ABS',
    family: 'Інженерні',
    approxPricePerKgUah: 680,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'grey',
    printTempNozzle: '240–270 °C',
    printTempBed: '95–110 °C',
    recommendedSpeedMmS: 'до 300 мм/с',
    densityGPerCm3: 1.06,
    description: 'Спеціальний склад ABS з підвищеною текучістю для надшвидкісних 3D-принтерів CoreXY (Bambu P1S/X1C, Voron, Creality K1, Qidi).',
    badge: 'Швидкісний CoreXY ABS',
    popularColors: [
      {
        name: 'Сірий',
        hex: '#64748b',
        colorTone: 'grey',
        sku: 'SUNLU-ABS-GRY-1KG',
        stores: [
          {
            storeName: 'Sunlu Ukraine',
            url: 'https://sunlu.in.ua/abs-high-speed-grey-1kg/',
            productTitle: 'Sunlu ABS High Speed Grey (Сірий) 1.75мм 1кг',
            colorName: 'Сірий',
            spoolWeightGrams: 1000,
            priceUah: 680,
            inStock: true,
            isOfficialDistributor: true,
          },
          {
            storeName: 'Litye 3D',
            url: 'https://litye3d.com.ua/shop/filaments/sunlu/abs-hs-grey-1kg/',
            productTitle: 'Sunlu ABS-HS Grey 1.75 mm 1 kg швидкісний',
            colorName: 'Сірий',
            spoolWeightGrams: 1000,
            priceUah: 710,
            inStock: true,
          },
        ],
      },
      {
        name: 'Чорний',
        hex: '#0f172a',
        colorTone: 'black',
        sku: 'SUNLU-ABS-BLK-1KG',
        stores: [
          {
            storeName: 'Sunlu Ukraine',
            url: 'https://sunlu.in.ua/abs-high-speed-black-1kg/',
            productTitle: 'Sunlu ABS High Speed Black (Чорний) 1.75мм 1кг',
            colorName: 'Чорний',
            spoolWeightGrams: 1000,
            priceUah: 680,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Sunlu Ukraine',
        url: 'https://sunlu.in.ua/abs-high-speed-grey-1kg/',
        productTitle: 'Sunlu ABS High Speed Grey 1.75мм 1кг',
        colorName: 'Сірий',
        spoolWeightGrams: 1000,
        priceUah: 680,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'plexiwire-nylon-pa',
    name: 'Plexiwire Nylon PA-6 Structural',
    brand: 'Plexiwire',
    manufacturerId: 'plexiwire',
    type: 'PA',
    family: 'Інженерні',
    approxPricePerKgUah: 890,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'white',
    printTempNozzle: '255–275 °C',
    printTempBed: '85–100 °C',
    recommendedSpeedMmS: '40–90 мм/с',
    densityGPerCm3: 1.14,
    description: 'Конструкційний нейлон українського виробництва з надзвичайно високою ударною в’язкістю та стійкістю до тертя.',
    badge: 'Конструкційний поліамід 🇺🇦',
    popularColors: [
      {
        name: 'Натуральний (Natural)',
        hex: '#f8fafc',
        colorTone: 'white',
        sku: 'PLEXI-PA-NAT-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/nylon-1-75-natural-1-kg/',
            productTitle: 'Plexiwire Nylon PA 1.75 Натуральний 1 кг (Україна)',
            colorName: 'Натуральний (Natural)',
            spoolWeightGrams: 1000,
            priceUah: 890,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Чорний графіт',
        hex: '#1e293b',
        colorTone: 'black',
        sku: 'PLEXI-PA-BLK-1KG',
        stores: [
          {
            storeName: 'Plexiwire Офіційний магазин',
            url: 'https://plexiwire.com.ua/nylon-1-75-chorniy-1-kg/',
            productTitle: 'Plexiwire Nylon PA 1.75 Чорний 1 кг',
            colorName: 'Чорний графіт',
            spoolWeightGrams: 1000,
            priceUah: 890,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Plexiwire Офіційний магазин',
        url: 'https://plexiwire.com.ua/nylon-1-75-natural-1-kg/',
        productTitle: 'Plexiwire Nylon PA 1.75 Натуральний 1 кг',
        colorName: 'Натуральний (Natural)',
        spoolWeightGrams: 1000,
        priceUah: 890,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
];

// Helper функція для отримання температурного профілю
export function getFilamentEffectiveTemp(filament: PublicFilamentItem): {
  nozzle: string;
  bed: string;
  chamber: string;
  isCustom: boolean;
  fanSpeed?: string;
  dryingInfo?: string;
} {
  const std = STANDARD_TEMPERATURE_PROFILES[filament.type] || {
    nozzleRange: '200–230 °C',
    bedRange: '50–70 °C',
    chamberRange: 'Кімнатна',
    fanSpeed: '50–100%',
    dryingInfo: '50 °C (4 год)',
  };

  const hasCustomNozzle = Boolean(filament.printTempNozzle);
  const hasCustomBed = Boolean(filament.printTempBed);

  return {
    nozzle: filament.printTempNozzle || std.nozzleRange,
    bed: filament.printTempBed || std.bedRange,
    chamber: filament.chamberTemp || std.chamberRange,
    isCustom: hasCustomNozzle && hasCustomBed,
    fanSpeed: filament.coolingFan || std.fanSpeed,
    dryingInfo: std.dryingTempTime,
  };
}
