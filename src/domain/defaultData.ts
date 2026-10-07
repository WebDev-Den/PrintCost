import type {
  MaterialProfile,
  PrinterProfile,
  PricingSettings,
  ParsedJob,
  UserProfile,
  CalculationSnapshot,
} from './types.ts';
import { calculatePrintCost } from './calculator.ts';

export const INITIAL_USER_PROFILE: UserProfile = {
  id: 'usr_demo_7781',
  email: 'workshop@printcost.local',
  fullName: 'Олександр Коваленко',
  workshopName: '3D Studio Horizon',
  createdAt: '2026-03-01T10:00:00Z',
  isDemoUser: true,
};

export const INITIAL_MATERIALS: MaterialProfile[] = [
  {
    id: 'mat_petg_bambu',
    name: 'Bambu PETG Basic Black',
    type: 'PETG',
    family: 'Стандартні',
    brand: 'Bambu Lab',
    colorHex: '#1e293b',
    colorName: 'Чорний',
    pricePerKgUah: '650.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '650.00',
    isArchived: false,
    createdAt: '2026-03-01T10:00:00Z',
    notes: 'Основний технічний філамент для деталей та кронштейнів',
  },
  {
    id: 'mat_pla_esun',
    name: 'eSUN PLA+ White',
    type: 'PLA',
    family: 'Стандартні',
    brand: 'eSUN',
    colorHex: '#f8fafc',
    colorName: 'Білий',
    pricePerKgUah: '600.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '600.00',
    isArchived: false,
    createdAt: '2026-03-01T10:00:00Z',
    notes: 'Прототипи та декоративні корпуси',
  },
  {
    id: 'mat_abs_devil',
    name: 'Devil Design ABS Black',
    type: 'ABS',
    family: 'Інженерні',
    brand: 'Devil Design',
    colorHex: '#0f172a',
    colorName: 'Чорний',
    pricePerKgUah: '720.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '720.00',
    isArchived: false,
    createdAt: '2026-03-02T10:00:00Z',
    notes: 'Термостійкі деталі авто',
  },
  {
    id: 'mat_asa_bambu',
    name: 'Bambu ASA Gray',
    type: 'ASA',
    family: 'Інженерні',
    brand: 'Bambu Lab',
    colorHex: '#64748b',
    colorName: 'Сірий',
    pricePerKgUah: '980.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '980.00',
    isArchived: false,
    createdAt: '2026-03-02T12:00:00Z',
    notes: 'Стійкість до ультрафіолету',
  },
  {
    id: 'mat_tpu_95a',
    name: 'eSUN TPU-95A Red',
    type: 'TPU',
    family: 'Гнучкі',
    brand: 'eSUN',
    colorHex: '#ef4444',
    colorName: 'Червоний',
    pricePerKgUah: '1100.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '1100.00',
    isArchived: false,
    createdAt: '2026-03-03T09:00:00Z',
    notes: 'Амортизаційні демпфери та прокладки',
  },
  {
    id: 'mat_pla_cf_bambu',
    name: 'Bambu PLA-CF Carbon',
    type: 'PLA-CF',
    family: 'Композитні',
    brand: 'Bambu Lab',
    colorHex: '#334155',
    colorName: 'Вуглецевий темно-сірий',
    pricePerKgUah: '1250.00',
    spoolWeightGrams: '1000',
    spoolPriceUah: '1250.00',
    isArchived: false,
    createdAt: '2026-03-04T15:00:00Z',
    notes: 'Підвищена жорсткість та матова поверхня',
  },
];

