import type { ParsedJob } from '../domain/types.ts';
import type { PrintPreviewData, PrintPreviewGroup, PrintPreviewPlate } from '../domain/printPreview.ts';
import { FILE_SIZE_LIMIT, readPrintArchive } from './printFileParser.ts';

export const PREVIEW_SEGMENT_LIMIT = 250_000;
const LINE_LIMIT = 1_000_000;
const LINE_LENGTH_LIMIT = 4096;
const PLATE_LIMIT = 64;
const GROUP_LIMIT = 64;
const COORDINATE_LIMIT = 100_000;
const decoder = new TextDecoder('utf-8', { fatal: true });
const unsupported = () => new Error('Цей файл містить непідтримувані команди переміщення. Для прев’ю експортуйте звичайний G-code з лінійними рухами або дугами в площині XY.');
const tooComplex = () => new Error('Файл надто складний для 3D-прев’ю у браузері. Розрахунок залишається доступним; для перегляду відкрийте файл у слайсері.');
const invalid = () => new Error('У файлі немає коректних координат для 3D-прев’ю.');
type Point = [number, number, number];
type Budget = { segments: number; groups: number; lines: number };

function argumentsFor(text: string): Record<string, number> {
  const args: Record<string, number> = Object.create(null);
  let offset = 0;
  for (const match of text.matchAll(/([A-Z])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))/g)) {
    if (text.slice(offset, match.index).trim() || Object.hasOwn(args, match[1])) throw invalid();
    offset = match.index! + match[0].length;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) throw invalid();
    args[match[1]] = value;
  }
  if (text.slice(offset).trim()) throw invalid();
  return args;
}

function checkPoint(point: Point) {
  if (point.some(value => !Number.isFinite(value) || Math.abs(value) > COORDINATE_LIMIT)) throw invalid();
}

function sweepAngle(start: number, end: number, clockwise: boolean, fullCircle = false): number {
  let sweep = end - start;
  if (clockwise) { if (sweep >= 0) sweep -= Math.PI * 2; }
  else if (sweep <= 0) sweep += Math.PI * 2;
  return fullCircle ? (clockwise ? -1 : 1) * Math.PI * 2 : sweep;
}

function arcPoints(start: Point, end: Point, args: Record<string, number>, scale: number, clockwise: boolean): Point[] {
  if (args.P !== undefined && args.P !== 0 || args.K !== undefined && args.K !== 0) throw unsupported();
  let cx: number;
  let cy: number;
  const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
  if (args.R !== undefined) {
    if (args.I !== undefined || args.J !== undefined || chord <= 1e-8) throw invalid();
    const radius = Math.abs(args.R * scale);
    if (!radius || chord > radius * 2 + 1e-6) throw invalid();
    const height = Math.sqrt(Math.max(0, radius ** 2 - (chord / 2) ** 2));
    const direction = (clockwise ? -1 : 1) * (args.R < 0 ? -1 : 1);
    cx = (start[0] + end[0]) / 2 - (end[1] - start[1]) / chord * height * direction;
    cy = (start[1] + end[1]) / 2 + (end[0] - start[0]) / chord * height * direction;
  } else {
    if (args.I === undefined && args.J === undefined) throw invalid();
    cx = start[0] + (args.I ?? 0) * scale;
    cy = start[1] + (args.J ?? 0) * scale;
  }
  const radius = Math.hypot(start[0] - cx, start[1] - cy);
  const endRadius = Math.hypot(end[0] - cx, end[1] - cy);
  if (!Number.isFinite(radius) || radius <= 1e-8 || Math.abs(endRadius - radius) > Math.max(0.05, radius * 0.001)) throw invalid();
  const startAngle = Math.atan2(start[1] - cy, start[0] - cx);
  const sweep = sweepAngle(startAngle, Math.atan2(end[1] - cy, end[0] - cx), clockwise, chord <= 1e-8);
  const count = Math.max(1, Math.ceil(Math.abs(sweep) * radius), Math.ceil(Math.abs(sweep) / (Math.PI / 18)));
  if (count > 2048) throw tooComplex();
  const points: Point[] = [];
  for (let step = 1; step <= count; step++) {
    const ratio = step / count;
    const angle = startAngle + sweep * ratio;
    const point: Point = step === count ? [...end] : [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), start[2] + (end[2] - start[2]) * ratio];
    checkPoint(point);
    points.push(point);
  }
  return points;
}

