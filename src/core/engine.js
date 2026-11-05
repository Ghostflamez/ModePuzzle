/* Geometry, validation, scoring and search. No DOM dependencies.
 * Extension points: TRAITS / TYPE_RULES (config/game-rules.js) and the rules object. */
import {
  METRICS, SCHEMA_VERSION, SCORING_VERSION, SELECTION_VERSION, DEFAULT_RULES, TRAITS, TYPE_RULES,
  RULE_EDGE_MODES, RULE_STACK_MODES, RULE_PERCENT_KEYS, RULE_PERCENT_RANGE, RETIRED_RULE_KEYS,
  LEGACY_EDGE_MODES, LEGACY_STACK_MODES, RISK_TRAITS, LIMITS, EPSILON, MATCH_MODES, DRIFT,
} from '../config/game-rules.js';
import {MODULE_KINDS, UNOFFICIAL_KIND} from '../config/catalog.js';
import {SEARCH} from '../config/search.js';

export {METRICS, SCORING_VERSION, SELECTION_VERSION, TYPE_RULES};
/** Kept under its historical name for callers and tests. */
export const TRAIT_RULES = TRAITS;
export const defaultRules = DEFAULT_RULES;

const AXES = METRICS.map((_, k) => k);
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ROTATIONS = 4;
const PERCENT = 100n;

/* ---------- geometry ---------- */

export function normalize(cells) {
  const mx = Math.min(...cells.map(c => c[0]));
  const my = Math.min(...cells.map(c => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export function orientations(cells) {
  const seen = new Map();
  for (let flip = 0; flip < 2; flip++) {
    for (let r = 0; r < ROTATIONS; r++) {
      const oriented = normalize(cells.map(([x, y]) => {
        if (flip) x = -x;
        for (let i = 0; i < r; i++) [x, y] = [-y, x];
        return [x, y];
      }));
      const key = JSON.stringify(oriented);
      if (!seen.has(key)) seen.set(key, {cells: oriented, rotation: r * 90, flipped: !!flip});
    }
  }
  return [...seen.values()];
}

export function connected(cells) {
  if (!cells.length) return false;
  const keys = new Set(cells.map(c => c.join(',')));
  if (keys.size !== cells.length) return false;
  const seen = new Set();
  const todo = [cells[0]];
  while (todo.length) {
    const [x, y] = todo.pop();
    const key = [x, y].join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dx, dy] of NEIGHBOURS) {
      const next = [x + dx, y + dy].join(',');
      if (keys.has(next) && !seen.has(next)) todo.push([x + dx, y + dy]);
    }
  }
  return seen.size === cells.length;
}

const shapeKey = cells => JSON.stringify(normalize(cells));
/** True when `cells` is one of the allowed node shapes in any orientation. */
export function isNodeShape(cells) {
  const key = shapeKey(cells);
  return TYPE_RULES.node.shapes.some(shape => orientations(shape).some(o => JSON.stringify(o.cells) === key));
}

/* ---------- validation ---------- */

const isPercent = v => Number.isFinite(v) && v >= RULE_PERCENT_RANGE.min && v <= RULE_PERCENT_RANGE.max;

function validateBoard(board) {
  const sideOk = v => Number.isInteger(v) && v >= LIMITS.boardMinSide && v <= LIMITS.boardMaxSide;
  if (!board || !sideOk(board.w) || !sideOk(board.h) || !Array.isArray(board.cells) || board.cells.length !== board.w * board.h
    || board.cells.some(v => typeof v !== 'boolean') || !board.cells.some(Boolean)) {
    throw Error(`插槽需要 ${LIMITS.boardMinSide}–${LIMITS.boardMaxSide} 行列，且至少有一个可用格`);
  }
}

function validateItem(item, ids) {
  if (!item || typeof item.id !== 'string' || ids.has(item.id) || typeof item.name !== 'string'
    || item.name.length > LIMITS.maxNameLength || !TYPE_RULES[item.type]) {
    throw Error('插入件名称、类型或 ID 无效');
  }
  ids.add(item.id);
  const side = LIMITS.shapeEditorSide;
  if (!Array.isArray(item.shape) || item.shape.length > LIMITS.maxShapeCells
    || item.shape.some(c => !Array.isArray(c) || c.length !== 2 || c.some(v => !Number.isInteger(v) || v < 0 || v >= side))
    || !connected(item.shape)) {
    throw Error(`${item.name}：形状必须是 ${side}×${side} 内共边相连的格子`);
  }
  if (item.type === 'node' && !isNodeShape(item.shape)) throw Error('节点只能是官方的 1×2（中）或 1×1（小）形状');
  if (!Array.isArray(item.base) || item.base.length !== METRICS.length
    || item.base.some(v => !Number.isFinite(v) || Math.abs(v) > LIMITS.maxAbsBaseValue)) {
    throw Error(`属性必须为 -${LIMITS.maxAbsBaseValue} 到 ${LIMITS.maxAbsBaseValue} 之间的数值`);
  }
  if (!Array.isArray(item.traits) || new Set(item.traits).size !== item.traits.length
    || item.traits.some(t => !TRAITS[t]) || (item.type === 'node' && item.traits.length)) {
    throw Error('存在无效词条');
  }
  if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > LIMITS.maxStackQuantity) {
    throw Error(`每个堆叠数量需为 1–${LIMITS.maxStackQuantity}`);
  }
  if (item.required !== undefined && typeof item.required !== 'boolean') throw Error('必须添加标记需为布尔值');
  if (item.locked !== undefined && typeof item.locked !== 'boolean') throw Error('锁定标记需为布尔值');
  if (item.locked && item.required) throw Error('同一件不能同时必选和锁定排除');
  const kindOk = item.kind === undefined || (item.kind === UNOFFICIAL_KIND ? item.type === 'module' : MODULE_KINDS[item.kind]?.type === item.type);
  if (!kindOk) {
    throw Error(`${item.name}：未知的官方模组种类`);
  }
  if (item.learnCap !== undefined && (!item.traits?.includes('learning') || !Array.isArray(item.learnCap) || item.learnCap.length !== METRICS.length
    || item.learnCap.some(v => !Number.isFinite(v) || v < 0 || v > LIMITS.maxAbsBaseValue))) {
    throw Error(`${item.name}：自学习上限无效`);
  }
  if (item.aliases !== undefined && (!Array.isArray(item.aliases)
    || item.aliases.some(n => typeof n !== 'string' || n.length > LIMITS.maxNameLength))) {
    throw Error('历史名称无效');
  }
}

