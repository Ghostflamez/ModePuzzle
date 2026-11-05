/* Machine view: imported save data, the bay of one machine and its module layout.
 * Pure state transforms on the app config; the game save itself is never modified.
 *
 * config.save = {
 *   file, importedAt, active: machineKey | null,
 *   machines: [{key, identifier, name, layoutId, stage, originalStage, board, accepts, shared, layout: [{source, cells}]}],
 *   snapshot: null | {machine, layout, takenAt}   // copy taken when an optimisation starts
 * }
 * Imported items carry `sources` (one save uniqueId per copy), `location`
 * ('free' or a machine key) and `moduleType`. Hand-made items have neither and count as free. */
import {stackInventory} from './inventory.js';
import {generatePlacements, validate, searchQuantity} from './engine.js';
import {RISK_TRAITS} from '../config/game-rules.js';
import {BAY_LAYOUTS} from '../config/machines.js';
import {bayBoard} from './save-import.js';
import {MODULE_KINDS} from '../config/catalog.js';
import {MODULE_TYPES, MODULE_TYPE_BY_CATALOG_MACHINE} from '../config/machines.js';
import {tl} from '../i18n/index.js';

export const FREE = 'free';
export const locationOf = item => item.location ?? FREE;
export const isImported = item => Array.isArray(item.sources);

/** Module type of an item: from the save, else from its official kind, else universal. */
export function moduleTypeOf(item) {
  if (item.moduleType) return item.moduleType;
  const kind = MODULE_KINDS[item.kind];
  return kind ? MODULE_TYPE_BY_CATALOG_MACHINE[kind.machine] ?? MODULE_TYPES.universal : MODULE_TYPES.universal;
}

export const activeMachine = config => config.save?.machines.find(m => m.key === config.save.active) ?? null;
/** A machine is 'shared' (globally unlocked) when other machines may take its modules during optimisation. */
export const isShared = (config, key) => !!config.save?.machines.find(m => m.key === key)?.shared;
export function setMachineShared(config, key, shared) {
  return {...config, save: {...config.save, machines: config.save.machines.map(m => (m.key === key ? {...m, shared} : m))}};
}
export const boardOf = config => activeMachine(config)?.board ?? config.board;

/** Replace the whole inventory (hand-made items included) and the machines with a freshly read save. */
export function importSave(config, parsed, {file, importedAt, newId}) {
  const fresh = [];
  const toItem = (module, location) => ({...module, id: newId(), qty: 1, location});
  for (const module of parsed.free) fresh.push(toItem(module, FREE));
  const machines = parsed.machines.map(m => {
    for (const {module} of m.installed) fresh.push(toItem(module, m.key));
    return {
      key: m.key, identifier: m.identifier, name: m.name, layoutId: m.layoutId, originalStage: m.originalStage ?? m.stage, board: m.board, accepts: m.accepts, stage: m.stage, guessed: m.guessed, params: m.params, outputs: m.outputs, power: m.power,
      layout: m.installed.map(({module, cells}) => ({source: module.sources[0], cells})),
    };
  });
  const previous = config.save?.active;
  const next = {
    ...structuredClone(config),
    items: fresh,
    save: {file, importedAt, machines, active: machines.some(m => m.key === previous) ? previous : null, snapshot: null},
  };
  return stackInventory(next);
}

/** The item copy (and its instance id) that holds a given save uniqueId. */
export function findSource(config, source) {
  for (const item of config.items) {
    const index = item.sources?.indexOf(source) ?? -1;
    if (index >= 0) return {item, instance: `${item.id}:${index + 1}`};
  }
  return null;
}

/** Layout of the active machine as engine placements {item, p, instance}; entries that no longer resolve are skipped. */
export function machineLayout(config, machine = activeMachine(config)) {
  if (!machine) return [];
  const out = [];
  for (const entry of machine.layout) {
    const found = findSource(config, entry.source);
    if (!found) continue;
    const mask = entry.cells.map(([x, y]) => y * machine.board.w + x).sort((a, b) => a - b).join(',');
    const p = generatePlacements(machine.board, found.item).find(q => [...q.cells].sort((a, b) => a - b).join(',') === mask);
    if (p) out.push({item: found.item, p, instance: found.instance});
  }
  return out;
}

/** Which items the active machine can use, and why the others cannot. */
export function machineCandidates(config) {
  const machine = activeMachine(config);
  const own = [];
  const free = [];
  const wrongType = [];
  const elsewhere = [];
  const manual = [];
  const borrowed = [];
  const accepted = item => !machine || item.type === 'node' || machine.accepts.includes(moduleTypeOf(item));
  for (const item of config.items) {
    const where = locationOf(item);
    // Hand-made items have no save id, so a machine layout could not be written back for them.
    if (machine && !isImported(item)) manual.push(item);
    else if (machine && where === machine.key) own.push(item);
    else if (where !== FREE && !(machine && isShared(config, where))) elsewhere.push(item);
    else if (!accepted(item)) wrongType.push(item);
    else if (where !== FREE) borrowed.push(item);
    else free.push(item);
  }
  return {machine, own, free, borrowed, wrongType, elsewhere, manual};
}

/**
 * Engine config for optimising the active machine: its bay as the board, free modules
 * (keeping the user's own locked / required flags), and the machine's own modules,
 * which take part only while the machine is unlocked (machine.shared). Other machines' modules and modules
 * of a type the machine does not accept are left out.
 */
