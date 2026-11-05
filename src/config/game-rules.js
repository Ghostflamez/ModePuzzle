import {tl} from '../i18n/index.js';
/* Game rules and data limits. Every number the scoring engine depends on lives here.
 * Trait names are the in-game terms; descriptions are this project's own wording (no game text is copied). */

/** Attribute axes. Index order is part of the saved-data format: [效率, 质量, 性能]. */
export const METRICS = [tl('效率'), tl('质量'), tl('性能')];
export const METRIC_KEYS = ['efficiency', 'quality', 'performance'];

export const SCHEMA_VERSION = 1;
export const SCORING_VERSION = 'game-integer-v5';
export const SELECTION_VERSION = 'required-included-locked-excluded-v1';

/** Default percentages used by the scorer. Users can change them in the rules dialog. */
export const DEFAULT_RULES = Object.freeze({
  edge: 'global',
  stack: 'add',
  mount: 20,
  negativeAbsorb: 25,
  receiver: 10,
  nodeAbsorb: 20,
});
export const RULE_EDGE_MODES = ['global'];
/** The game only adds effect bonuses; `multiply` from older saves migrates to `add`. */
export const RULE_STACK_MODES = ['add'];
export const LEGACY_STACK_MODES = ['multiply'];
export const RULE_PERCENT_KEYS = ['mount', 'negativeAbsorb', 'receiver', 'nodeAbsorb'];
export const RULE_PERCENT_RANGE = Object.freeze({min: 0, max: 100});
/** Legacy rule switches removed on migration (values entered by users are never touched). */
export const RETIRED_RULE_KEYS = ['negativeBoost', 'tempBase'];
/** Legacy edge mode migrated to `global`. */
export const LEGACY_EDGE_MODES = ['contour'];

/** Display-only: the generation-time boost of 负反馈. Inputs already include it, so it is never applied. */
export const OFFICIAL_NEGATIVE_FEEDBACK_BOOST = 25;
/** Game numbers shown in the trait descriptions ({key} placeholders). */
export const OFFICIAL_TEXT_PARAMS = Object.freeze({
  negativeBoost: OFFICIAL_NEGATIVE_FEEDBACK_BOOST, premium: 20, inferior: 19, overvoltBoost: 200, overvoltBreak: 10, degrade: 1, learn: 1,
});
/** A module carries at most this many effects (the game has MODULE_EFFECT1 / MODULE_EFFECT2 slots). */
export const MAX_MODULE_EFFECTS = 2;

/**
 * Module traits (词条). Names are the in-game terms; `description` is this project's own
 * summary of the effect (not the game's text); {key} placeholders are filled from the active
 * rules (see fillRuleText). `note` explains this tool's reading.
 */
export const TRAITS = Object.freeze({
  left: {
    scoring: true,
    name: tl('侧边挂载'),
    description: tl('贴着模组舱左边缘安装时，该模组属性临时 +{mount}%。'),
    note: tl('只认全舱最左列的大边，四角缺口的小边、凹边与孔洞不触发。与顶部挂载各自单独向零取整后相加。'),
    icon: 'sideMount',
  },
  negative: {
    scoring: true,
    incompatible: ['learning'],
    name: tl('负反馈'),
    description: tl('正向基础属性额外 +{negativeBoost}%；代价是相邻模组的负向基础属性会按 {negativeAbsorb}% 叠加到它身上。'),
    note: tl('录入值已含生成时的正向增幅，不再重复计算；只汇总相邻模组的负面初始值后吸收。'),
    icon: 'negativeFeedback',
  },
  top: {
    scoring: true,
    name: tl('顶部挂载'),
    description: tl('贴着模组舱顶边安装时，该模组属性临时 +{mount}%。'),
    note: tl('只认全舱最顶行的大边，四角缺口的小边、凹边与孔洞不触发。与侧边挂载各自单独向零取整后相加。'),
    icon: 'topMount',
  },
  receiver: {
    scoring: true,
    name: tl('接收器'),
    description: tl('每与一个节点相邻，该模组属性临时 +{receiver}%。'),
    note: tl('按相邻节点件数计（不按接触格数）：比例 = 每节点比例 × 节点数，乘基础值后只向零取整一次。'),
    icon: 'receiver',
  },
  /* Effects below only change the module's own base value over time; the entered
   * base already reflects them, so they never enter scoring. */
  premium: {
    scoring: false,
    incompatible: ['inferior', 'learning'],
    name: tl('优质'),
    description: tl('基础属性高出 {premium}%，售价也贵得多。'),
    note: tl('生成时基础值 ×1.2，已体现在录入的基础属性中，不影响计分。'),
    icon: 'premium',
  },
  inferior: {
    scoring: false,
    incompatible: ['premium', 'learning'],
    name: tl('劣质'),
    description: tl('基础属性低 {inferior}%，售价也便宜得多。'),
    note: tl('生成时基础值 ×0.8，已体现在录入的基础属性中，不影响计分。'),
    icon: 'inferior',
  },
  overvolted: {
    scoring: false,
    risk: true,
    incompatible: ['learning'],
    name: tl('过载'),
    description: tl('基础属性 +{overvoltBoost}%，但每次运行有 {overvoltBreak}% 概率彻底损坏。'),
    note: tl('每次使用有 10% 几率损坏并变为报废模组。优化时同分优先不用。'),
    warning: tl('每次使用有 10% 几率损坏为报废模组'),
    icon: 'overvolted',
  },
  degrading: {
    scoring: false,
    risk: true,
    incompatible: ['learning'],
    name: tl('退化'),
    description: tl('出厂基础属性翻倍，之后每运行一次，各项正向属性减 {degrade}。'),
    note: tl('每次使用后，每项为正的基础属性 −1（最低为 0）。优化时同分优先不用；必须用时优先搭配同属性未满上限的自学习模组对冲。'),
    warning: tl('每次使用后正向属性各 −1，请定期核对数值'),
    icon: 'degrading',
  },
  learning: {
    scoring: false,
    evolving: true,
    incompatible: ['degrading', 'overvolted', 'premium', 'inferior', 'negative'],
    name: tl('自学习算法'),
    description: tl('出厂时正向属性归零，之后每运行一次增长 {learn} 点，直到上限。'),
    note: tl('正向属性从 0 开始随使用增长，上限为生成时数值的 2 倍；为负的属性每次使用也 +1，直至 0。数值会随使用变化，重新导入存档即可得到最新值。优化时同分优先用它对冲同属性的退化。'),
    icon: 'learning',
  },
});
/** Traits that make the optimizer prefer other modules when scores tie. */
export const RISK_TRAITS = Object.freeze(Object.keys(TRAITS).filter(id => TRAITS[id].risk));
/** Per-use drift of the evolving traits: 退化 loses, 自学习 gains this much on each affected axis. */
export const DRIFT = Object.freeze({degrading: -OFFICIAL_TEXT_PARAMS.degrade, learning: OFFICIAL_TEXT_PARAMS.learn});