function validateRules(rules) {
  if (!rules || !RULE_EDGE_MODES.includes(rules.edge) || !RULE_STACK_MODES.includes(rules.stack)
    || RULE_PERCENT_KEYS.some(k => !isPercent(rules[k]))) {
    throw Error('规则设置无效');
  }
}

export function validate(config) {
  if (!config || config.version !== SCHEMA_VERSION) throw Error(`配置版本不受支持（需要 version: ${SCHEMA_VERSION}）`);
  validateBoard(config.board);
  const {items} = config;
  if (!Array.isArray(items) || items.length > LIMITS.maxStacks) throw Error(`最多支持 ${LIMITS.maxStacks} 个堆叠条目`);
  const ids = new Set();
  let count = 0;
  for (const item of items) {
    validateItem(item, ids);
    count += item.qty;
  }
  if (count > LIMITS.maxTotalQuantity) throw Error(`候选件库存总数量不能超过 ${LIMITS.maxTotalQuantity}`);
  validateRules(config.rules);
  const targetOk = config.target === 'custom' || (Number.isInteger(config.target) && config.target >= 0 && config.target < METRICS.length);
  if (typeof config.optional !== 'boolean' || !targetOk) throw Error('目标属性或冗余设置无效');
  if (config.custom !== undefined) validateCustom(config.custom);
  if (config.nextAutoName !== undefined && (!Number.isSafeInteger(config.nextAutoName) || config.nextAutoName < 1)) {
    throw Error('自动名称编号无效');
  }
  resolveLockedPlacements(config);
  return config;
}

const has = (item, trait) => item.type === 'module' && item.traits.includes(trait);

/* ---------- placements ---------- */

export function generatePlacements(board, item) {
  const out = [];
  const available = (x, y) => x >= 0 && y >= 0 && x < board.w && y < board.h && board.cells[y * board.w + x];
  const xs = board.cells.flatMap((v, i) => (v ? [i % board.w] : []));
  const ys = board.cells.flatMap((v, i) => (v ? [Math.floor(i / board.w)] : []));
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  for (const orient of orientations(item.shape)) {
    const mw = Math.max(...orient.cells.map(c => c[0])) + 1;
    const mh = Math.max(...orient.cells.map(c => c[1])) + 1;
    for (let y = 0; y <= board.h - mh; y++) {
      for (let x = 0; x <= board.w - mw; x++) {
        const coords = orient.cells.map(([dx, dy]) => [x + dx, y + dy]);
        if (!coords.every(([cx, cy]) => available(cx, cy))) continue;
        const cells = coords.map(([cx, cy]) => cy * board.w + cx);
        let mask = 0n;
        let halo = 0n;
        for (const i of cells) mask |= 1n << BigInt(i);
        for (const [cx, cy] of coords) {
          for (const [dx, dy] of NEIGHBOURS) {
            if (available(cx + dx, cy + dy)) halo |= 1n << BigInt((cy + dy) * board.w + cx + dx);
          }
        }
        out.push({
          rotation: orient.rotation, flipped: orient.flipped, index: out.length, cells, mask,
          halo: halo & ~mask, x, y,
          left: coords.some(([cx]) => cx === minX),
          top: coords.some(([, cy]) => cy === minY),
        });
      }
    }
  }
  return out;
}