export const INITIAL_PRINTERS: PrinterProfile[] = [
  {
    id: 'prn_bambu_p1s',
    name: 'Bambu Lab P1S #1 (AMS)',
    modelId: 'Bambu Lab P1S',
    averagePowerWatts: '100', // 100W avg print power
    costCalculationMode: 'manual_rate',
    machineHourlyRateUah: '10.00',
    isDefault: true,
    createdAt: '2026-03-01T10:00:00Z',
  },
  {
    id: 'prn_bambu_x1c',
    name: 'Bambu Lab X1-Carbon #2',
    modelId: 'Bambu Lab X1-Carbon',
    averagePowerWatts: '125',
    costCalculationMode: 'depreciation',
    printerPurchasePriceUah: '48000',
    lifespanHours: '4000',
    maintenanceHourlyRateUah: '5.00', // 48000/4000 + 5 = 12 + 5 = 17 грн/год
    machineHourlyRateUah: '17.00',
    isDefault: false,
    createdAt: '2026-03-01T11:00:00Z',
  },
  {
    id: 'prn_bambu_a1m',
    name: 'Bambu Lab A1 mini #3',
    modelId: 'Bambu Lab A1 mini',
    averagePowerWatts: '75',
    costCalculationMode: 'manual_rate',
    machineHourlyRateUah: '8.00',
    isDefault: false,
    createdAt: '2026-03-02T14:00:00Z',
  },
];

export const INITIAL_PRICING_SETTINGS: PricingSettings = {
  electricityTariffUahPerKwh: '5.00',
  pricingMode: 'markup',
  defaultMarkupPercent: '100',
  defaultMarginPercent: '50',
  scrapReservePercent: '10',
  minOrderPriceUah: '200',
  roundingMode: 'up_10',
  defaultOperatorFeeUah: '20',
  defaultPackagingFeeUah: '0',
  defaultPostProcessingFeeUah: '0',
  defaultOtherFeeUah: '0',
  defaultPrinterId: 'prn_bambu_p1s',
  filamentMappingPresets: {
    PETG: 'mat_petg_bambu',
    PLA: 'mat_pla_esun',
    ABS: 'mat_abs_devil',
    ASA: 'mat_asa_bambu',
    TPU: 'mat_tpu_95a',
    'PLA-CF': 'mat_pla_cf_bambu',
  },
  theme: 'light',
  timezone: 'Europe/Kyiv',
};

/**
 * Agreed demonstration job meeting Section 9 specification exactly:
 * - PETG: 100 g @ 650 грн/кг
 * - PLA: 50 g @ 600 грн/кг
 * - Time: 7200 s (2.0 hours)
 * - Power: 100 W
 * - Tariff: 5 грн/кВт·год
 * - Machine rate: 10 грн/год
 * - Operator fee: 20 грн
 * - Reserve: 10%
 * - Markup: 100%
 * - Min order: 200 грн
 * - Rounding: up to 10 грн
 */
export const DEMO_JOB_SECTION_9: ParsedJob = {
  fileName: 'bracket_mount_v2.gcode.3mf',
  fileSizeBytes: 2418910,
  slicerSource: 'Bambu Studio v1.9.3.50',
  printerModelName: 'Bambu Lab P1S 0.4 nozzle',
  nozzleDiameterMm: '0.40',
  isDemoJob: true,
  parseStatus: 'success',
  totalPredictionSeconds: 7200,
  totalWeightGrams: 150,
  warnings: [
    'Зверніть увагу: на другій пластині використовується комбінований шар підтримки',
  ],
  plates: [
    {
      plateIndex: 1,
      plateName: 'Пластина 1 — Кронштейн та фіксатор',
      predictionSeconds: 7200,
      totalWeightGrams: 150,
      selected: true,
      repeatsCount: 1,
      filaments: [
        {
          trayId: 1,
          type: 'PETG',
          colorHex: '#1e293b',
          colorName: 'Чорний',
          weightGrams: 100,
          lengthMeters: 33.2,
        },
        {
          trayId: 2,
          type: 'PLA',
          colorHex: '#f8fafc',
          colorName: 'Білий',
          weightGrams: 50,
          lengthMeters: 16.8,
        },
      ],
    },
  ],
};

