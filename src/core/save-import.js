/* Read a Probably Stolen save (Easy Save 3, `save_N.es3`) into machines and modules.
 * Pure functions; never writes anything. Geometry mirrors the game's GridShape.ForwardTransform. */
import {MODULE_KINDS} from '../config/catalog.js';
import {
  BAY_LAYOUTS, UPGRADE_STAGE_TAG, STANDARD_MACHINE_TAG, MACHINE_BAYS, UNKNOWN_STANDARD_MACHINE, EXCLUDED_MACHINES, EXCLUDED_MODULE_IDS,
  SAVE_EFFECTS, SAVE_EFFECT_TAGS, SAVE_BASE_TAGS, SAVE_LEARN_CAP_TAGS, SAVE_INVENTORIES, MODULE_TYPES,
} from '../config/machines.js';
import {normalize} from './engine.js';
import {machineParams} from './machine-stats.js';
import {tl, getLang} from '../i18n/index.js';

const VALID_ESCAPES = '"\\/bfnrtu';

/**
 * ES3 writes JSON with two quirks: unquoted integer dictionary keys ({8376:{...}})
 * and backslashes before characters JSON does not allow (\“). Fix both outside/inside
 * strings respectively, then parse.
 */
export function parseLenientJson(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') {
        const next = text[i + 1];
        out += VALID_ESCAPES.includes(next) ? ch + next : next;
        i++;
      } else {
        if (ch === '"') inString = false;
        out += ch;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    out += ch;
    if (ch === '{' || ch === ',') {
      const m = /^\s*(-?\d+)\s*:/.exec(text.slice(i + 1, i + 40));
      if (m) {
        out += `"${m[1]}":`;
        i += m[0].length;
      }
    }
  }
  return JSON.parse(out);
}

const field = (shape, name) => shape[`<${name}>k__BackingField`];

/** Local cells of an item shape (row-major data, '1' occupied), unrotated. */
export function localCells(shape) {
  const w = field(shape, 'width');
  return shape.data.flatMap((v, i) => (v ? [[i % w, Math.floor(i / w)]] : []));
}

/** Absolute grid cells of a placed shape: GridShape.ForwardTransform (flip, then orientation, then offset). */
export function placedCells(shape) {
  const w = field(shape, 'width');
  const h = field(shape, 'height');
  const flipped = field(shape, 'flipped');
  const o = ((field(shape, 'orientation') % 4) + 4) % 4;
  const minX = field(shape, 'minX');
  const minY = field(shape, 'minY');
  return localCells(shape).map(([x0, y0]) => {
    let x = flipped ? w - 1 - x0 : x0;
    let y = y0;
    if (o === 1) [x, y] = [y, w - 1 - x];
    else if (o === 2) [x, y] = [w - 1 - x, h - 1 - y];
    else if (o === 3) [x, y] = [h - 1 - y, x];
    return [x + minX, y + minY];
  });
}

/** Board for a bay layout and upgrade stage (stage clamps to the known range). */
export function bayBoard(layoutId, stage = 0) {
  const layout = BAY_LAYOUTS[layoutId];
  const pattern = layout.stages[Math.max(0, Math.min(layout.stages.length - 1, stage | 0))];
  return {w: layout.w, h: pattern.length / layout.w, cells: [...pattern].map(c => c === '0')};
}

const tagsOf = item => {
  const map = new Map();
  (item._keys || []).forEach((k, i) => map.set(k, item._values?.[i] || {}));
  return map;
};
const isModule = item => (item._keys || []).includes('MODULE_TAG') || (item.itemTypes || []).includes('NODE');
const isMachine = item => (item.itemTypes || []).includes('MACHINE');

const KIND_BY_GAME_ID = new Map(Object.entries(MODULE_KINDS).map(([id, k]) => [k.gameId, id]));