// Lock only existing inventory instances at validated legal cells/orientations.
export function resolveLockedPlacements(config) {
  const locks = config.lockedPlacements;
  if (locks === undefined) return [];
  if (!Array.isArray(locks) || locks.length > LIMITS.maxLockedPlacements) throw Error('锁定布局格式无效');
  const items = new Map(config.items.map(a => [a.id, a]));
  const cache = new Map();
  const seen = new Set();
  const out = [];
  let occupied = 0n;
  for (const lock of locks) {
    const item = items.get(lock?.itemId);
    const instances = item ? Array.from({length: item.qty}, (_, i) => `${item.id}:${i + 1}`) : [];
    if (!item || !instances.includes(lock.instance) || seen.has(lock.instance)) {
      throw Error('锁定插入件不存在、数量不足或重复，请先解除锁定');
    }
    if (!Array.isArray(lock.cells) || lock.cells.length !== item.shape.length || new Set(lock.cells).size !== lock.cells.length
      || lock.cells.some(c => !Number.isInteger(c) || c < 0 || c >= config.board.cells.length || !config.board.cells[c])) {
      throw Error('锁定格子无效，请先解除锁定');
    }
    if (!cache.has(item.id)) cache.set(item.id, generatePlacements(config.board, item));
    const mask = lock.cells.reduce((m, c) => m | (1n << BigInt(c)), 0n);
    const p = cache.get(item.id).find(q => q.mask === mask
      && (lock.rotation === undefined || q.rotation === lock.rotation)
      && (lock.flipped === undefined || q.flipped === lock.flipped));
    if (!p || (occupied & mask)) throw Error('锁定插入件的形状、朝向或重叠状态无效，请先解除锁定');
    occupied |= mask;
    seen.add(lock.instance);
    out.push({item, p, instance: lock.instance});
  }
  return out;
}

export const adjacent = (p, q) => (p.halo & q.mask) !== 0n;

/* ---------- exact arithmetic ----------
 * Exact rational arithmetic keeps 25 * 20% equal to 5, not 4.999999... .
 * BigInt division truncates toward zero for both signs. Only integer outputs
 * enter the search; fractional arithmetic is confined to exact rule evaluation. */
const Q_ZERO = [0n, 1n];
function rational(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const decimals = (mantissa.split('.')[1] || '').length;
  const power = Number(exponent) - decimals;
  const numerator = BigInt(mantissa.replace('.', ''));
  return power >= 0 ? [numerator * 10n ** BigInt(power), 1n] : [numerator, 10n ** BigInt(-power)];
}
const qAdd = (a, b) => (a[1] === b[1] ? [a[0] + b[0], a[1]] : [a[0] * b[1] + b[0] * a[1], a[1] * b[1]]);
const qMul = (a, b) => [a[0] * b[0], a[1] * b[1]];
const qRate = value => {
  const q = rational(value);
  return [q[0], q[1] * PERCENT];
};
const qTrunc = q => Number(q[0] / q[1]);
const qValue = q => Number(q[0]) / Number(q[1]);
const zeroQ = () => AXES.map(() => Q_ZERO);

/* ---------- scoring ----------
 * Mirrors the game (Assembly-CSharp: ModuleEffectHelper). Each module keeps an
 * integer temp value that starts at its base; every effect then adds an integer:
 *   side / top mount:  temp += base * 20 / 100          (one call each, truncated each)
 *   receiver:          temp += base * (10 * nodes) / 100  (one call, truncated once)
 *   negative feedback: temp += sum(adjacent negative bases) / 4
 *   support node:      temp  = sum(adjacent module bases) / 5   (overwrites; node base unused)
 * C# integer division truncates toward zero. Neighbours are read by base value only,
 * so evaluation order never matters. */

const CHANNELS = 2; // 0: absorption (support node / negative feedback), 1: receiver
const zeroChannels = () => Array.from({length: CHANNELS}, zeroQ);

/** Own value: base plus each triggered mount truncated separately (node: 0, the game overwrites it). */
export function unary(item, p, rules) {
  if (item.type === 'node') return AXES.map(() => 0);
  const mounts = (has(item, 'left') && p.left ? 1 : 0) + (has(item, 'top') && p.top ? 1 : 0);
  const mount = qRate(rules.mount);
  return item.base.map(v => {
    const base = rational(v);
    return qTrunc(base) + mounts * qTrunc(qMul(base, mount));
  });
}

function absorptionBase(item, other) {
  if (other.type !== 'module') return AXES.map(() => 0);
  if (item.type === 'node') return other.base;
  return has(item, 'negative') ? other.base.map(v => Math.min(0, v)) : AXES.map(() => 0);
}

/** Exact (unrounded) contributions of `other` to `item`, per channel and axis. */
function channelTerms(item, other, rules) {
  const rate = qRate(item.type === 'node' ? rules.nodeAbsorb : rules.negativeAbsorb);
  const absorb = absorptionBase(item, other).map(v => qMul(rational(v), rate));
  const receive = other.type === 'node' && has(item, 'receiver')
    ? item.base.map(v => qMul(rational(v), qRate(rules.receiver)))
    : zeroQ();
  return [absorb, receive];
}

const truncChannels = acc => AXES.map(k => acc.reduce((s, ch) => s + qTrunc(ch[k]), 0));

// Convenience for a layout with exactly one neighbour, NOT an additive edge
// weight for layouts with several neighbours (every channel rounds its sum once).
export function received(item, p, other, rules) {
  return truncChannels(channelTerms(item, other, rules));
}

export function pair(a, p, b, q, rules) {
  if (!adjacent(p, q)) return AXES.map(() => 0);
  const x = received(a, p, b, rules);
  const y = received(b, q, a, rules);
  return x.map((v, k) => v + y[k]);
}