function parseToolpaths(text: string, metadata: ParsedJob['plates'][number] | undefined, budget: Budget, warnings: string[]): PrintPreviewGroup[] {
  const groups = new Map<number, { colorHex: string; values: number[] }>();
  let position: Point = [0, 0, 0];
  const known = [false, false, false];
  const offset: Point = [0, 0, 0];
  let relative = false;
  let relativeE = false;
  let positioningKnown = true;
  let extrusionModeKnown = true;
  let extrusionKnown = true;
  let unitsKnown = true;
  let extrusion = 0;
  let scale = 1;
  let plane = 17;
  let tray = metadata?.filaments.length === 1 ? metadata.filaments[0].trayId : 1;
  let conditionalDepth = 0;
  const retracted = new Map<number, number>();
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };

  const emit = (start: Point, end: Point) => {
    if (Math.hypot(...end.map((value, index) => value - start[index])) < 1e-8) return;
    if (++budget.segments > PREVIEW_SEGMENT_LIMIT) throw tooComplex();
    let group = groups.get(tray);
    if (!group) {
      if (++budget.groups > GROUP_LIMIT) throw tooComplex();
      const color = metadata?.filaments.find(filament => filament.trayId === tray)?.colorHex;
      group = { colorHex: color && /^#[\da-f]{6}$/i.test(color) ? color : '#808080', values: [] };
      groups.set(tray, group);
    }
    group.values.push(...start, ...end);
  };

  // Marlin semantics: G90/G91 reset the M82/M83 override; G92 changes logical coordinates without moving the nozzle.
  for (let cursor = 0; cursor < text.length;) {
    if (++budget.lines > LINE_LIMIT) throw tooComplex();
    const next = text.indexOf('\n', cursor);
    const lineEnd = next < 0 ? text.length : next;
    if (lineEnd - cursor > LINE_LENGTH_LIMIT) throw tooComplex();
    let line = text.slice(cursor, lineEnd).split(';', 1)[0].replace(/\([^()]*\)/g, '').trim().toUpperCase();
    cursor = lineEnd + 1;
    if (!line) continue;
    line = line.replace(/\*\d+\s*$/, '');
    const command = line.match(/^(?:N\d+\s*)?([GMT])(\d+(?:\.\d+)?)\s*/);
    if (!command) throw invalid();
    const kind = command[1];
    const code = Number(command[2]);
    const rest = line.slice(command[0].length);
    if (kind === 'G' && (code === 5 || code === 6 || code === 26 || code === 53 || code >= 54 && code <= 59.3 || code === 90.1 || code === 91.1 || code === 92.1 || code === 60 || code === 61 || code === 10 && rest.trim())) throw unsupported();
    if (kind === 'M' && (code === 98 || code === 99 || code === 206 || code === 218 || code === 402 || code === 428 || code === 665 || code === 666 || code === 808 || code >= 810 && code <= 819 || code === 1020)) throw unsupported();
    if (kind === 'M' && code === 622) {
      if (++conditionalDepth > 16) throw tooComplex();
      warn('Умовні службові траєкторії, які залежать від налаштувань принтера, не показано.');
      continue;
    }
    if (kind === 'M' && code === 623) {
      if (!conditionalDepth) throw invalid();
      conditionalDepth--;
      continue;
    }
    if (conditionalDepth) {
      if (kind === 'T' && code <= 254) tray = 0;
      if (kind === 'M' && (code === 82 || code === 83)) extrusionModeKnown = false;
      if (kind === 'G' && (code === 17 || code === 18 || code === 19)) throw unsupported();
      if (kind !== 'G') continue;
      if (code === 90 || code === 91) { positioningKnown = false; extrusionModeKnown = false; }
      if (code === 20 || code === 21) unitsKnown = false;
      if (code === 92 && /[XYZ]/.test(rest)) throw unsupported();
      if (code === 28) {
        const axes = [...rest.matchAll(/[XYZ]/g)].map(match => 'XYZ'.indexOf(match[0]));
        if ((axes.length ? axes : [0, 1, 2]).some(axis => offset[axis] !== 0)) throw unsupported();
      }
      if (code >= 0 && code <= 3 || code === 92) {
        const args = argumentsFor(rest);
        for (let axis = 0; axis < 3; axis++) { if (args['XYZ'[axis]] !== undefined) known[axis] = false; }
        if (args.E !== undefined) extrusionKnown = false;
      }
      if (code === 12 || code === 27 || code === 28 || code === 29 || code === 30 || code === 32 || code >= 38 && code <= 38.5 || code === 380) known.fill(false);
      continue;
    }
    if (kind === 'T') {
      if (rest.trim() || !Number.isInteger(code)) throw invalid();
      // Bambu's own G-code viewer ignores these special commands without changing the filament ID.
      if (code === 255 || code === 1000 || code === 1100) continue;
      if (code > 254) throw unsupported();
      tray = code + 1;
      continue;
    }
    if (kind === 'M') {
      if (code === 82 || code === 83) {
        if (rest.trim()) throw invalid();
        relativeE = code === 83;
        extrusionModeKnown = true;
        if (relativeE && !extrusionKnown) { extrusion = 0; extrusionKnown = true; retracted.clear(); }
      }
      if (code === 290) warn('Прев’ю показує номінальні траєкторії слайсера без апаратного калібрування та компенсації поверхні столу.');
      continue;
    }
    if (code === 90 || code === 91) {
      if (rest.trim()) throw invalid();
      relative = code === 91;
      relativeE = relative;
      positioningKnown = true;
      extrusionModeKnown = true;
      if (relativeE && !extrusionKnown) { extrusion = 0; extrusionKnown = true; retracted.clear(); }
      continue;
    }
    if (code === 20 || code === 21) {
      if (rest.trim()) throw invalid();
      scale = code === 20 ? 25.4 : 1;
      unitsKnown = true;
      continue;
    }
    if (code === 17 || code === 18 || code === 19) { plane = code; continue; }
    if (code === 28) {
      const axes = [...rest.matchAll(/[XYZ]/g)].map(match => 'XYZ'.indexOf(match[0]));
      for (const axis of axes.length ? axes : [0, 1, 2]) { known[axis] = false; offset[axis] = 0; }
      continue;
    }
    if (code === 12 || code === 27 || code === 29 || code === 29.1 || code === 29.2 || code === 30 || code === 32 || code >= 38 && code <= 38.5 || code === 380) {
      warn('Прев’ю показує номінальні траєкторії слайсера без апаратного калібрування та компенсації поверхні столу.');
      if (code === 12 || code === 27 || code === 29 || code === 30 || code === 32) known.fill(false);
      if (code >= 38 && code <= 38.5 || code === 380) {
        for (let axis = 0; axis < 3; axis++) { if (rest.includes('XYZ'[axis])) known[axis] = false; }
      }
      continue;
    }
    if (code !== 0 && code !== 1 && code !== 2 && code !== 3 && code !== 92) continue;
    const args = argumentsFor(rest);
    const allowedArguments = code === 92 ? 'XYZE' : code === 2 || code === 3 ? 'XYZEFIJRKPS' : 'XYZEFS';
    if (Object.keys(args).some(key => !allowedArguments.includes(key))) throw unsupported();
    if (!unitsKnown || code !== 92 && !positioningKnown || args.E !== undefined && !extrusionModeKnown) throw unsupported();
    if (code === 92) {
      for (let axis = 0; axis < 3; axis++) {
        const value = args['XYZ'[axis]];
        if (value === undefined) continue;
        if (!known[axis]) { position[axis] = value * scale; known[axis] = true; }
        offset[axis] = position[axis] - value * scale;
      }
      if (args.E !== undefined) {
        extrusion = args.E * scale;
        if (!extrusionKnown) retracted.clear();
        extrusionKnown = true;
      }
      checkPoint(position);
      continue;
    }
    const startKnown = known.every(Boolean);
    const end = position.map((value, axis) => {
      const target = args['XYZ'[axis]];
      if (target === undefined) return value;
      if (!relative) known[axis] = true;
      return relative ? value + target * scale : target * scale + offset[axis];
    }) as Point;
    checkPoint(end);
    const nextExtrusion = args.E === undefined ? extrusion : relativeE ? extrusion + args.E * scale : args.E * scale;
    if (!Number.isFinite(nextExtrusion) || Math.abs(nextExtrusion) > 100_000_000) throw invalid();
    const extrusionStartKnown = extrusionKnown;
    const delta = extrusionKnown ? nextExtrusion - extrusion : 0;
    if (args.E !== undefined) extrusionKnown = true;
    const debt = retracted.get(tray) ?? 0;
    const deposited = delta > 0 ? Math.max(0, delta - debt) : 0;
    retracted.set(tray, Math.max(0, debt - delta));
    if ((code === 2 || code === 3) && plane !== 17) throw unsupported();
    const points = code === 2 || code === 3 ? arcPoints(position, end, args, scale, code === 2) : [end];
    if (deposited > 1e-8 && points.some(point => Math.hypot(...point.map((value, axis) => value - position[axis])) > 1e-8)) {
      if (!startKnown || known.some(value => !value)) warn('Деякі початкові траєкторії пропущено, бо їхня позиція залежить від принтера.');
      else {
        let start = position;
        for (const point of points) { emit(start, point); start = point; }
      }
    }
    if (!extrusionStartKnown && args.E !== undefined) warn('Деякі початкові траєкторії пропущено, бо їхня позиція залежить від принтера.');
    position = end;
    extrusion = nextExtrusion;
  }
  if (conditionalDepth) throw invalid();
  return [...groups].map(([trayId, group]) => ({ trayId, colorHex: group.colorHex, positions: Float32Array.from(group.values) }));
}

