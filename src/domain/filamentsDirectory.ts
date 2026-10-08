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
  | 'multicolor'
  | 'special';

export type ColorType =
  | 'solid' // Звичайний однорідний колір
  | 'dual' // Co-extrusion 2 кольори (Silk Dual)
  | 'tri' // Tri-extrusion 3 кольори
  | 'rainbow' // Веселка / Градієнтний перехід
  | 'gradient' // Омбре або двотональний градієнт
  | 'glow' // Люмінесцентний (світиться в темряві)
  | 'marble' // Мармуровий з вкрапленнями
  | 'glitter' // З блискітками / іскрами
  | 'transparent'; // Напівпрозорий

export type PackagingType = 'spool' | 'refill';

export interface PopularColorItem {
  name: string;
  hex: string;
  hexList?: string[]; // Список кольорів для мультиколорів/dual/tri/rainbow
  colorType?: ColorType; // Тип: solid, dual, tri, rainbow, marble тощо
  colorTone?: ColorTone;
  sku?: string;
  packagingType?: PackagingType; // 'spool' (з котушкою) або 'refill' (рефіл / без котушки)
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
  packagingType?: PackagingType; // 'spool' (з котушкою) або 'refill' (рефіл / без котушки)
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
  multicolor: { label: 'Мультиколір / Веселка', bgClass: 'bg-gradient-to-r from-pink-500 via-yellow-500 to-cyan-500', textClass: 'text-white', hex: '#ec4899' },
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
  {
    id: 'monofilament',
    name: 'Monofilament',
    country: 'Україна 🇺🇦 (Київ / Луцьк)',
    website: 'https://monofilament.com.ua',
    logoText: 'MONO',
    logoBg: 'bg-emerald-700',
    logoTextColor: 'text-white',
    description: 'Провідний український виробник сертифікованого філаменту (PETG, PLA, CoPET, ABS, Elastan). Лабораторні стандарти контролю допусків.',
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
  {
    id: 'monofilament-petg-075',
    name: 'Monofilament PETG (Made in Ukraine)',
    brand: 'Monofilament',
    manufacturerId: 'monofilament',
    type: 'PETG',
    family: 'Стандартні',
    approxPricePerKgUah: 507,
    spoolWeightGrams: 750,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '225–245 °C',
    printTempBed: '70–80 °C',
    recommendedSpeedMmS: 'до 180 мм/с',
    densityGPerCm3: 1.27,
    description: 'Сертифікований український PETG на зручній котушці 0.75 кг. Висока геометрична точність ±0.03 мм, мінімальна усадка, чудова адгезія між шарами.',
    badge: 'Українське виробництво 🇺🇦 · 0.75 кг',
    popularColors: [
      {
        name: 'Чорний (Black)',
        hex: '#18181b',
        colorTone: 'black',
        sku: 'MONO-PETG-BLK-075',
        stores: [
          {
            storeName: 'Monofilament Офіційний магазин',
            url: 'https://monofilament.com.ua/products/petg-black-075/',
            productTitle: 'Філамент Monofilament PETG Чорний 1.75мм 0.75кг',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 750,
            priceUah: 380,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Білий (White)',
        hex: '#f8fafc',
        colorTone: 'white',
        sku: 'MONO-PETG-WHT-075',
        stores: [
          {
            storeName: 'Monofilament Офіційний магазин',
            url: 'https://monofilament.com.ua/products/petg-white-075/',
            productTitle: 'Філамент Monofilament PETG Білий 1.75мм 0.75кг',
            colorName: 'Білий (White)',
            spoolWeightGrams: 750,
            priceUah: 380,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Monofilament Офіційний магазин',
        url: 'https://monofilament.com.ua/products/petg-black-075/',
        productTitle: 'Monofilament PETG Чорний 0.75 кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 750,
        priceUah: 380,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'monofilament-pla-075',
    name: 'Monofilament PLA Яскравий',
    brand: 'Monofilament',
    manufacturerId: 'monofilament',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 520,
    spoolWeightGrams: 750,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'yellow',
    printTempNozzle: '195–215 °C',
    printTempBed: '50–60 °C',
    recommendedSpeedMmS: '80–200 мм/с',
    densityGPerCm3: 1.24,
    description: 'Екологічний полілактид українського заводу Monofilament. Ідеальний для художнього та технічного прототипування.',
    badge: 'Український виробник 🇺🇦 · 0.75 кг',
    popularColors: [
      {
        name: 'Яскраво-жовтий',
        hex: '#facc15',
        colorTone: 'yellow',
        sku: 'MONO-PLA-YEL-075',
        stores: [
          {
            storeName: 'Monofilament Офіційний магазин',
            url: 'https://monofilament.com.ua/products/pla-yellow-075/',
            productTitle: 'Філамент Monofilament PLA Жовтий 1.75мм 0.75кг',
            colorName: 'Яскраво-жовтий',
            spoolWeightGrams: 750,
            priceUah: 390,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Monofilament Офіційний магазин',
        url: 'https://monofilament.com.ua/products/pla-yellow-075/',
        productTitle: 'Monofilament PLA Жовтий 0.75 кг',
        colorName: 'Яскраво-жовтий',
        spoolWeightGrams: 750,
        priceUah: 390,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'devil-design-tpu-033',
    name: 'Devil Design TPU 55D Flex',
    brand: 'Devil Design',
    manufacturerId: 'devil-design',
    type: 'TPU',
    family: 'Гнучкі',
    approxPricePerKgUah: 1273,
    spoolWeightGrams: 330,
    diameterMm: 1.75,
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '210–235 °C',
    printTempBed: '30–50 °C',
    recommendedSpeedMmS: '25–45 мм/с',
    densityGPerCm3: 1.22,
    description: 'Європейський термополіуретан високої твердості 55D (Польща). Компактна котушка 0.33 кг ідеальна для одиничних еластичних виробів.',
    badge: 'Європейський TPU · 0.33 кг',
    popularColors: [
      {
        name: 'Super Black (Чорний)',
        hex: '#1f2937',
        colorTone: 'black',
        sku: 'DEVIL-TPU-BLK-033',
        stores: [
          {
            storeName: 'Devil Design UA',
            url: 'https://devildesign.com.ua/shop/tpu-55d-black-033kg/',
            productTitle: 'Devil Design TPU 55D Чорний 1.75мм 0.33кг',
            colorName: 'Super Black (Чорний)',
            spoolWeightGrams: 330,
            priceUah: 420,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: 'Devil Design UA',
        url: 'https://devildesign.com.ua/shop/tpu-55d-black-033kg/',
        productTitle: 'Devil Design TPU 55D Black 0.33кг',
        colorName: 'Super Black (Чорний)',
        spoolWeightGrams: 330,
        priceUah: 420,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'bambu-pla-basic-refill',
    name: 'Bambu Lab PLA Basic Refill (без котушки)',
    brand: 'Bambu Lab',
    manufacturerId: 'bambu-lab',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 560,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    packagingType: 'refill',
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '190–230 °C',
    printTempBed: '50–60 °C',
    chamberTemp: 'Кімнатна',
    coolingFan: '100%',
    recommendedSpeedMmS: 'до 300 мм/с',
    densityGPerCm3: 1.24,
    description: 'Оригінальний змінний моток (Refill) для багаторазової котушки Bambu Reusable Spool з RFID міткою. Екологічно та дешевше ніж із пластиковою котушкою.',
    badge: 'Оригінальний Refill (RFID) · Еко-фасування',
    popularColors: [
      {
        name: 'Чорний (Black)',
        hex: '#1e293b',
        colorTone: 'black',
        sku: 'BAMBU-PLA-REFILL-BLK',
        packagingType: 'refill',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-basic-refill-black-1kg/',
            productTitle: 'Філамент Bambu Lab PLA Basic Refill Чорний 1.75мм 1кг',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 560,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Білий (White)',
        hex: '#f8fafc',
        colorTone: 'white',
        sku: 'BAMBU-PLA-REFILL-WHT',
        packagingType: 'refill',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-basic-refill-white-1kg/',
            productTitle: 'Філамент Bambu Lab PLA Basic Refill Білий 1.75мм 1кг',
            colorName: 'Білий (White)',
            spoolWeightGrams: 1000,
            priceUah: 560,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/filament-bambu-lab-pla-basic-refill-black-1kg/',
        productTitle: 'Bambu Lab PLA Basic Refill 1кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 1000,
        priceUah: 560,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'bambu-petg-basic-refill',
    name: 'Bambu Lab PETG Basic Refill (без котушки)',
    brand: 'Bambu Lab',
    manufacturerId: 'bambu-lab',
    type: 'PETG',
    family: 'Стандартні',
    approxPricePerKgUah: 580,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    packagingType: 'refill',
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '230–260 °C',
    printTempBed: '70–80 °C',
    chamberTemp: 'Кімнатна або пасивна',
    coolingFan: '30–50%',
    recommendedSpeedMmS: 'до 300 мм/с',
    densityGPerCm3: 1.25,
    description: 'Змінний моток PETG для багаторазової котушки Bambu Lab з RFID-чіпом. Висока ударостійкість, температурна витривалість, збереження бюджету.',
    badge: 'Оригінальний Refill для багаторазової котушки',
    popularColors: [
      {
        name: 'Чорний (Black)',
        hex: '#1e293b',
        colorTone: 'black',
        sku: 'BAMBU-PETG-REFILL-BLK',
        packagingType: 'refill',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-refill-black-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Refill Чорний 1.75мм 1кг',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 580,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Сірий (Grey)',
        hex: '#64748b',
        colorTone: 'grey',
        sku: 'BAMBU-PETG-REFILL-GRY',
        packagingType: 'refill',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-refill-grey-1kg/',
            productTitle: 'Філамент Bambu Lab PETG Basic Refill Сірий 1.75мм 1кг',
            colorName: 'Сірий (Grey)',
            spoolWeightGrams: 1000,
            priceUah: 580,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/filament-bambu-lab-petg-basic-refill-black-1kg/',
        productTitle: 'Bambu Lab PETG Basic Refill 1кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 1000,
        priceUah: 580,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'sunlu-pla-plus-refill',
    name: 'Sunlu PLA+ High Speed Refill',
    brand: 'Sunlu',
    manufacturerId: 'sunlu',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 520,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    packagingType: 'refill',
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'black',
    printTempNozzle: '205–215 °C',
    printTempBed: '50–60 °C',
    chamberTemp: 'Кімнатна',
    coolingFan: '100%',
    recommendedSpeedMmS: '100–350 мм/с',
    densityGPerCm3: 1.24,
    description: 'Еко-рефіл Sunlu PLA+ без пластикової котушки. Підходить під стандартні розбірні котушки Sunlu MasterSpool та Bambu Lab.',
    badge: 'Eco-Refill без котушки · Швидкісний',
    popularColors: [
      {
        name: 'Чорний (Black)',
        hex: '#18181b',
        colorTone: 'black',
        sku: 'SUNLU-PLA-PLUS-REFILL-BLK',
        packagingType: 'refill',
        stores: [
          {
            storeName: 'Sunlu Україна Офіційний',
            url: 'https://sunlu.in.ua/shop/filaments/sunlu-pla-plus-refill-black/',
            productTitle: 'Філамент Sunlu PLA+ Refill Чорний 1.75мм 1кг',
            colorName: 'Чорний (Black)',
            spoolWeightGrams: 1000,
            priceUah: 520,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Холодний білий',
        hex: '#ffffff',
        colorTone: 'white',
        sku: 'SUNLU-PLA-PLUS-REFILL-WHT',
        packagingType: 'refill',
        stores: [
          {
            storeName: 'Sunlu Україна Офіційний',
            url: 'https://sunlu.in.ua/shop/filaments/sunlu-pla-plus-refill-white/',
            productTitle: 'Філамент Sunlu PLA+ Refill Білий 1.75мм 1кг',
            colorName: 'Холодний білий',
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
        storeName: 'Sunlu Україна Офіційний',
        url: 'https://sunlu.in.ua/shop/filaments/sunlu-pla-plus-refill-black/',
        productTitle: 'Sunlu PLA+ Refill Чорний 1кг',
        colorName: 'Чорний (Black)',
        spoolWeightGrams: 1000,
        priceUah: 520,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'bambu-pla-silk-dual',
    name: 'Bambu Lab PLA Silk Dual Color',
    brand: 'Bambu Lab',
    manufacturerId: 'bambu-lab',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 850,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    packagingType: 'spool',
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'multicolor',
    printTempNozzle: '210–230 °C',
    printTempBed: '55–65 °C',
    chamberTemp: 'Кімнатна',
    coolingFan: '100%',
    recommendedSpeedMmS: '100–300 мм/с',
    densityGPerCm3: 1.24,
    description: 'Двоколірний ко-екструдований шовковий Silk PLA. Створює дивовижний переливчастий ефект під різними кутами огляду без зміни нитки.',
    badge: 'Co-Extrusion 2-Колірний · Шовковий глянець',
    popularColors: [
      {
        name: 'Золото-Синій (Gold & Blue)',
        hex: '#f59e0b',
        hexList: ['#f59e0b', '#2563eb'],
        colorType: 'dual',
        colorTone: 'multicolor',
        sku: 'BAMBU-SILK-DUAL-GLD-BLU',
        packagingType: 'spool',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/bambu-lab-pla-silk-dual-gold-blue-1kg/',
            productTitle: 'Bambu Lab PLA Silk Dual Color Золото-Синій 1кг',
            colorName: 'Золото-Синій (Gold & Blue)',
            spoolWeightGrams: 1000,
            priceUah: 850,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
      {
        name: 'Смарагдово-Малиновий (Emerald & Magenta)',
        hex: '#059669',
        hexList: ['#059669', '#db2777'],
        colorType: 'dual',
        colorTone: 'multicolor',
        sku: 'BAMBU-SILK-DUAL-EMR-MAG',
        packagingType: 'spool',
        stores: [
          {
            storeName: 'Litye 3D',
            url: 'https://litye3d.com.ua/shop/filaments/bambu-lab/pla-silk-dual-magenta-emerald/',
            productTitle: 'Bambu Lab PLA Silk Dual Emerald-Magenta 1кг',
            colorName: 'Смарагдово-Малиновий',
            spoolWeightGrams: 1000,
            priceUah: 870,
            inStock: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/bambu-lab-pla-silk-dual-gold-blue-1kg/',
        productTitle: 'Bambu Lab PLA Silk Dual Color 1кг',
        colorName: 'Золото-Синій',
        spoolWeightGrams: 1000,
        priceUah: 850,
        inStock: true,
        isOfficialDistributor: true,
      },
    ],
  },
  {
    id: 'esun-pla-rainbow-multi',
    name: 'eSUN ePLA-Silk Rainbow (Веселка)',
    brand: 'eSUN',
    manufacturerId: 'esun',
    type: 'PLA',
    family: 'Стандартні',
    approxPricePerKgUah: 780,
    spoolWeightGrams: 1000,
    diameterMm: 1.75,
    packagingType: 'spool',
    inStock: true,
    stockStatusLabel: 'В наявності',
    primaryColorTone: 'multicolor',
    printTempNozzle: '200–225 °C',
    printTempBed: '50–60 °C',
    chamberTemp: 'Кімнатна',
    coolingFan: '100%',
    recommendedSpeedMmS: '60–250 мм/с',
    densityGPerCm3: 1.24,
    description: 'Багатоколірний шовковий філамент з плавним градієнтним переходом веселки кожні 15 метрів. Ідеально підходить для ваз, іграшок та статуеток.',
    badge: 'Rainbow Мультиколір · Градієнт Веселка',
    popularColors: [
      {
        name: 'Мультиколір Веселка (Rainbow Gradient)',
        hex: '#ec4899',
        hexList: ['#ef4444', '#f97316', '#eab308', '#10b981', '#06b6d4', '#3b82f6', '#a855f7'],
        colorType: 'rainbow',
        colorTone: 'multicolor',
        sku: 'ESUN-PLA-RAINBOW-1KG',
        packagingType: 'spool',
        stores: [
          {
            storeName: '3D-Format Ukraine',
            url: 'https://3d-format.com.ua/product/esun-epla-silk-rainbow-1kg/',
            productTitle: 'Філамент eSUN ePLA-Silk Rainbow (Веселка) 1.75мм 1кг',
            colorName: 'Мультиколір Веселка',
            spoolWeightGrams: 1000,
            priceUah: 780,
            inStock: true,
            isOfficialDistributor: true,
          },
        ],
      },
    ],
    stores: [
      {
        storeName: '3D-Format Ukraine',
        url: 'https://3d-format.com.ua/product/esun-epla-silk-rainbow-1kg/',
        productTitle: 'eSUN ePLA-Silk Rainbow 1кг',
        colorName: 'Мультиколір Веселка',
        spoolWeightGrams: 1000,
        priceUah: 780,
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

// ============================================================================
// КОНКРЕТНА КАРТКА ТОВАРУ (1 КАРТОЧКА = 1 ВАГА, 1 КОЛІР, 1 ВИРОБНИК, 1 ПРОФІЛЬ, 1 СИЛКА)
// ============================================================================
export interface ConcreteFilamentSku {
  id: string; // Унікальний ID карточки
  parentFilamentId: string;
  name: string; // e.g. "Plexiwire PLA Глибокий чорний 1.0 кг (З котушкою)"
  brand: string; // e.g. "Plexiwire"
  manufacturerId: string;
  type: string; // "PLA", "PETG", etc.
  family: 'Стандартні' | 'Інженерні' | 'Гнучкі' | 'Композитні' | 'Підтримки';
  spoolWeightGrams: number; // e.g. 1000, 750, 330
  weightKgDisplay: string; // e.g. "1.0 кг", "0.75 кг", "0.33 кг"
  diameterMm: number; // 1.75
  // Фасування (З котушкою чи Рефіл)
  packagingType: PackagingType; // 'spool' або 'refill'
  packagingLabel: string; // 'З котушкою' або 'Рефіл (Refill)'
  inStock: boolean;
  stockStatusLabel?: string;
  badge?: string;
  // 1 Колір (або мультиколір / дуал / градієнт)
  colorName: string; // e.g. "Глибокий чорний", "Silk Dual Gold-Blue", "Веселка (Rainbow)"
  colorHex: string; // e.g. "#0a0a0a" (основний або перший hex)
  colorHexList?: string[]; // e.g. ["#f59e0b", "#3b82f6"] для dual/tri/rainbow
  colorType?: ColorType; // 'solid' | 'dual' | 'tri' | 'rainbow' | 'gradient' | 'glow' | 'marble' | 'glitter'
  colorTone: ColorTone; // e.g. "black", "multicolor", "blue"
  isMulticolor?: boolean;
  // Ціна та авто-розрахунок
  priceUah: number; // Ціна за цю конкретну котушку
  calculatedPricePerKg: number; // Авто-розрахунок за 1 кг
  pricePerGram: number; // Ціна за 1 грам
  // 1 Профіль друку
  profileNozzle: string; // e.g. "190–225 °C"
  profileBed: string; // e.g. "50–60 °C"
  profileChamber?: string;
  profileFan?: string;
  profileSpeed?: string;
  profileIsCustom: boolean;
  profileNotes?: string;
  // 1 Силка (Одне пряме посилання на сторінку товару у продавця)
  storeName: string; // e.g. "Plexiwire Офіційний магазин"
  storeUrl: string; // e.g. "https://plexiwire.com.ua/pla-1-75-chorniy-1-kg/"
  isOfficialDistributor?: boolean;
  description: string;
}

/**
 * Перетворює сирий каталог у список конкретних одиничних карток:
 * 1 карточка = 1 вага + 1 колір + 1 виробник + 1 профіль + 1 пряма силка + точне фасування (З котушкою або Рефіл)
 */
export function buildConcreteFilamentSkus(catalog: PublicFilamentItem[]): ConcreteFilamentSku[] {
  const skus: ConcreteFilamentSku[] = [];

  for (const f of catalog) {
    const tempInfo = getFilamentEffectiveTemp(f);
    const colors =
      f.popularColors && f.popularColors.length > 0
        ? f.popularColors
        : [
            {
              name: 'Стандартний',
              hex: '#334155',
              colorTone: f.primaryColorTone || 'black',
            },
          ];

    for (let cIdx = 0; cIdx < colors.length; cIdx++) {
      const color = colors[cIdx];
      // 1 Силка: Отримуємо пряме посилання конкретно на цей колір або єдиний стор
      const directStore =
        color.stores && color.stores.length > 0
          ? color.stores[0]
          : f.stores && f.stores.length > 0
          ? f.stores[0]
          : null;

      const spoolGrams = directStore?.spoolWeightGrams || f.spoolWeightGrams || 1000;
      const price = directStore?.priceUah || Math.round((f.approxPricePerKgUah * spoolGrams) / 1000);
      const calculatedPricePerKg = Math.round((price / spoolGrams) * 1000);
      const pricePerGram = price / spoolGrams;

      let weightDisplay = `${spoolGrams} г`;
      if (spoolGrams >= 1000) {
        weightDisplay = `${(spoolGrams / 1000).toFixed(spoolGrams % 1000 === 0 ? 1 : 2)} кг`;
      } else if (spoolGrams === 750) {
        weightDisplay = '0.75 кг';
      } else if (spoolGrams === 500) {
        weightDisplay = '0.5 кг';
      } else if (spoolGrams === 330) {
        weightDisplay = '0.33 кг';
      }

      // Визначаємо фасування: чи це Рефіл (Refill без котушки) чи З котушкою
      const isRefill =
        color.packagingType === 'refill' ||
        f.packagingType === 'refill' ||
        f.name.toLowerCase().includes('refill') ||
        f.name.toLowerCase().includes('рефіл') ||
        Boolean(f.badge && (f.badge.toLowerCase().includes('refill') || f.badge.toLowerCase().includes('рефіл'))) ||
        Boolean(
          directStore?.productTitle &&
            (directStore.productTitle.toLowerCase().includes('refill') ||
              directStore.productTitle.toLowerCase().includes('рефіл') ||
              directStore.productTitle.toLowerCase().includes('без котушки'))
        );

      const packagingType: PackagingType = isRefill ? 'refill' : 'spool';
      const packagingLabel = isRefill ? 'Рефіл (Refill)' : 'З котушкою';
      const packagingNameSuffix = isRefill ? ' · Рефіл' : ' · З котушкою';

      const skuName = `${f.brand} ${f.type} ${color.name} ${weightDisplay}${packagingNameSuffix}`;
      const colorSlug = `${color.colorTone || 'col'}-${cIdx}${isRefill ? '-refill' : ''}`;
      const skuId = `${f.id}-${colorSlug}`;

      const storeName = directStore?.storeName || 'Офіційний магазин';
      const storeUrl = directStore?.url || '#';
      const isOfficial = directStore?.isOfficialDistributor ?? true;

      skus.push({
        id: skuId,
        parentFilamentId: f.id,
        name: skuName,
        brand: f.brand,
        manufacturerId: f.manufacturerId,
        type: f.type,
        family: f.family,
        spoolWeightGrams: spoolGrams,
        weightKgDisplay: weightDisplay,
        diameterMm: f.diameterMm || 1.75,
        packagingType,
        packagingLabel,
        inStock: directStore?.inStock ?? f.inStock,
        stockStatusLabel: f.stockStatusLabel || (f.inStock ? 'В наявності' : 'Немає в наявності'),
        badge: f.badge,
        colorName: color.name,
        colorHex: color.hex,
        colorHexList: color.hexList,
        colorType: color.colorType || (color.colorTone === 'multicolor' ? 'rainbow' : 'solid'),
        colorTone: color.colorTone || f.primaryColorTone || 'black',
        isMulticolor:
          color.colorTone === 'multicolor' ||
          color.colorType === 'rainbow' ||
          color.colorType === 'dual' ||
          color.colorType === 'tri' ||
          color.colorType === 'gradient' ||
          (color.hexList && color.hexList.length > 1),
        priceUah: price,
        calculatedPricePerKg,
        pricePerGram,
        profileNozzle: tempInfo.nozzle,
        profileBed: tempInfo.bed,
        profileChamber: tempInfo.chamber,
        profileFan: tempInfo.fanSpeed,
        profileSpeed: f.recommendedSpeedMmS,
        profileIsCustom: tempInfo.isCustom,
        profileNotes: STANDARD_TEMPERATURE_PROFILES[f.type]?.notes,
        storeName,
        storeUrl,
        isOfficialDistributor: isOfficial,
        description: f.description,
      });
    }
  }

  return skus;
}

