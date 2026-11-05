import {steady} from './clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLenientJson, placedCells, localCells, bayBoard, readSave, moduleFromSave} from '../src/core/save-import.js';
import {importSave, optimisationConfig, machineLayout, confirmResult, takeSnapshot, machineCandidates, FREE, setMachineShared, changeBayStage} from '../src/core/machine-view.js';
import {evaluate, solve, defaultRules, defaultCustom} from '../src/core/engine.js';

const shape = (w, h, data, {x = 0, y = 0, o = 0, f = false} = {}) => ({
  '<minX>k__BackingField': x, '<minY>k__BackingField': y, '<flipped>k__BackingField': f, '<orientation>k__BackingField': o,
  '<width>k__BackingField': w, '<height>k__BackingField': h, data, outside: 0,
});
const tag = (k, valueInt = 0, internalValueString = '') => [k, {valueInt, internalValueString}];
function saveItem(uuid, uniqueId, identifier, {types = [], tags = [], children = [], nodes = [], s = shape(1, 1, [1]), m = s, name = identifier} = {}) {
  return {identifier, uuid, uniqueId, name, itemTypes: types, childItems: children, childItemInventoryNode: nodes,
    itemShape: s, itemModifiedShape: m, _keys: tags.map(t => t[0]), _values: tags.map(t => t[1])};
}
const moduleTags = (e, q, p, effects = []) => [tag('MODULE_TAG'), tag('MODULE_TYPE', 0, 'MODULE_TYPE_UNIVERSAL'),
  tag('BONUS_PERCENTAGE_EFFICIENCY_INT', e), tag('BONUS_PERCENTAGE_QUALITY_INT', q), tag('BONUS_PERCENTAGE_PERFORMANCE_INT', p),
  ...effects.map((x, i) => tag(`MODULE_EFFECT${i + 1}_TAG`, 0, x))];

function fakeSave() {
  const L = shape(3, 2, [1, 1, 1, 0, 0, 1]);
  const items = [
    saveItem(0, 1, 'save_bag', {children: [1, 2, 6], nodes: [1, 1, 1]}),
    saveItem(1, 100, 'furnace', {types: ['MACHINE'], tags: [tag('STANDARD_MACHINE_TAG')], children: [3, 4], nodes: [3, 3], name: '熔炉'}),
    saveItem(2, 200, 'blender', {types: ['MACHINE'], children: [5], nodes: [2], name: '搅拌机'}),
    // 4-cell L rotated 180° and placed at (2,3), as in a real save.
    saveItem(3, 11, 'system_module_efficiancy', {tags: moduleTags(30, 0, 0, ['MODULE_EFFECT_LEARNING_ALGORITHM']), s: L, m: shape(3, 2, [1, 1, 1, 0, 0, 1], {x: 2, y: 3, o: 2})}),
    saveItem(4, 12, 'node_medium', {types: ['NODE'], tags: [tag('MODULE_TYPE', 0, 'MODULE_TYPE_UNIVERSAL')], s: shape(1, 2, [1, 1]), m: shape(1, 2, [1, 1], {x: 5, y: 3, o: 1})}),
    saveItem(5, 13, 'chem_module', {tags: [tag('MODULE_TAG')]}),
    saveItem(6, 14, 'system_module_performance', {tags: moduleTags(0, 0, 16, ['MODULE_EFFECT_TOP_MOUNT']), s: shape(2, 2, [1, 1, 1, 1])}),
  ];
  const inv = JSON.stringify({saveItems: items});
  // ES3 quirks: unquoted integer keys and an invalid escape inside a string.
  return `{"playerStore":{"__type":"PlayerStore","value":{"phone":{8376:{"a":1}},"note":"一小瓶\\“梦尘\\”","mainInvJSON":${JSON.stringify(inv)}}}}`;
}