export function parsePrintPreview(fileName: string, bytes: Uint8Array, job?: ParsedJob): PrintPreviewData {
  const result: PrintPreviewData = { plates: [], warnings: [] };
  try {
    if (bytes.byteLength > FILE_SIZE_LIMIT) throw tooComplex();
    const texts = new Map<number, string>();
    if (/\.gcode$/i.test(fileName)) texts.set(1, decoder.decode(bytes));
    else if (/\.3mf$/i.test(fileName)) {
      const { files } = readPrintArchive(bytes);
      const gcode = [...files].filter(([name]) => /\.gcode$/i.test(name));
      for (const [name, text] of gcode) {
        const index = Number(name.match(/(?:^|\/)plate_(\d+)\.gcode$/i)?.[1] ?? (gcode.length === 1 ? 1 : NaN));
        if (!Number.isSafeInteger(index) || index < 1 || texts.has(index)) throw invalid();
        texts.set(index, text);
      }
    } else throw new Error('3D-прев’ю підтримує текстовий .gcode та нарізаний .3mf із вкладеним G-code.');
    const indices = [...new Set([...texts.keys(), ...(job?.plates.map(plate => plate.plateIndex) ?? [])])].sort((a, b) => a - b);
    if (indices.length > PLATE_LIMIT) throw tooComplex();
    if (!indices.length) throw new Error('Файл не містить траєкторій нарізки для 3D-прев’ю. Експортуйте .gcode або .gcode.3mf після нарізки.');
    const budget: Budget = { segments: 0, groups: 0, lines: 0 };
    for (const plateIndex of indices) {
      const metadata = job?.plates.find(plate => plate.plateIndex === plateIndex);
      const plate: PrintPreviewPlate = { plateIndex, plateName: metadata?.plateName ?? `Пластина ${plateIndex}`, groups: [], warnings: [] };
      result.plates.push(plate);
      try {
        const text = texts.get(plateIndex);
        if (text === undefined) throw new Error('Для цієї пластини у файлі немає вкладеного G-code. Розрахунок за метаданими доступний.');
        plate.groups = parseToolpaths(text, metadata, budget, plate.warnings);
        if (!plate.groups.length) throw new Error('У G-code цієї пластини немає рухів із нанесенням матеріалу для 3D-прев’ю.');
        if (plate.groups.some(group => !metadata?.filaments.some(filament => filament.trayId === group.trayId))) plate.warnings.push('Колір частини траєкторій невідомий; їх показано сірим.');
      } catch (error) {
        plate.groups = [];
        plate.unavailableReason = error instanceof Error ? error.message : 'Не вдалося побудувати 3D-прев’ю цієї пластини.';
      }
    }
  } catch (error) {
    result.plates = [];
    result.warnings.push(error instanceof Error && !('status' in error) ? error.message : 'Не вдалося прочитати дані 3D-прев’ю: файл пошкоджений або перевищує ліміти.');
  }
  return result;
}
