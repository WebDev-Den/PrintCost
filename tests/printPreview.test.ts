import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { FILE_SIZE_LIMIT, parsePrintFile } from '../src/services/printFileParser.ts';
import { parsePrintPreview, PREVIEW_SEGMENT_LIMIT } from '../src/services/printPreviewParser.ts';

const header = '; estimated printing time (normal mode) = 1m\n; filament used [g] = 20;10\n; filament_type = PLA;PETG\n; filament_colour = #123456;#abcdef\n';
const start = 'G90\nM82\nG92 E0\nG1 X0 Y0 Z0.2\n';
const preview = (motion: string) => {
  const text = header + start + motion;
  return parsePrintPreview('part.gcode', strToU8(text), parsePrintFile('part.gcode', strToU8(text)));
};
const positions = (motion: string, group = 0) => Array.from(preview(motion).plates[0].groups[group].positions);
const archive = (entries: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test('preview draws deposited paths, ignores travel/retraction and keeps cost metadata unchanged', () => {
  const text = header + start + 'G1 X10 E1\nG0 X20\nG1 E-1\nG1 X25 E1\nG1 X30 E2\nT1\nG92 E0\nG1 Y10 E1\n';
  const bytes = strToU8(text);
  const job = parsePrintFile('part.gcode', bytes);
  const before = structuredClone(job);
  const result = parsePrintPreview('part.gcode', bytes, job);
  assert.deepEqual(job, before);
  assert.equal(job.parseStatus, 'success');
  assert.equal(result.plates[0].groups.length, 2);
  const [pla, petg] = result.plates[0].groups;
  assert.equal(pla.trayId, 1);
  assert.equal(pla.colorHex, '#123456');
  assert.equal(pla.positions.length, 12);
  assert.deepEqual(Array.from(pla.positions).filter((_, index) => index % 3 !== 2), [0, 0, 10, 0, 25, 0, 30, 0]);
  assert.equal(petg.trayId, 2);
  assert.equal(petg.colorHex, '#abcdef');
  assert.deepEqual(Array.from(petg.positions).filter((_, index) => index % 3 !== 2), [30, 0, 30, 10]);
});

test('G90/G91 clear extrusion overrides while M82/M83 work independently of XYZ mode', () => {
  const values = positions('M83\nG1 X10 E1\nG90\nG1 X20 E1\nG1 X30 E2\nG91\nG1 X5 E1\nM82\nG1 X5 E4\n');
  assert.deepEqual(values.filter((_, index) => index % 3 === 0), [0, 10, 20, 30, 30, 35, 35, 40]);
  assert.equal(values.length, 24);
});

test('G92 changes logical XYZ offsets without moving the physical nozzle', () => {
  const values = positions('G1 X10 Y20\nG92 X0 Y0 E0\nG1 X5 Y5 E1\nG92 X100 E0\nG1 X105 E1\n');
  assert.deepEqual(values.filter((_, index) => index % 3 !== 2), [10, 20, 15, 25, 15, 25, 20, 25]);
});

test('inch units convert XYZ and extrusion and can switch back to millimetres', () => {
  const values = positions('G20\nG1 X1 E1\nG21\nG1 X50 E26\n');
  close(values[3], 25.4);
  close(values[6], 25.4);
  close(values[9], 50);
});

test('XY I/J arcs preserve direction, endpoints, full circles and helical Z interpolation', () => {
  const ccw = positions('G1 X1 Y0\nG3 X0 Y1 I-1 J0 E1\n');
  assert.ok(ccw.length > 6);
  assert.ok(ccw[3] < 1 && ccw[3] > 0);
  assert.ok(ccw[4] > 0);
  close(ccw.at(-3)!, 0);
  close(ccw.at(-2)!, 1);
  const cw = positions('G1 X1 Y0\nG2 X0 Y-1 I-1 J0 E1\n');
  assert.ok(cw[4] < 0);
  const full = positions('G2 I5 J0 E1\n');
  assert.ok(full.length > 180);
  close(full.at(-3)!, 0);
  close(full.at(-2)!, 0);
  const helix = positions('G1 X1\nG3 X0 Y1 Z2 I-1 E1\n');
  assert.ok(helix[5] > 0.2 && helix[5] < 2);
  close(helix.at(-1)!, 2);
});

test('signed R arcs distinguish minor and major sweeps', () => {
  const minor = positions('G3 X10 Y0 R10 E1\n');
  const major = positions('G3 X10 Y0 R-10 E1\n');
  assert.ok(major.length > minor.length);
  assert.ok(minor[4] < 0);
  close(minor.at(-3)!, 10);
  close(major.at(-3)!, 10);
});

test('comments, numbered compact commands and checksums do not create false geometry', () => {
  assert.deepEqual(positions('N12 G1X10Y0E1 (path)*42 ; ignored X999 E100\n').filter((_, index) => index % 3 !== 2), [0, 0, 10, 0]);
});

test('multi-plate sliced 3MF keeps sparse plate and tray IDs with separate colours', () => {
  const xml = '<config><plate><metadata key="index" value="4"/><metadata key="prediction" value="60"/><filament id="3" type="PLA" color="#112233" used_g="20"/></plate><plate><metadata key="index" value="2"/><metadata key="prediction" value="60"/><filament id="1" type="PETG" color="#aabbcc" used_g="10"/></plate></config>';
  const bytes = archive({ 'Metadata/slice_info.config': xml, 'Metadata/plate_4.gcode': start + 'T2\nG1 X40 E1', 'Metadata/plate_2.gcode': start + 'G1 X20 E1' });
  const job = parsePrintFile('parts.gcode.3mf', bytes);
  const result = parsePrintPreview('parts.gcode.3mf', bytes, job);
  assert.deepEqual(result.plates.map(plate => [plate.plateIndex, plate.groups[0].trayId, plate.groups[0].colorHex]), [[2, 1, '#aabbcc'], [4, 3, '#112233']]);
  assert.equal(result.plates[0].groups[0].positions[3], 20);
  assert.equal(result.plates[1].groups[0].positions[3], 40);
});

test('metadata-only plates and plain files without toolpaths explain why preview is unavailable', () => {
  const xml = '<config><plate><metadata key="index" value="2"/><metadata key="prediction" value="60"/><filament id="1" type="PLA" color="#112233" used_g="20"/></plate></config>';
  const bytes = archive({ 'Metadata/slice_info.config': xml });
  const job = parsePrintFile('stats.3mf', bytes);
  assert.equal(job.parseStatus, 'success');
  assert.match(parsePrintPreview('stats.3mf', bytes, job).plates[0].unavailableReason!, /немає вкладеного G-code/);
  assert.match(preview('; only statistics').plates[0].unavailableReason!, /немає рухів/);
  assert.equal(parsePrintPreview('mesh.3mf', archive({ '3D/3dmodel.model': '<model/>' })).plates.length, 0);
});

test('unknown tool colours stay grey while Bambu special commands preserve the last valid tray', () => {
  const result = preview('T3\nG1 X10 E1\nT255\nG1 Y10 E2\nT1\nT1000\nT1100\nG1 X20 E3\n');
  assert.deepEqual(result.plates[0].groups.map(group => [group.trayId, group.colorHex]), [[4, '#808080'], [2, '#abcdef']]);
  assert.equal(result.plates[0].groups[0].positions.length, 12);
  assert.match(result.plates[0].warnings[0], /сірим/);
});

test('relative preparation and stand-alone extrusion before homing do not invent printed segments', () => {
  const text = header + 'G91\nG1 Z5\nG90\nG92 E0\nG1 E50\nG28\nG1 X0 Y0 Z0.2\nG92 E0\nG1 X10 E1\n';
  const result = parsePrintPreview('bambu.gcode', strToU8(text), parsePrintFile('bambu.gcode', strToU8(text)));
  assert.equal(result.plates[0].groups[0].positions.length, 6);
  assert.deepEqual(Array.from(result.plates[0].groups[0].positions).filter((_, index) => index % 3 !== 2), [0, 0, 10, 0]);
});

test('Bambu conditional blocks are omitted, recover absolute positions and display nominal calibration warnings', () => {
  // Behaviours verified against BambuStudio's P1S machine_start_gcode and GCodeProcessor.cpp.
  const preparation = 'M290 X40 Y40 Z2\nG91\nG380 S2 Z10\nG1 Z2\nG90\nG28 X\nG1 X10 Y200\nG92 E0\nG1 E30\nG28 Z P0 T300\nG29.2 S0\nG0 Z5\nM622 J1\nG29 A X10 Y10 I100 J100\nM622 J0\nG28\nM623\nM623\nG90\nM83\nT0\nT1000\nG1 X15 Y1 Z0.3\nG1 E2\nG0 X100 E5\nG29.1 Z-0.04\n';
  const text = header + preparation;
  const result = parsePrintPreview('p1s.gcode', strToU8(text), parsePrintFile('p1s.gcode', strToU8(text)));
  assert.equal(result.plates[0].groups[0].positions.length, 6);
  assert.deepEqual(Array.from(result.plates[0].groups[0].positions).filter((_, index) => index % 3 !== 2), [15, 1, 100, 1]);
  assert.ok(result.plates[0].warnings.some(warning => /Умовні/.test(warning)));
  assert.ok(result.plates[0].warnings.some(warning => /номінальні/.test(warning)));
});

test('conditional XYZ, E and modal changes require fresh safe positioning before drawing', () => {
  const result = preview('M622 J1\nG1 X500 Y500 E100\nG91\nM82\nM623\nG90\nM83\nG1 X0 Y0 Z0.2\nG1 X10 E1\n');
  assert.equal(result.plates[0].groups[0].positions.length, 6);
  assert.deepEqual(Array.from(result.plates[0].groups[0].positions).filter((_, index) => index % 3 !== 2), [0, 0, 10, 0]);
  const absoluteE = preview('M622 J1\nG1 E100\nM623\nG92 E0\nG1 X10 E1\n');
  assert.equal(absoluteE.plates[0].groups[0].positions.length, 6);
  for (const motion of ['M623', 'M622 J1\nG1 X10 E1', 'M622 J1\nG54\nM623', 'M622 J1\nG20\nM623\nG1 X10 E1', 'G92 X100\nM622 J1\nG28 X\nM623\nG90\nM83\nG1 X0 Y0 Z0.2\nG1 X10 E1']) assert.ok(preview(motion).plates[0].unavailableReason, motion);
});

test('unknown initial print position is skipped with a warning until subsequent coordinates are usable', () => {
  const result = parsePrintPreview('partial.gcode', strToU8('G1 X10 Y10 Z1 E1\nG1 X20 E2\n'));
  assert.equal(result.plates[0].groups[0].positions.length, 6);
  assert.equal(result.plates[0].groups[0].positions[0], 10);
  assert.equal(result.plates[0].groups[0].positions[3], 20);
  assert.ok(result.plates[0].warnings.some(warning => /початкові/.test(warning)));
});

test('unsupported geometry and invalid movements fail softly without guessed straight lines', () => {
  for (const motion of ['G18\nG2 X10 Z1 I5 E1', 'G5 X10 Y10 E1', 'G90.1', 'G54', 'M206 X2', 'M1020 S1', 'T0 H1', 'G1 X10 X20 E1', 'G1 X100001 E1', 'G2 X10 I1 E1', 'G2 X10 R1 E1', 'G3 X10 R10 I1 E1', 'G2 I1 P2 E1']) {
    const plate = preview(motion).plates[0];
    assert.equal(plate.groups.length, 0, motion);
    assert.ok(plate.unavailableReason, motion);
  }
  const unlocated = parsePrintPreview('part.gcode', strToU8('G1 X10 Y10 Z1 E1'));
  assert.ok(unlocated.plates[0].unavailableReason);
});

test('shared ZIP validation rejects corrupt data, mismatched CRC and ambiguous plate files', () => {
  assert.equal(parsePrintPreview('bad.3mf', strToU8('not a zip')).plates.length, 0);
  const bytes = archive({ 'Metadata/plate_1.gcode': start + 'G1 X10 E1' });
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 6, true);
  view.setUint32(14, 0, true);
  view.setUint32(central + 16, 0, true);
  assert.equal(parsePrintPreview('crc.3mf', bytes).plates.length, 0);
  assert.equal(parsePrintPreview('ambiguous.3mf', archive({ 'one.gcode': start, 'two.gcode': start })).plates.length, 0);
  assert.equal(parsePrintPreview('unsupported.bgcode', strToU8('binary')).plates.length, 0);
});