test('lenient ES3 parsing fixes integer keys and invalid escapes only where they occur', () => {
  const v = parseLenientJson('{"a":{12:{"t":"10:30, 5:x"}},"s":"\\“q\\” \\"ok\\"","n":[1,-2]}');
  assert.deepEqual(v, {a: {'12': {t: '10:30, 5:x'}}, s: '“q” "ok"', n: [1, -2]});
});

test('placed cells follow GridShape.ForwardTransform (flip, then orientation, then offset)', () => {
  const L = [1, 1, 1, 0, 0, 1];
  assert.deepEqual(localCells(shape(3, 2, L)), [[0, 0], [1, 0], [2, 0], [2, 1]]);
  assert.deepEqual(placedCells(shape(3, 2, L, {x: 2, y: 3, o: 2})), [[4, 4], [3, 4], [2, 4], [2, 3]]);
  assert.deepEqual(placedCells(shape(3, 2, L, {o: 1})), [[0, 2], [0, 1], [0, 0], [1, 0]]);
  assert.deepEqual(placedCells(shape(3, 2, L, {o: 3})), [[1, 0], [1, 1], [1, 2], [0, 2]]);
  assert.deepEqual(placedCells(shape(3, 2, L, {f: true})), [[2, 0], [1, 0], [0, 0], [0, 1]]);
});

test('bay shapes follow the upgrade stage', () => {
  assert.equal(bayBoard('standard', 0).cells.filter(Boolean).length, 26);
  assert.equal(bayBoard('standard', 1).cells.filter(Boolean).length, 31);
  assert.equal(bayBoard('standard', 2).cells.filter(Boolean).length, 35);
  assert.equal(bayBoard('standard', 9).cells.filter(Boolean).length, 35);
  assert.deepEqual([bayBoard('evaporator').w, bayBoard('evaporator').h], [4, 4]);
});

test('reading a save: machines in scope, installed layout, free modules, chem modules skipped', () => {
  const r = readSave(fakeSave());
  assert.deepEqual(r.machines.map(m => m.identifier), ['furnace']);
  const furnace = r.machines[0];
  assert.equal(furnace.installed.length, 2);
  assert.deepEqual(furnace.installed[0].cells, [[4, 4], [3, 4], [2, 4], [2, 3]]);
  assert.deepEqual(furnace.installed[0].module.traits, ['learning']);
  assert.equal(furnace.installed[0].module.kind, 'efficiency');
  assert.deepEqual(furnace.installed[1].module.base, [0, 0, 0]);
  assert.equal(furnace.installed[1].module.kind, 'nodeMedium');
  assert.equal(r.free.length, 1);
  assert.deepEqual(r.free[0].base, [0, 0, 16]);
  assert.deepEqual(r.free[0].traits, ['top']);
  assert.equal(r.skipped['化学设备模组'], 1);
  assert.throws(() => readSave('{"x":1}'));
});

function imported() {
  let n = 0;
  const base = {version: 1, board: {w: 2, h: 1, cells: [true, true]}, items: [{id: 'manual', name: 'm', type: 'module', base: [1, 0, 0], traits: [], shape: [[0, 0]], qty: 1}],
    rules: {...defaultRules}, optional: true, target: 0, custom: defaultCustom()};
  return importSave(base, readSave(fakeSave()), {file: 'save_7.es3', importedAt: 1, newId: () => `id${n++}`});
}

test('importing overwrites the whole inventory, stores locations and the current layout', () => {
  const c = imported();
  assert.ok(!c.items.some(i => i.id === 'manual'));
  assert.ok(c.items.every(i => i.sources));
  assert.equal(c.items.filter(i => i.sources).reduce((s, i) => s + i.qty, 0), 3);
  const active = {...c, save: {...c.save, active: c.save.machines[0].key}};
  const layout = machineLayout(active);
  assert.equal(layout.length, 2);
  assert.ok(evaluate(layout, active.rules).total[0] >= 30);
  const {own, free, manual} = machineCandidates(active);
  assert.equal(own.length, 2);
  assert.equal(free.length, 1);
  assert.equal(manual.length, 0);
  // Re-import replaces imported items instead of duplicating them.
  const again = importSave(active, readSave(fakeSave()), {file: 'x', importedAt: 2, newId: () => Math.random().toString(36)});
  assert.equal(again.items.filter(i => i.sources).reduce((s, i) => s + i.qty, 0), 3);
  assert.equal(again.save.active, active.save.active);
});