/** The node's built-in effect (official name 辅助节点). */
export const NODE_EFFECT = Object.freeze({
  name: tl('辅助节点'),
  description: tl('汇总相邻模组基础属性的 {nodeAbsorb}%，作为自己的临时属性。'),
  note: tl('同项初始值先求和，再乘比例并向零取整；节点之间不吸收。节点自身的基础值不计入（游戏中直接以吸收值覆盖）。'),
  icon: 'supportNode',
});

/** Insert types. Node shapes are the two official node sizes (节点（中）1×2, 节点（小）1×1). */
export const TYPE_RULES = Object.freeze({
  module: {name: tl('模组'), editableShape: true},
  node: {name: tl('辅助节点'), editableShape: false, shape: [[0, 0], [1, 0]], shapes: [[[0, 0], [1, 0]], [[0, 0]]]},
});

/** Validation limits for saved and imported data. */
export const LIMITS = Object.freeze({
  boardMinSide: 1,
  boardMaxSide: 10,
  shapeEditorSide: 5,
  maxShapeCells: 25,
  /** Stored inventory (a whole imported save fits easily). */
  maxStacks: 1000,
  maxTotalQuantity: 2000,
  maxStackQuantity: 100,
  /** Pieces that may take part in one optimisation (locked / unavailable pieces do not count). */
  maxSearchQuantity: 100,
  maxNameLength: 80,
  maxAbsBaseValue: 1e6,
  maxAbsBound: 1e9,
  maxLockedPlacements: 100,
  maxImportBytes: 1024 * 1024,
});

/** Custom-target match modes: a centre value drives both bounds (exact: ±0, fuzzy: ±margin). */
export const MATCH_MODES = Object.freeze({exact: {name: tl('精确'), margin: 0}, fuzzy: {name: tl('模糊'), margin: 5}});
/** Comparison tolerance for priority ordering and range checks. */
export const EPSILON = 1e-9;

/**
 * Problems with a module's effect list compared with what the game can generate:
 * more than MAX_MODULE_EFFECTS effects, or two mutually exclusive effects.
 */
export function traitConflicts(traits) {
  const problems = [];
  if (traits.length > MAX_MODULE_EFFECTS) problems.push(tl('游戏中每个模组最多 {0} 个词条', MAX_MODULE_EFFECTS));
  for (const a of traits) {
    for (const b of traits) {
      if (a < b && (TRAITS[a]?.incompatible?.includes(b) || TRAITS[b]?.incompatible?.includes(a))) {
        problems.push(tl('「{0}」与「{1}」在游戏中不会同时出现', TRAITS[a].name, TRAITS[b].name));
      }
    }
  }
  return problems;
}

/** Fill {placeholders} in trait text with the active rule values. */
export function fillRuleText(text, rules = DEFAULT_RULES) {
  const values = {...OFFICIAL_TEXT_PARAMS, ...rules};
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}