/**
 * Creates seed calculation snapshots for history view
 */
export function getInitialCalculationSnapshots(): CalculationSnapshot[] {
  // Agreed example snapshot #1
  const calcInput1 = {
    job: DEMO_JOB_SECTION_9,
    filaments: [
      {
        key: 'p1_t1',
        plateIndex: 1,
        plateName: 'Пластина 1 — Кронштейн та фіксатор',
        trayId: 1,
        colorHex: '#1e293b',
        typeFromFile: 'PETG',
        weightGrams: '100',
        lengthMeters: '33.2',
        mappedMaterialId: 'mat_petg_bambu',
        mappedMaterialName: 'Bambu PETG Basic Black',
        pricePerKgUah: '650.00',
        costUah: '65.00',
        matchMethod: 'exact_preset' as const,
      },
      {
        key: 'p1_t2',
        plateIndex: 1,
        plateName: 'Пластина 1 — Кронштейн та фіксатор',
        trayId: 2,
        colorHex: '#f8fafc',
        typeFromFile: 'PLA',
        weightGrams: '50',
        lengthMeters: '16.8',
        mappedMaterialId: 'mat_pla_esun',
        mappedMaterialName: 'eSUN PLA+ White',
        pricePerKgUah: '600.00',
        costUah: '30.00',
        matchMethod: 'exact_preset' as const,
      },
    ],
    selectedPrinterId: 'prn_bambu_p1s',
    averagePowerWatts: '100',
    electricityTariffUahPerKwh: '5.00',
    machineHourlyRateUah: '10.00',
    operatorFeeUah: '20',
    packagingFeeUah: '0',
    postProcessingFeeUah: '0',
    otherFeeUah: '0',
    scrapReservePercent: '10',
    pricingMode: 'markup' as const,
    markupPercent: '100',
    marginPercent: '50',
    minOrderPriceUah: '200',
    roundingMode: 'up_10' as const,
  };

  const result1 = calculatePrintCost(calcInput1);

  // Snapshot #2: Damping feet (TPU)
  const job2: ParsedJob = {
    fileName: 'damping_feet_set_x4.gcode.3mf',
    fileSizeBytes: 1489200,
    slicerSource: 'Bambu Studio v1.9.3.50',
    printerModelName: 'Bambu Lab A1 mini 0.4 nozzle',
    nozzleDiameterMm: '0.40',
    parseStatus: 'success',
    totalPredictionSeconds: 5400, // 1.5 hours
    totalWeightGrams: 80,
    warnings: [],
    plates: [
      {
        plateIndex: 1,
        plateName: 'Пластина 1 — 4x Демпфери',
        predictionSeconds: 5400,
        totalWeightGrams: 80,
        selected: true,
        repeatsCount: 1,
        filaments: [
          {
            trayId: 1,
            type: 'TPU',
            colorHex: '#ef4444',
            colorName: 'Червоний',
            weightGrams: 80,
            lengthMeters: 24.1,
          },
        ],
      },
    ],
  };

  const calcInput2 = {
    job: job2,
    filaments: [
      {
        key: 'p1_t1',
        plateIndex: 1,
        plateName: 'Пластина 1 — 4x Демпфери',
        trayId: 1,
        colorHex: '#ef4444',
        typeFromFile: 'TPU',
        weightGrams: '80',
        lengthMeters: '24.1',
        mappedMaterialId: 'mat_tpu_95a',
        mappedMaterialName: 'eSUN TPU-95A Red',
        pricePerKgUah: '1100.00',
        costUah: '88.00',
        matchMethod: 'exact_preset' as const,
      },
    ],
    selectedPrinterId: 'prn_bambu_a1m',
    averagePowerWatts: '75',
    electricityTariffUahPerKwh: '5.00',
    machineHourlyRateUah: '8.00',
    operatorFeeUah: '15',
    packagingFeeUah: '10',
    postProcessingFeeUah: '0',
    otherFeeUah: '0',
    scrapReservePercent: '10',
    pricingMode: 'markup' as const,
    markupPercent: '100',
    marginPercent: '50',
    minOrderPriceUah: '200',
    roundingMode: 'up_10' as const,
  };

  const result2 = calculatePrintCost(calcInput2);

  // Snapshot #3: Incomplete draft with missing material price
  const job3: ParsedJob = {
    fileName: 'custom_drone_canopy.gcode.3mf',
    fileSizeBytes: 3120400,
    slicerSource: 'Bambu Studio v1.9.3.50',
    printerModelName: 'Bambu Lab X1-Carbon',
    nozzleDiameterMm: '0.40',
    parseStatus: 'success',
    totalPredictionSeconds: 10800, // 3 hours
    totalWeightGrams: 110,
    warnings: ['Матеріал Nylon-CF не має зіставлення у вашому каталозі'],
    plates: [
      {
        plateIndex: 1,
        plateName: 'Пластина 1 — Капот',
        predictionSeconds: 10800,
        totalWeightGrams: 110,
        selected: true,
        repeatsCount: 1,
        filaments: [
          {
            trayId: 1,
            type: 'PAHT-CF',
            colorHex: '#1e293b',
            colorName: 'Carbon',
            weightGrams: 110,
            lengthMeters: 36.4,
          },
        ],
      },
    ],
  };

  const calcInput3 = {
    job: job3,
    filaments: [
      {
        key: 'p1_t1',
        plateIndex: 1,
        plateName: 'Пластина 1 — Капот',
        trayId: 1,
        colorHex: '#1e293b',
        typeFromFile: 'PAHT-CF',
        weightGrams: '110',
        lengthMeters: '36.4',
        mappedMaterialId: null,
        mappedMaterialName: undefined,
        pricePerKgUah: null, // missing price!
        costUah: null,
        matchMethod: 'unmatched' as const,
      },
    ],
    selectedPrinterId: 'prn_bambu_x1c',
    averagePowerWatts: '125',
    electricityTariffUahPerKwh: '5.00',
    machineHourlyRateUah: '17.00',
    operatorFeeUah: '30',
    packagingFeeUah: '15',
    postProcessingFeeUah: '0',
    otherFeeUah: '0',
    scrapReservePercent: '15',
    pricingMode: 'markup' as const,
    markupPercent: '120',
    marginPercent: '54.5',
    minOrderPriceUah: '300',
    roundingMode: 'up_50' as const,
  };

  const result3 = calculatePrintCost(calcInput3);

  return [
    {
      id: 'calc_demo_001',
      title: 'Кронштейн кріплення v2 (узгоджений приклад)',
      createdAt: '2026-03-05T14:30:00Z',
      status: result1.status,
      input: calcInput1,
      result: result1,
      fileName: 'bracket_mount_v2.gcode.3mf',
      clientName: 'ТОВ "Механіка"',
      notes: 'Еталонний тестовий розрахунок для серійного замовлення',
    },
    {
      id: 'calc_demo_002',
      title: 'Комплект демпферів TPU (4 шт.)',
      createdAt: '2026-03-04T11:15:00Z',
      status: result2.status,
      input: calcInput2,
      result: result2,
      fileName: 'damping_feet_set_x4.gcode.3mf',
      clientName: 'Андрій М.',
      notes: 'Замовлення на гнучкі опори',
    },
    {
      id: 'calc_demo_003',
      title: 'Капот дрона PAHT-CF (чернетка без ціни)',
      createdAt: '2026-03-03T18:40:00Z',
      status: result3.status,
      input: calcInput3,
      result: result3,
      fileName: 'custom_drone_canopy.gcode.3mf',
      clientName: 'SkyTech Lab',
      notes: 'Очікується точна ціна закупівлі композитного філаменту PAHT-CF',
    },
  ];
}