test('own modules stay excluded while the machine is locked; confirming moves modules and drops the snapshot', () => {
  const c0 = imported();
  const c = takeSnapshot({...c0, save: {...c0.save, active: c0.save.machines[0].key}}, 5);
  assert.equal(c.save.snapshot.layout.length, 2);
  const locked = optimisationConfig(c);
  assert.deepEqual(locked.board.w, 7);
  assert.ok(locked.items.filter(i => i.location === c.save.active).every(i => i.locked));
  const open = setMachineShared(c, c.save.active, true);
  const unlocked = optimisationConfig(open);
  const r = solve(unlocked, {...steady(), random: () => 0.5});
  assert.ok(r.feasible);
  const fromSave = r.placements.filter(p => unlocked.items.find(i => i.id === p.itemId)?.sources);
  const next = confirmResult(open, fromSave);
  assert.equal(next.save.snapshot, null);
  const machine = next.save.machines[0];
  assert.equal(machine.layout.length, fromSave.length);
  const inMachine = next.items.filter(i => i.location === machine.key).reduce((s, i) => s + i.qty, 0);
  assert.equal(inMachine, fromSave.length);
  assert.equal(next.items.filter(i => i.sources).reduce((s, i) => s + i.qty, 0), 3);
  const freeQty = next.items.filter(i => i.location === FREE).reduce((n, i) => n + i.qty, 0);
  assert.equal(inMachine + freeQty, 3);
  assert.throws(() => confirmResult(c, [{itemId: 'manual', instance: 'manual:1', cells: [0]}]));
  assert.ok(!optimisationConfig(c).items.some(i => i.id === 'manual'));
});

test('save module conversion keeps base values exactly as stored', () => {
  const m = moduleFromSave(saveItem(9, 99, 'system_module_overclock', {tags: moduleTags(-55, 0, 45, ['MODULE_EFFECT_SIDE_MOUNT', 'MODULE_EFFECT_DEGRADING']), s: shape(2, 2, [1, 1, 1, 1])}));
  assert.deepEqual(m.base, [-55, 0, 45]);
  assert.deepEqual(m.traits, ['left', 'degrading']);
  assert.equal(m.kind, 'overclock');
  assert.deepEqual(m.sources, [99]);
});

test('globally unlocked machines lend their modules; confirming removes them from the lender', async () => {
  const {setMachineShared, isShared} = await import('../src/core/machine-view.js');
  const c0 = imported();
  // Add a second machine that holds one free module, then share it.
  const lenderKey = 'mLender';
  const freeItem = c0.items.find(i => i.location === FREE);
  const lender = {...c0.save.machines[0], key: lenderKey, name: '借出机器', layout: [{source: freeItem.sources[0], cells: [[1, 0]]}]};
  let c = {...c0, items: c0.items.map(i => (i === freeItem ? {...i, location: lenderKey} : i)),
    save: {...c0.save, machines: [...c0.save.machines, lender], active: c0.save.machines[0].key}};
  assert.equal(machineCandidates(c).borrowed.length, 0);
  c = setMachineShared(c, lenderKey, true);
  assert.ok(isShared(c, lenderKey));
  assert.equal(machineCandidates(c).borrowed.length, 1);
  const run = optimisationConfig(setMachineShared(c, c.save.active, true));
  assert.ok(run.items.some(i => i.location === lenderKey));
  const placement = {itemId: freeItem.id, instance: `${freeItem.id}:1`, cells: [0]};
  const next = confirmResult(setMachineShared(c, c.save.active, true), [placement]);
  assert.equal(next.save.machines.find(m => m.key === lenderKey).layout.length, 0);
  assert.ok(next.items.some(i => i.sources?.includes(freeItem.sources[0]) && i.location === c.save.active));
});