export function evaluate(layout, rules) {
  const rows = layout.map((a, i) => {
    const self = unary(a.item, a.p, rules);
    const boost = AXES.map(() => 0); // Retained in exported rows for compatibility; never applied again.
    const ownBase = a.item.type === 'node' ? AXES.map(() => 0) : a.item.base.map(v => qTrunc(rational(v)));
    const edge = self.map((v, k) => v - ownBase[k]);
    let raw = zeroQ();
    let acc = zeroChannels();
    let nodes = 0;
    const links = [];
    layout.forEach((b, j) => {
      if (i === j || !adjacent(a.p, b.p)) return;
      const base = absorptionBase(a.item, b.item);
      raw = raw.map((v, k) => qAdd(v, rational(base[k])));
      const t = channelTerms(a.item, b.item, rules);
      acc = acc.map((ch, c) => ch.map((v, k) => qAdd(v, t[c][k])));
      const absorbs = b.item.type === 'module' && (a.item.type === 'node' || has(a.item, 'negative'));
      const receives = has(a.item, 'receiver') && b.item.type === 'node';
      if (receives) nodes++;
      const kind = absorbs ? 'absorption' : receives ? 'receiver' : 'none';
      links.push({id: b.instance, name: b.item.name, kind, absorptionBase: base, gain: null});
    });
    const absorptionRate = a.item.type === 'node' ? rules.nodeAbsorb : has(a.item, 'negative') ? rules.negativeAbsorb : 0;
    const absorbed = acc[0].map(qTrunc);
    const receiver = acc[1].map(qTrunc);
    const neighbour = absorbed.map((v, k) => v + receiver[k]);
    return {
      instance: a.instance, itemId: a.item.id, name: a.item.name, type: a.item.type, cells: a.p.cells,
      rotation: a.p.rotation, flipped: a.p.flipped, base: a.item.base, self, boost, edge,
      absorptionBase: raw.map(qValue), absorptionRate, absorbed,
      receiverNodes: nodes, receiverRate: rules.receiver * nodes, receiver, neighbour,
      total: self.map((v, k) => v + neighbour[k]), left: a.p.left, top: a.p.top, links,
    };
  });
  return {rows, total: AXES.map(k => rows.reduce((s, row) => s + row.total[k], 0))};
}

/* ---------- custom targets & migration ---------- */

export const defaultCustom = () => ({
  bounds: METRICS.map(() => ({min: null, max: null})),
  primary: 0,
  secondary: 1,
});

/** Bounds produced by a match mode around `center` (null centre → unbounded). */
export function boundsFromMatch(mode, center) {
  if (center === null || center === undefined) return {min: null, max: null};
  const margin = MATCH_MODES[mode].margin;
  return {min: center - margin, max: center + margin};
}
/** A row may switch to a match mode when it has one bound, two equal bounds, or none. */
export const canStartMatch = b => (b.min === null) !== (b.max === null) || b.min === b.max;
/** Centre to start from: the single bound, the shared value, or empty. */
export const matchStartValue = b => b.min ?? b.max ?? null;

/**
 * Per-use drift of one module, per axis: 退化 loses on each positive axis (not below 0),
 * 自学习 gains on each axis still under its cap (unknown cap: no gain counted).
 */
export function driftOf(item) {
  if (item.traits?.includes('degrading')) return item.base.map(v => (v > 0 ? -Math.min(v, -DRIFT.degrading) : 0));
  if (item.traits?.includes('learning') && item.learnCap) return item.base.map((v, k) => Math.max(0, Math.min(DRIFT.learning, item.learnCap[k] - v)));
  return METRICS.map(() => 0);
}
/** Decay / growth of a set of modules and the decay left after 自学习 offsets it axis by axis. */
export function hedgeSummary(items) {
  const decay = METRICS.map(() => 0);
  const grow = METRICS.map(() => 0);
  for (const item of items) driftOf(item).forEach((d, k) => { if (d < 0) decay[k] -= d; else grow[k] += d; });
  return {decay, grow, uncovered: decay.reduce((s, d, k) => s + Math.max(0, d - grow[k]), 0)};
}

export function validateCustom(custom) {
  if (!custom || !Array.isArray(custom.bounds) || custom.bounds.length !== METRICS.length) throw Error('自定义目标需要三项属性范围');
  for (const k of AXES) {
    const b = custom.bounds[k];
    const bad = key => b[key] !== null && (!Number.isFinite(b[key]) || Math.abs(b[key]) > LIMITS.maxAbsBound);
    // `tolerance` is a retired field from older saves: accepted, ignored and removed on migration.
    if (!b || (b.tolerance !== undefined && typeof b.tolerance !== 'boolean') || ['min', 'max'].some(bad)) {
      throw Error(`${METRICS[k]}范围需为空或有效数字（绝对值不超过 ${LIMITS.maxAbsBound}）`);
    }
    if (b.min !== null && b.max !== null && b.min > b.max) throw Error(`${METRICS[k]}下界不能高于上界`);
    if (b.match !== undefined) {
      if (!MATCH_MODES[b.match] || !(b.center === null || (Number.isFinite(b.center) && Math.abs(b.center) <= LIMITS.maxAbsBound))) {
        throw Error(`${METRICS[k]}的匹配设置无效`);
      }
      const derived = boundsFromMatch(b.match, b.center);
      if (derived.min !== b.min || derived.max !== b.max) throw Error(`${METRICS[k]}的上下界与匹配中间值不一致`);
    }
  }
  const axisOk = v => Number.isInteger(v) && v >= 0 && v < METRICS.length;
  if (!axisOk(custom.primary) || !(custom.secondary === null || axisOk(custom.secondary)) || custom.primary === custom.secondary) {
    throw Error('首要、次要优先属性不能相同');
  }
  return custom;
}