test('preview caps bytes, line length, total line count, plate count and group count', () => {
  assert.equal(parsePrintPreview('large.gcode', new Uint8Array(FILE_SIZE_LIMIT + 1)).plates.length, 0);
  assert.ok(preview(';'.repeat(4097)).plates[0].unavailableReason);
  assert.ok(parsePrintPreview('many.gcode', strToU8(';\n'.repeat(1_000_001))).plates[0].unavailableReason);
  assert.equal(parsePrintPreview('plates.3mf', archive(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`Metadata/plate_${index + 1}.gcode`, start + 'G1 X10 E1'])))).plates.length, 0);
  assert.ok(preview('M83\n' + Array.from({ length: 65 }, (_, index) => `T${index}\nG1 X${index + 1} E1`).join('\n')).plates[0].unavailableReason);
});

test('too many segments and excessively tessellated arcs never produce a misleading truncated model', () => {
  const motion = 'M83\n' + Array.from({ length: PREVIEW_SEGMENT_LIMIT + 1 }, (_, index) => `G1 X${index % 2 + 1} E1\n`).join('');
  const plate = preview(motion).plates[0];
  assert.equal(plate.groups.length, 0);
  assert.match(plate.unavailableReason!, /надто складний/);
  assert.ok(preview('G2 I1000 E1').plates[0].unavailableReason);
});