export function optimisationConfig(config) {
  const {machine, own, free, borrowed} = machineCandidates(config);
  if (!machine) return config;
  // A locked machine keeps all its modules out; an unlocked one lets each module's own lock / required flags apply.
  const ownItems = own.map(item => (machine.shared ? item : {...item, locked: true, required: false}));
  const borrowedItems = borrowed.map(item => ({...item, required: false}));
  return validate({...structuredClone(config), board: machine.board, items: structuredClone([...free, ...borrowedItems, ...ownItems])});
}

/**
 * Keep an optimisation within `limit` pieces: when there are more, exclude every
 * 过载 / 退化 module first (they are already the least preferred). Returns the config
 * to run, how many risky pieces were excluded, and the remaining count.
 */
export function applySearchLimit(runConfig, limit) {
  const before = searchQuantity(runConfig);
  if (before <= limit) return {config: runConfig, excludedRisk: 0, count: before};
  let excludedRisk = 0;
  const items = runConfig.items.map(item => {
    // 必选 modules must be used, so they are never excluded automatically.
    if (item.locked || item.required || !item.traits.some(t => RISK_TRAITS.includes(t))) return item;
    excludedRisk += item.qty;
    return {...item, locked: true, required: false};
  });
  const config = {...runConfig, items};
  return {config, excludedRisk, count: searchQuantity(config)};
}

/** Layout family of a machine (older stored configs lack layoutId: a 7-wide bay is the standard one). */
export const layoutIdOf = machine => machine.layoutId ?? (machine.board.w === BAY_LAYOUTS.standard.w ? 'standard' : 'evaporator');

/**
 * Manual bay upgrade for an unlocked machine: one stage up (+1) or back down (−1), never below
 * the stage in the save. Going down is refused when the current layout would no longer fit.
 * Returns the new config, or throws with the reason.
 */
export function changeBayStage(config, key, step) {
  const machine = config.save.machines.find(m => m.key === key);
  if (!machine) throw Error(tl('找不到该机器'));
  if (!machine.shared) throw Error(tl('请先解锁这台机器，再调整模组舱'));
  const stages = BAY_LAYOUTS[layoutIdOf(machine)].stages.length;
  const floor = machine.originalStage ?? machine.stage;
  const stage = machine.stage + step;
  if (stage < floor || stage >= stages) throw Error(step > 0 ? tl('模组舱已是最高扩建等级') : tl('已是存档中的扩建等级'));
  const board = bayBoard(layoutIdOf(machine), stage);
  const fits = machine.layout.every(e => e.cells.every(([x, y]) => x < board.w && y < board.h && board.cells[y * board.w + x]));
  if (!fits) throw Error(tl('当前排布占用了将被移除的格子，无法撤回升级'));
  const machines = config.save.machines.map(m => (m.key === key ? {...m, stage, board} : m));
  return {...config, save: {...config.save, machines}};
}

/** Copy of the active machine's layout, kept until the change is confirmed or restored. */
export function takeSnapshot(config, now) {
  const machine = activeMachine(config);
  if (!machine) return config;
  return {...config, save: {...config.save, snapshot: {machine: machine.key, layout: structuredClone(machine.layout), takenAt: now}}};
}

export const clearSnapshot = config => (config.save ? {...config, save: {...config.save, snapshot: null}} : config);

/**
 * Apply an optimisation result to the active machine: the result becomes the machine's
 * layout, used copies move into the machine, own copies not used go back to the free pool.
 * Stacks are split by location and restacked. The snapshot is discarded.
 */
export function confirmResult(config, placements) {
  const machine = activeMachine(config);
  if (!machine) throw Error(tl('没有选中的机器'));
  const byId = new Map(config.items.map(item => [item.id, item]));
  const layout = [];
  const used = new Set();
  for (const p of placements) {
    const item = byId.get(p.itemId);
    const copy = Number(p.instance.slice(p.instance.lastIndexOf(':') + 1));
    const source = item?.sources?.[copy - 1];
    if (source === undefined) throw Error(tl('只能确认来自存档的模组；手动添加的模组请在游戏中自行摆放'));
    used.add(source);
    layout.push({source, cells: p.cells.map(c => [c % machine.board.w, Math.floor(c / machine.board.w)])});
  }
  const items = [];
  for (const item of config.items) {
    if (!isImported(item)) {
      items.push(item);
      continue;
    }
    const groups = new Map();
    for (const source of item.sources) {
      const where = used.has(source) ? machine.key : locationOf(item) === machine.key ? FREE : locationOf(item);
      if (!groups.has(where)) groups.set(where, []);
      groups.get(where).push(source);
    }
    let first = true;
    for (const [where, sources] of groups) {
      items.push({...structuredClone(item), id: first ? item.id : `${item.id}~${where}`, qty: sources.length, sources, location: where,
        ...(where === machine.key ? {locked: false, required: false} : {})});
      first = false;
    }
  }
  // Modules taken from globally unlocked machines leave those machines' layouts.
  const machines = config.save.machines.map(m => (m.key === machine.key ? {...m, layout} : {...m, layout: m.layout.filter(e => !used.has(e.source))}));
  return stackInventory({...config, items, save: {...config.save, machines, snapshot: null}});
}