// Migrate scoring metadata and legacy edges; preserve inventory and other settings.
export function migrateConfig(input) {
  const out = structuredClone(input);
  if (out && out.custom === undefined) out.custom = defaultCustom();
  if (LEGACY_EDGE_MODES.includes(out?.rules?.edge)) out.rules.edge = 'global';
  // The game only adds effects; the former multiplicative option is not part of it.
  if (LEGACY_STACK_MODES.includes(out?.rules?.stack)) out.rules.stack = 'add';
  if (out) out.scoringVersion = SCORING_VERSION;
  validate(out);
  // Retire obsolete computation switches without touching any entered item values.
  for (const key of RETIRED_RULE_KEYS) delete out.rules[key];
  for (const b of out.custom?.bounds ?? []) delete b.tolerance;
  if (out.selectionVersion !== SELECTION_VERSION && out.items.some(a => a.required)) out.legacySelectionReview = true;
  // Old positional locks were based on a mistaken interpretation. Convert only
  // explicitly recorded locked copies to excluded stock; never discard inventory.
  if (out.lockedPlacements?.length) {
    const counts = new Map();
    for (const l of out.lockedPlacements) counts.set(l.itemId, (counts.get(l.itemId) || 0) + 1);
    const ids = new Set(out.items.map(a => a.id));
    const moved = [];
    for (const item of out.items) {
      const n = counts.get(item.id) || 0;
      if (!n) continue;
      if (n === item.qty) {
        item.locked = true;
        item.required = false;
        continue;
      }
      let id = `${item.id}~excluded`;
      let i = 1;
      while (ids.has(id)) id = `${item.id}~excluded-${i++}`;
      ids.add(id);
      moved.push({...structuredClone(item), id, qty: n, locked: true, required: false});
      item.qty -= n;
    }
    out.items.push(...moved);
  }
  delete out.lockedPlacements;
  out.selectionVersion = SELECTION_VERSION;
  return validate(out);
}

export function effectiveBounds(custom) {
  return custom.bounds.map(b => ({
    min: b.min === null ? -Infinity : b.min,
    max: b.max === null ? Infinity : b.max,
  }));
}

export function withinBounds(total, bounds) {
  return bounds.every((b, k) => total[k] >= b.min - EPSILON && total[k] <= b.max + EPSILON);
}

export function comparePriority(a, b, primary, secondary) {
  if (!b) return 1;
  const d = a[primary] - b[primary];
  if (Math.abs(d) > EPSILON) return Math.sign(d);
  if (secondary !== null) {
    const s = a[secondary] - b[secondary];
    if (Math.abs(s) > EPSILON) return Math.sign(s);
  }
  return 0;
}

/* ---------- search ----------
 * Absorption is NOT pairwise additive. Search tracks exact unrounded
 * absorption per placed piece and applies changes to its rounded subtotal.
 * Bounds use signed per-edge marginal envelopes valid for every partial sum,
 * including zero crossings, rather than isolated rounded pair scores. A custom upper limit
 * is never checked against an incomplete total alone. Priority is lexicographic,
 * never a weighted sum: secondary matters only when primary ties (EPSILON). */
/** Number of pieces an optimisation would consider (locked stacks are excluded). */
export const searchQuantity = config => config.items.filter(item => !item.locked).reduce((n, item) => n + item.qty, 0);