test('over the search limit, 过载 / 退化 modules are excluded first', async () => {
  const {applySearchLimit} = await import('../src/core/machine-view.js');
  const mk = (id, qty, traits) => ({id, name: id, type: 'module', base: [1, 0, 0], traits, shape: [[0, 0]], qty});
  const run = {items: [mk('a', 60, []), mk('b', 30, ['overvolted']), mk('c', 20, ['degrading', 'left'])]};
  const r = applySearchLimit(run, 100);
  assert.equal(r.excludedRisk, 50);
  assert.equal(r.count, 60);
  assert.ok(r.config.items.find(i => i.id === 'b').locked);
  assert.equal(applySearchLimit({items: [mk('a', 80, []), mk('b', 10, ['overvolted'])]}, 100).excludedRisk, 0);
  assert.equal(applySearchLimit({items: [mk('a', 120, []), mk('b', 10, ['overvolted'])]}, 100).count, 120);
  const must = applySearchLimit({items: [mk('a', 95, []), {...mk('b', 10, ['overvolted']), required: true}]}, 100);
  assert.equal(must.excludedRisk, 0);
  assert.equal(must.count, 105);
});

test('own modules can be locked one by one while the machine is unlocked', async () => {
  const {transferOne} = await import('../src/core/inventory.js');
  const c0 = imported();
  const key = c0.save.machines[0].key;
  let c = setMachineShared({...c0, save: {...c0.save, active: key}}, key, true);
  const own = c.items.find(i => i.location === key && i.type === 'module');
  c = transferOne(c, own.id, true, 'lockedCopy');
  const locked = c.items.find(i => i.location === key && i.locked);
  assert.ok(locked, 'the locked copy keeps its machine location');
  assert.deepEqual(locked.sources, own.sources);
  const run = optimisationConfig(c);
  assert.ok(run.items.find(i => i.id === locked.id).locked);
  assert.ok(run.items.filter(i => i.location === key && !i.locked).every(i => i.type === 'node'));
  // Machine-wide switch off: everything own is excluded regardless of flags.
  const off = optimisationConfig(setMachineShared(c, key, false));
  assert.ok(off.items.filter(i => i.location === key).every(i => i.locked));
});

test('an unlocked standard machine can be upgraded one stage at a time and back to the save stage', () => {
  const c0 = imported();
  const key = c0.save.machines[0].key;
  assert.throws(() => changeBayStage(c0, key, 1), /解锁/);
  let c = setMachineShared(c0, key, true);
  const start = c.save.machines[0];
  assert.equal(start.originalStage, 0);
  c = changeBayStage(c, key, 1);
  assert.equal(c.save.machines[0].stage, 1);
  assert.equal(c.save.machines[0].board.cells.filter(Boolean).length, 31);
  c = changeBayStage(c, key, 1);
  assert.equal(c.save.machines[0].board.cells.filter(Boolean).length, 35);
  assert.throws(() => changeBayStage(c, key, 1), /最高/);
  c = changeBayStage(changeBayStage(c, key, -1), key, -1);
  assert.equal(c.save.machines[0].stage, 0);
  assert.throws(() => changeBayStage(c, key, -1), /存档/);
  // A layout that uses a cell of the bigger bay blocks the downgrade.
  const up = changeBayStage(c, key, 1);
  const blocked = {...up, save: {...up.save, machines: up.save.machines.map(m => ({...m, layout: [{source: 1, cells: [[3, 1]]}]}))}};
  assert.throws(() => changeBayStage(blocked, key, -1), /无法撤回/);
});