/** Convert one saved module item into this tool's item fields (no id / qty yet). */
export function moduleFromSave(item) {
  const tags = tagsOf(item);
  const node = (item.itemTypes || []).includes('NODE');
  const traits = node ? [] : SAVE_EFFECT_TAGS
    .map(t => SAVE_EFFECTS[tags.get(t)?.internalValueString])
    .filter(Boolean);
  const kind = KIND_BY_GAME_ID.get(item.identifier);
  return {
    name: '',
    type: node ? 'node' : 'module',
    ...(kind ? {kind} : {}),
    shape: normalize(localCells(item.itemShape)),
    base: node ? [0, 0, 0] : SAVE_BASE_TAGS.map(t => tags.get(t)?.valueInt ?? 0),
    traits: [...new Set(traits)],
    // 自学习算法 grows each use until these caps (read from the save, never guessed).
    ...(traits.includes('learning') ? {learnCap: SAVE_LEARN_CAP_TAGS.map(t => tags.get(t)?.valueInt ?? 0)} : {}),
    moduleType: tags.get('MODULE_TYPE')?.internalValueString || MODULE_TYPES.universal,
    sources: [item.uniqueId],
  };
}

/**
 * Parse a save file's text.
 * Returns {machines: [{key, identifier, name, board, accepts, stage, installed: [{module, cells}]}],
 *          free: [module], skipped: {reason: count}}
 */
export function readSave(text) {
  const root = parseLenientJson(text);
  const store = root?.playerStore?.value;
  if (!store) throw Error(tl('不是《深空当铺》的存档文件（找不到 playerStore）'));
  const items = [];
  for (const key of SAVE_INVENTORIES) {
    if (typeof store[key] !== 'string') continue;
    const inv = parseLenientJson(store[key]);
    items.push(...(inv.saveItems || []).map(it => ({...it, _inventory: key})));
  }
  const byUuid = new Map(items.map(it => [`${it._inventory}:${it.uuid}`, it]));
  const parent = new Map();
  for (const it of items) {
    for (const child of it.childItems || []) parent.set(`${it._inventory}:${child}`, it);
  }
  const skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };

  const machines = new Map();
  for (const it of items) {
    if (!isMachine(it) || EXCLUDED_MACHINES.includes(it.identifier)) continue;
    const tags = tagsOf(it);
    const known = MACHINE_BAYS[it.identifier];
    if (!known && !tags.has(STANDARD_MACHINE_TAG)) continue;
    const bay = known || UNKNOWN_STANDARD_MACHINE;
    // Unlisted machines: accept every module type already installed in them, plus universal ones.
    const installedTypes = (it.childItems || []).map(c => byUuid.get(`${it._inventory}:${c}`)).filter(c => c && isModule(c))
      .map(c => tagsOf(c).get('MODULE_TYPE')?.internalValueString).filter(Boolean);
    const stage = tags.get(UPGRADE_STAGE_TAG)?.valueInt ?? 0;
    const custom = tags.get('CUSTOM_NAME_TAG')?.internalValueString;
    machines.set(it, {
      key: `m${it.uniqueId}`, identifier: it.identifier, name: custom || (getLang() === 'zh' ? it.name : known?.name) || it.name || it.identifier,
      layoutId: bay.layout, originalStage: stage, board: bayBoard(bay.layout, stage), accepts: [...new Set([...bay.accepts, ...(known ? [] : installedTypes)])], stage, guessed: !known,
      outputs: [...bay.outputs], power: bay.power || 'basic', params: machineParams(tags), installed: [],
    });
  }

  const free = [];
  for (const it of items) {
    if (!isModule(it)) continue;
    if (EXCLUDED_MODULE_IDS.includes(it.identifier)) { skip(tl('化学设备模组')); continue; }
    const holder = parent.get(`${it._inventory}:${it.uuid}`);
    const module = moduleFromSave(it);
    if (holder && isMachine(holder)) {
      const machine = machines.get(holder);
      if (!machine) { skip(EXCLUDED_MACHINES.includes(holder.identifier) ? tl('装在化学类机器中') : tl('装在不支持的机器中')); continue; }
      machine.installed.push({module, cells: placedCells(it.itemModifiedShape)});
    } else {
      free.push(module);
    }
  }
  // Disambiguate identical machine names.
  const list = [...machines.values()];
  const counts = new Map();
  for (const m of list) counts.set(m.name, (counts.get(m.name) || 0) + 1);
  const seen = new Map();
  for (const m of list) {
    if (counts.get(m.name) > 1) {
      seen.set(m.name, (seen.get(m.name) || 0) + 1);
      m.name = `${m.name} #${seen.get(m.name)}`;
    }
  }
  return {machines: list, free, skipped};
}