export function solve(input, {limitMs = SEARCH.defaultLimitMs, onProgress = () => {}, now = () => performance.now(), random = Math.random} = {}) {
  const config = migrateConfig(input);
  if (searchQuantity(config) > LIMITS.maxSearchQuantity) {
    throw Error(`参与本次优化的候选件不能超过 ${LIMITS.maxSearchQuantity} 件（当前 ${searchQuantity(config)} 件），请锁定排除一部分`);
  }
  const start = now();
  const rules = config.rules;
  const custom = config.target === 'custom';
  const primary = custom ? config.custom.primary : config.target;
  const secondary = custom ? config.custom.secondary : null;
  const ranges = custom ? effectiveBounds(config.custom) : METRICS.map(() => ({min: -Infinity, max: Infinity}));
  const capacity = config.board.cells.filter(Boolean).length;
  let visits = 0;
  let bestTotals = null;
  let bestLayout = null;
  // Tie-breaks after the target priorities: fewer modules with 退化 / 过载, then less 退化
  // left uncovered by 自学习 modules growing on the same axis.
  let bestRisk = Infinity;
  let bestUncovered = Infinity;
  const riskOf = layout => layout.reduce((n, a) => n + (a.risk ? 1 : 0), 0);
  const uncoveredOf = layout => AXES.reduce((s, k) => s + Math.max(0, -layout.reduce((d, a) => d + a.drift[k], 0)), 0);
  let expired = false;
  let lastReport = start;
  let rootBounds = null;
  const add = (a, b) => a.map((v, k) => v + b[k]);

  const placementsWithValues = item => generatePlacements(config.board, item).map(p => ({...p, u: unary(item, p, rules)}));
  const types = config.items.filter(item => !item.locked).map(item => ({item, placements: placementsWithValues(item)}));
  const typeIndex = new Map(types.map((t, i) => [t.item.id, i]));
  const termTable = types.map(x => types.map(y => channelTerms(x.item, y.item, rules)));
  /** Exact contributions of piece y to piece x, per channel. */
  const terms = (x, y) => termTable[typeIndex.get(x.item.id)][typeIndex.get(y.item.id)];

  const pieces = [];
  for (const type of types) {
    for (let i = 0; i < type.item.qty; i++) {
      pieces.push({...type, instance: `${type.item.id}:${i + 1}`, copy: i,
        risk: type.item.traits.some(t => RISK_TRAITS.includes(t)), drift: driftOf(type.item),
        required: !config.optional || type.item.required === true, area: type.item.shape.length});
    }
  }

  const pairCache = new Map();
  function pairLimits(a, b) {
    const key = JSON.stringify([a.item.id, b.item.id]);
    if (pairCache.has(key)) return pairCache.get(key);
    const hi = AXES.map(() => 0);
    const lo = AXES.map(() => 0);
    // For any current sum S and absorption term t, trunc(S+t)-trunc(S)
    // has t's sign and magnitude at most ceil(abs(t)), even across zero.
    const envelope = q => {
      const n = q[0] < 0n ? -q[0] : q[0];
      const ceil = Number((n + q[1] - 1n) / q[1]);
      return q[0] < 0n ? {lo: -ceil, hi: 0} : {lo: 0, hi: ceil};
    };
    for (const [x, y] of [[a, b], [b, a]]) {
      for (const channel of terms(x, y)) {
        channel.forEach((q, k) => {
          const e = envelope(q);
          hi[k] += e.hi;
          lo[k] += e.lo;
        });
      }
    }
    const value = {hi, lo};
    pairCache.set(key, value);
    return value;
  }

  for (const a of pieces) {
    a.maxUnary = AXES.map(k => (a.placements.length ? Math.max(...a.placements.map(p => p.u[k])) : -Infinity));
    a.minUnary = AXES.map(k => (a.placements.length ? Math.min(...a.placements.map(p => p.u[k])) : Infinity));
    a.rank = a.maxUnary[primary] + pieces.reduce((s, b) => s + (a === b ? 0 : pairLimits(a, b).hi[primary] / 2), 0);
  }
  pieces.sort((a, b) => Number(b.required) - Number(a.required) || b.rank / b.area - a.rank / a.area
    || a.item.id.localeCompare(b.item.id) || a.copy - b.copy);
  const requiredCount = pieces.filter(a => a.required).length;
  const complete = layout => layout.reduce((n, a) => n + Number(a.required), 0) === requiredCount;
  const n = pieces.length;
  const pm = pieces.map(a => pieces.map(b => pairLimits(a, b)));
  const uiLayout = l => l.map(a => ({item: a.item, p: a.p, instance: a.instance}));

  const result = (done = false, phase = '精确搜索') => ({
    done, phase, scoringVersion: SCORING_VERSION, custom, primary, secondary,
    feasible: bestLayout !== null,
    best: bestTotals ? bestTotals[primary] : null,
    objectiveValues: bestTotals ? [bestTotals[primary], ...(secondary === null ? [] : [bestTotals[secondary]])] : null,
    layout: bestLayout ? evaluate(uiLayout(bestLayout), rules) : null,
    riskPieces: bestLayout ? riskOf(bestLayout) : 0,
    uncoveredDecay: bestLayout ? uncoveredOf(bestLayout) : 0,
    placements: bestLayout ? bestLayout.map(a => ({instance: a.instance, itemId: a.item.id, cells: a.p.cells, rotation: a.p.rotation, flipped: a.p.flipped})) : [],
    visits, elapsedMs: now() - start, proven: done && !expired,
    upperBound: rootBounds && Number.isFinite(rootBounds.hi[primary]) ? Math.max(rootBounds.hi[primary], bestTotals?.[primary] ?? -Infinity) : null,
    constraints: custom ? ranges.map(b => ({min: Number.isFinite(b.min) ? b.min : null, max: Number.isFinite(b.max) ? b.max : null})) : null,
  });

  function save(layout, totals) {
    if (!complete(layout) || !withinBounds(totals, ranges)) return;
    const order = comparePriority(totals, bestTotals, primary, secondary);
    const risk = riskOf(layout);
    const uncovered = uncoveredOf(layout);
    if (order > 0 || (order === 0 && (risk < bestRisk || (risk === bestRisk && uncovered < bestUncovered)))) {
      bestTotals = [...totals];
      bestLayout = layout.map(a => ({...a}));
      bestRisk = risk;
      bestUncovered = uncovered;
    }
  }

  function scalarBound(remaining, selected, free, current, k, sign) {
    const limit = (i, j) => (sign === 1 ? pm[i][j].hi[k] : pm[i][j].lo[k]);
    const vals = remaining.map(i => ({
      area: pieces[i].area,
      value: sign * (sign === 1 ? pieces[i].maxUnary[k] : pieces[i].minUnary[k])
        + selected.reduce((s, j) => s + sign * limit(i, j), 0)
        + remaining.reduce((s, j) => s + (i === j ? 0 : sign * limit(i, j) / 2), 0),
    }));
    if (!config.optional) return sign * (sign * current + vals.reduce((s, a) => s + a.value, 0));
    // In mixed mode, relaxing mandatory inclusion gives a safe (looser) bound.
    // Inclusion is enforced independently by complete(), DFS and the heuristic.
    vals.sort((a, b) => b.value / b.area - a.value / a.area);
    let upper = sign * current;
    for (const a of vals) {
      if (a.value <= 0) continue;
      const used = Math.min(free, a.area);
      upper += a.value * used / a.area;
      free -= used;
      if (free <= 0) break;
    }
    return sign * upper;
  }

  const boundAxes = custom ? AXES : [primary];
  function bounds(remaining, selected, free, totals) {
    const hi = AXES.map(() => Infinity);
    const lo = AXES.map(() => -Infinity);
    for (const k of boundAxes) {
      hi[k] = scalarBound(remaining, selected, free, totals[k], k, 1);
      if (custom) lo[k] = scalarBound(remaining, selected, free, totals[k], k, -1);
    }
    return {hi, lo};
  }

  const all = pieces.map((_, i) => i).filter(i => pieces[i].placements.length);
  rootBounds = bounds(all, [], capacity, AXES.map(() => 0));
  if (config.optional) save([], AXES.map(() => 0));
  if (pieces.filter(p => p.required).reduce((s, p) => s + p.area, 0) > capacity || pieces.some(p => p.required && !p.placements.length)) {
    return result(true, '不可行');
  }

  /** Can a completion of this branch still beat the best layout? Risk only grows as pieces are added. */
  function viable(b, risk = 0) {
    if (!ranges.every((r, k) => b.hi[k] >= r.min - EPSILON && b.lo[k] <= r.max + EPSILON)) return false;
    if (!bestTotals) return true;
    const high = Math.min(b.hi[primary], ranges[primary].max);
    if (high < bestTotals[primary] - EPSILON) return false;
    if (high > bestTotals[primary] + EPSILON) return true;
    // Risk only grows as pieces are added; at equal risk, more 自学习 pieces may still hedge 退化.
    const fewerRisk = risk < bestRisk || (risk === bestRisk && bestUncovered > 0);
    if (secondary === null) return fewerRisk;
    const second = Math.min(b.hi[secondary], ranges[secondary].max);
    if (second > bestTotals[secondary] + EPSILON) return true;
    return second >= bestTotals[secondary] - EPSILON && fewerRisk;
  }
  if (!viable(rootBounds)) return result(true, '搜索完成');

  // Each placed piece carries its exact per-channel sums in `acc`; a new neighbour
  // changes a piece's score by the difference of the truncated sums.
  const addTerms = (acc, extra) => acc.map((ch, c) => ch.map((v, k) => qAdd(v, extra[c][k])));
  function delta(a, p, layout) {
    const d = [...p.u];
    let acc = zeroChannels();
    for (const b of layout) {
      if (!adjacent(p, b.p)) continue;
      acc = addTerms(acc, terms(a, b));
      const next = addTerms(b.acc, terms(b, a));
      for (const k of AXES) {
        for (let c = 0; c < CHANNELS; c++) d[k] += qTrunc(next[c][k]) - qTrunc(b.acc[c][k]);
      }
    }
    const own = truncChannels(acc);
    for (const k of AXES) d[k] += own[k];
    return {d, acc};
  }
  function append(layout, a) {
    const previous = [];
    for (const b of layout) {
      if (!adjacent(a.p, b.p)) continue;
      previous.push([b, b.acc]);
      b.acc = addTerms(b.acc, terms(b, a));
    }
    layout.push(a);
    return previous;
  }
  function restore(layout, previous) {
    layout.pop();
    for (const [b, acc] of previous) b.acc = acc;
  }
  function initializeAccumulators(layout) {
    for (const a of layout) {
      a.acc = zeroChannels();
      for (const b of layout) if (a !== b && adjacent(a.p, b.p)) a.acc = addTerms(a.acc, terms(a, b));
    }
  }

  const scales = AXES.map(k => Math.max(1, ...config.items.map(a => Math.abs(a.base[k]) * a.qty)));
  function fitness(total) {
    const penalty = ranges.reduce((s, r, k) => s + Math.max(0, r.min - total[k], total[k] - r.max) / scales[k], 0);
    return -penalty * SEARCH.violationWeight + total[primary] / scales[primary]
      + (secondary === null ? 0 : SEARCH.secondaryWeight * total[secondary] / scales[secondary]);
  }

  // Heuristic scores guide discovery only; all final comparisons use priorities.
  const heuristicEnd = start + Math.min(SEARCH.heuristicMaxMs, Math.max(SEARCH.heuristicMinMs, limitMs * SEARCH.heuristicShare));
  let iteration = 0;
  let repairLayout = null;
  let repairFitness = -Infinity;
  while (n && now() < heuristicEnd) {
    let layout = [];
    let mask = 0n;
    let totals = AXES.map(() => 0);
    const seed = bestLayout || repairLayout;
    if (seed && iteration % SEARCH.restartEvery !== 0) {
      layout = seed.filter(() => random() > SEARCH.repairDropRate).map(a => ({...a}));
      initializeAccumulators(layout);
      mask = layout.reduce((m, a) => m | a.p.mask, 0n);
      totals = evaluate(uiLayout(layout), rules).total;
    }
    const chosen = new Set(layout.map(a => a.instance));
    const rankScale = Math.max(1, Math.abs(rootBounds.hi[primary]));
    const order = pieces.filter(a => !chosen.has(a.instance))
      .map(a => ({a, key: random() + SEARCH.rankWeight * (Number.isFinite(a.rank) ? a.rank : 0) / rankScale}))
      .sort((a, b) => Number(b.a.required) - Number(a.a.required) || b.key - a.key)
      .map(x => x.a);
    let failed = false;
    for (const a of order) {
      if (now() - start >= limitMs) {
        expired = true;
        break;
      }
      let candidate = null;
      let quality = -Infinity;
      const currentFitness = fitness(totals);
      for (const p of a.placements) {
        if (mask & p.mask) continue;
        const {d, acc} = delta(a, p, layout);
        const q = fitness(add(totals, d)) + random() * SEARCH.placementJitter;
        if (q > quality) {
          quality = q;
          candidate = {...a, p, d, acc};
        }
      }
      if (!candidate) {
        if (a.required) {
          failed = true;
          break;
        }
        continue;
      }
      if (!a.required && fitness(add(totals, candidate.d)) < currentFitness && random() < SEARCH.skipWorseRate) continue;
      append(layout, candidate);
      mask |= candidate.p.mask;
      totals = add(totals, candidate.d);
    }
    if (!failed && complete(layout)) {
      save(layout, totals);
      const f = fitness(totals);
      if (f > repairFitness) {
        repairFitness = f;
        repairLayout = layout.map(a => ({...a}));
      }
    }
    iteration++;
    visits++;
    if (now() - lastReport > SEARCH.progressIntervalMs) {
      onProgress(result(false, '快速寻找可行解'));
      lastReport = now();
    }
  }
  onProgress(result(false));

  const SKIPPED = -2; // lastByType marker: remaining copies of this type are skipped
  const selected = [];
  const selectedIndices = [];
  const lastByType = new Map();
  let ticks = 0;
  function dfs(index, mask, used, totals) {
    visits++;
    if ((ticks++ & SEARCH.clockCheckMask) === 0) {
      const time = now();
      if (time - start >= limitMs) {
        expired = true;
        return;
      }
      if (time - lastReport > SEARCH.progressIntervalMs) {
        onProgress(result(false));
        lastReport = time;
      }
    }
    if (expired) return;
    if (config.optional) save(selected, totals);
    if (index === n) {
      save(selected, totals);
      return;
    }
    const remaining = [];
    for (let j = index; j < n; j++) {
      if (lastByType.get(pieces[j].item.id) !== SKIPPED && pieces[j].placements.length) remaining.push(j);
    }
    if (remaining.reduce((s, i) => s + (pieces[i].required ? pieces[i].area : 0), 0) > capacity - used) return;
    if (!viable(bounds(remaining, selectedIndices, capacity - used, totals), riskOf(selected))) return;
    const a = pieces[index];
    const prev = lastByType.get(a.item.id);
    if (prev !== SKIPPED && used + a.area <= capacity) {
      const candidates = [];
      for (const p of a.placements) {
        if (!(mask & p.mask) && (prev === undefined || p.index > prev)) {
          const {d, acc} = delta(a, p, selected);
          candidates.push({p, d, acc, f: fitness(add(totals, d))});
        }
      }
      candidates.sort((x, y) => y.f - x.f);
      for (const {p, d, acc} of candidates) {
        const previous = append(selected, {...a, p, acc});
        selectedIndices.push(index);
        lastByType.set(a.item.id, p.index);
        dfs(index + 1, mask | p.mask, used + a.area, add(totals, d));
        restore(selected, previous);
        selectedIndices.pop();
        if (expired) break;
      }
    }
    if (prev === undefined) lastByType.delete(a.item.id);
    else lastByType.set(a.item.id, prev);
    if (!a.required && !expired) {
      lastByType.set(a.item.id, SKIPPED);
      dfs(index + 1, mask, used, totals);
      if (prev === undefined) lastByType.delete(a.item.id);
      else lastByType.set(a.item.id, prev);
    }
  }
  if (!expired) dfs(0, 0n, 0, AXES.map(() => 0));
  return result(true, expired ? '已到时间上限' : '搜索完成');
}
