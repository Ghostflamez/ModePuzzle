import test from 'node:test';
import assert from 'node:assert/strict';
import {machineStats, MACHINE_OUTPUTS, adjustedQuality} from '../src/core/machine-stats.js';
import {MACHINE_BAYS, UNKNOWN_STANDARD_MACHINE, EXCLUDED_MACHINES} from '../src/config/machines.js';
import {readSave} from '../src/core/save-import.js';

const params = (o = {}) => ({speedBase: null, powerBase: null, performanceRatio: null, efficiencyRatio: null, qualityRatio: null, performanceReducesPower: false, ...o});

test('speed and power match values the game stored in a real save (save_7)', () => {
  // [效率, 质量, 性能] totals and machine constants copied from save_7.es3.
  const dna = params({speedBase: 10, powerBase: 12, performanceRatio: 2, qualityRatio: 2});
  assert.deepEqual(machineStats(dna, [-300, 0, 213]), {speed: 20, power: 48});
  assert.deepEqual(machineStats(params({speedBase: 33, powerBase: 10}), [0, 0, 96]), {speed: 64, power: 10});
  assert.deepEqual(machineStats(params({speedBase: 8, powerBase: 8, performanceRatio: 2, qualityRatio: 2}), [-22, 38, 7]), {speed: 8, power: 9});
  assert.deepEqual(machineStats(params({powerBase: 4, qualityRatio: 2}), [-185, 100, 62]), {speed: null, power: 11});
  assert.deepEqual(machineStats(params({powerBase: 8}), [78, 6, 0]), {speed: null, power: 2});
  assert.equal(machineStats(params({powerBase: 8}), [500, 0, 0]).power, 1);
});

test('deal maker draws power from efficiency plus performance', () => {
  assert.equal(machineStats(params({powerBase: 10}), [20, 0, 30], {power: 'dealMaker'}).power, 5);
  assert.equal(machineStats(params({powerBase: 10}), [20, 0, 30]).power, 8);
});

test('machine outputs follow the game formulas', () => {
  const p = params({qualityRatio: 2, performanceRatio: 2});
  assert.equal(adjustedQuality(p, 38), 19);
  assert.equal(adjustedQuality(params(), 38), 0);
  assert.equal(MACHINE_OUTPUTS.harvest.value(p, [0, 38, 0]), '+19%');
  assert.equal(MACHINE_OUTPUTS.dealChance.value(p, [0, -40, 0]), '+0%');
  assert.equal(MACHINE_OUTPUTS.dealChance.value(p, [0, 10, 0]), '+15%');
  assert.equal(MACHINE_OUTPUTS.attractiveness.value(p, [0, 30, 50]), '140%');
  assert.equal(MACHINE_OUTPUTS.agingDays.value(p, [0, 250, 0]), '3 天');
  assert.equal(MACHINE_OUTPUTS.agingDays.value(p, [0, -50, 0]), '1 天');
  assert.equal(MACHINE_OUTPUTS.moistureGrade.value(p, [0, -60, 0]), '沟渠水');
  assert.equal(MACHINE_OUTPUTS.moistureGrade.value(p, [0, -10, 0]), '铁锈水');
  assert.equal(MACHINE_OUTPUTS.moistureGrade.value(p, [0, 0, 0]), '幽灵水');
  assert.equal(MACHINE_OUTPUTS.moistureGrade.value(p, [0, 150, 0]), '纯水');
  assert.equal(MACHINE_OUTPUTS.moistureVolume.value(p, [0, 0, -150]), '0%');
  assert.equal(MACHINE_OUTPUTS.evaporatorQuality.value(p, [0, 140, 0]), '100');
  for (const [id, m] of Object.entries(MACHINE_BAYS)) {
    for (const o of m.outputs) assert.ok(MACHINE_OUTPUTS[o], `${id}: ${o}`);
    assert.ok(!EXCLUDED_MACHINES.includes(id));
  }
  assert.equal(Object.keys(MACHINE_BAYS).length, 12);
});

test('an unlisted machine with the standard bay is supported with the types it already holds', () => {
  const shape = (w, h, data, o = {}) => ({'<minX>k__BackingField': o.x ?? 0, '<minY>k__BackingField': o.y ?? 0, '<flipped>k__BackingField': false,
    '<orientation>k__BackingField': 0, '<width>k__BackingField': w, '<height>k__BackingField': h, data, outside: 0});
  const t = (k, valueInt = 0, internalValueString = '') => [k, {valueInt, internalValueString}];
  const item = (uuid, uniqueId, identifier, types, tags, children = [], m = shape(1, 1, [1])) => ({identifier, uuid, uniqueId, name: identifier,
    itemTypes: types, childItems: children, childItemInventoryNode: children.map(() => 3), itemShape: shape(1, 1, [1]), itemModifiedShape: m,
    _keys: tags.map(x => x[0]), _values: tags.map(x => x[1])});
  const items = [
    item(0, 1, 'save_bag', [], [], [1]),
    item(1, 50, 'modded_kiln', ['MACHINE'], [t('STANDARD_MACHINE_TAG'), t('MODULE_UPGRADE_STAGE_INT', 2), t('MACHINERY_DRAWN_POWER_BASE', 6)], [2]),
    item(2, 51, 'system_module_efficiancy', [], [t('MODULE_TAG'), t('MODULE_TYPE', 0, 'MODULE_TYPE_KILN'), t('BONUS_PERCENTAGE_EFFICIENCY_INT', 16)], [], shape(1, 1, [1], {x: 3, y: 2})),
  ];
  const text = JSON.stringify({playerStore: {value: {mainInvJSON: JSON.stringify({saveItems: items})}}});
  const [m] = readSave(text).machines;
  assert.equal(m.identifier, 'modded_kiln');
  assert.equal(m.guessed, true);
  assert.equal(m.board.cells.filter(Boolean).length, 35);
  assert.deepEqual(m.accepts.sort(), ['MODULE_TYPE_KILN', ...UNKNOWN_STANDARD_MACHINE.accepts].sort());
  assert.deepEqual(m.installed[0].cells, [[3, 2]]);
  assert.equal(m.params.powerBase, 6);
});
