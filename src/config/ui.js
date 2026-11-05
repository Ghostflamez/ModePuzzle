import {tl, getLang} from '../i18n/index.js';
/* Interface constants: defaults, timings, presets and pixel icons. */

/** Default bay: 7 × 5 with the four corners unavailable (31 cells). */
export const DEFAULT_BOARD = Object.freeze({w: 7, h: 5, blocked: [0, 6, 28, 34]});

export const SEARCH_BUDGETS = Object.freeze([
  {seconds: 5, label: tl('5 秒 · 快速试排')},
  {seconds: 15, label: tl('15 秒 · 标准搜索'), default: true},
  {seconds: 60, label: tl('60 秒 · 深入搜索')},
  {seconds: 0, label: tl('不限时 · 证明最优')},
]);

export const TOAST_MS = 3800;
export const OBJECT_URL_REVOKE_MS = 1000;
export const NUMBER_FORMAT = Object.freeze({locale: getLang() === 'en' ? 'en-US' : 'zh-CN', maximumFractionDigits: 3, zeroBelow: 1e-10});

/** Board rendering: official sprites use 16 px per cell; drawn at an integer multiple. */
export const BOARD_RENDER = Object.freeze({
  /** Brightness boost applied to the selected piece. */
  selectedBrightness: 1.18,
  /** Size of the trait badge strip relative to one cell. */
  traitBadgeScale: 0.42,
  /** Mount-edge glow thickness relative to one cell. */
  mountGlowScale: 0.12,
  /** Placeholder stripe period in sprite pixels. */
  placeholderStripe: 4,
});

/**
 * New-item picker: choose a colour first, then an official sprite (= kind + shape).
 * Every colour/shape pair maps to exactly one official kind.
 */
export const PICKER_TABS = Object.freeze([
  {id: 'red', label: tl('红'), hint: tl('性能 · 超频'), kinds: ['performance', 'overclock']},
  {id: 'green', label: tl('绿'), hint: tl('效率 · 环保 · 优化'), kinds: ['efficiency', 'eco', 'streamlining']},
  {id: 'yellow', label: tl('黄'), hint: tl('质量 · 精炼'), kinds: ['quality', 'fineness']},
  {id: 'purple', label: tl('紫'), hint: tl('神经核心'), kinds: ['neuralCapped', 'neuralUncapped']},
  {id: 'grey', label: tl('灰白'), hint: tl('空白 · 损坏 · 报废'), kinds: ['blank', 'corrupt', 'ruined']},
  {id: 'hydroponic', label: tl('水培'), hint: tl('水培系统专用'), kinds: ['nutrifruit', 'dreamCapNeutralizer', 'nightmareCap', 'kottonLoom', 'hydroreedFilter', 'fillerweed', 'smuggler']},
  {id: 'machine', label: tl('其他机器'), hint: tl('打印机 · DNA编辑器 · 蒸发器 · 熔炉 · 警报器'), kinds: ['metalPrinting', 'cnc', 'meleeBatch', 'dnaStabilizer', 'dnaPositiveFilter', 'dnaNegativeFilter', 'dnaPrecision', 'solventRecovery', 'furnaceJunk', 'furnaceBlast', 'alarmTransmitter']},
  {id: 'node', label: tl('节点'), hint: tl('辅助节点'), kinds: ['nodeMedium', 'nodeSmall']},
  {id: 'unofficial', label: tl('自绘'), hint: tl('非官方形状，以占位样式显示'), kinds: []},
]);

/** Readable shape names, matched in any rotation or mirror. */
export const SHAPE_NAMES = Object.freeze([
  {name: tl('3格折角'), cells: [[0, 0], [1, 0], [1, 1]]},
  {name: tl('方形'), cells: [[0, 0], [1, 0], [0, 1], [1, 1]]},
  {name: tl('4格L'), cells: [[0, 0], [1, 0], [2, 0], [2, 1]]},
  {name: tl('T形'), cells: [[1, 0], [0, 1], [1, 1], [1, 2]]},
  {name: tl('P形'), cells: [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]]},
  {name: tl('C形'), cells: [[0, 0], [1, 0], [1, 1], [0, 2], [1, 2]]},
  {name: tl('1×4长条'), cells: [[0, 0], [0, 1], [0, 2], [0, 3]]},
  {name: '1×2', cells: [[0, 0], [0, 1]]},
  {name: '1×1', cells: [[0, 0]]},
]);
/** Basic modules come as a smaller square art; label it so it is not confused with the advanced square. */
export const SMALL_SQUARE_GROUP = 'basic';

/** Thumbnail sizes in CSS pixels (largest side). */
export const THUMBNAILS = Object.freeze({card: 64, tab: 32, tile: 64, preview: 96, traitIconScale: 2, badgeIconScale: 2, dialogIconScale: 4, lockIconScale: 2, brand: 32});
/** Official module whose art is used as the header logo. */
export const BRAND_KIND = 'neuralUncapped';

export const FILES = Object.freeze({
  config: 'module-layout-config.json',
  result: 'module-layout-result.json',
  originalBackup: 'module-layout-original-backup.json',
});

/** Example inventory for 加载演示数据 (official kinds with template values). */
export const DEMO_ITEMS = Object.freeze([
  {id: 'demo-a', name: tl('效率模组'), kind: 'efficiency', type: 'module', shape: [[0, 0], [1, 0], [2, 0], [2, 1]], base: [16, 0, 0], traits: ['left', 'receiver'], qty: 2},
  {id: 'demo-b', name: tl('精炼模组'), kind: 'fineness', type: 'module', shape: [[0, 0], [1, 0], [0, 1], [1, 1], [1, 2]], base: [-15, 25, -8], traits: ['top', 'negative'], qty: 1},
  {id: 'demo-c', name: tl('超频模组'), kind: 'overclock', type: 'module', shape: [[0, 0], [1, 0], [1, 1], [0, 2], [1, 2]], base: [-44, 0, 36], traits: ['receiver'], qty: 1},
  {id: 'demo-node', name: tl('节点（中）'), kind: 'nodeMedium', type: 'node', shape: [[0, 0], [1, 0]], base: [0, 0, 0], traits: [], qty: 4},
]);

/**
 * 9 × 9 pixel icons drawn by code. '#' = ink, '+' = accent, '.' = transparent.
 * Colours come from CSS variables so icons follow the theme.
 */
export const PIXEL_ICONS = Object.freeze({
  sideMount: [
    '##.......',
    '##.......',
    '##...+...',
    '##..++...',
    '##.+++++.',
    '##..++...',
    '##...+...',
    '##.......',
    '##.......',
  ],
  topMount: [
    '#########',
    '#########',
    '.........',
    '....+....',
    '...+++...',
    '..+++++..',
    '....+....',
    '....+....',
    '....+....',
  ],
  negativeFeedback: [
    '.........',
    '..#...#..',
    '.###.###.',
    '..#...#..',
    '.........',
    '.+++++++.',
    '.+++++++.',
    '.........',
    '.........',
  ],
  receiver: [
    '....+....',
    '..+...+..',
    '.+..+..+.',
    '...+++...',
    '....#....',
    '....#....',
    '...###...',
    '..#####..',
    '.........',
  ],
  supportNode: [
    '....#....',
    '...###...',
    '..##+##..',
    '.##+++##.',
    '###+++###',
    '.##+++##.',
    '..##+##..',
    '...###...',
    '....#....',
  ],
  premium: [
    '....+....',
    '....+....',
    '...+++...',
    '+++++++++',
    '.+++++++.',
    '..+++++..',
    '..++.++..',
    '.++...++.',
    '.+.....+.',
  ],
  inferior: [
    '....#....',
    '....#....',
    '....#....',
    '....#....',
    '.#..#..#.',
    '..#.#.#..',
    '...###...',
    '....#....',
    '.........',
  ],
  overvolted: [
    '.....++..',
    '....++...',
    '...++....',
    '..+++++..',
    '....++...',
    '...++....',
    '..++.....',
    '.++......',
    '.+.......',
  ],
  degrading: [
    '#........',
    '#++......',
    '#..+.....',
    '#...++...',
    '#.....+..',
    '#......+.',
    '#.......+',
    '#........',
    '#########',
  ],
  learning: [
    '..#####..',
    '.#.....#.',
    '#..+.+..#',
    '#.+++++.#',
    '#..+.+..#',
    '.#.....#.',
    '..#####..',
    '...#.#...',
    '...###...',
  ],
  unlocked: [
    '..#####..',
    '.#.....#.',
    '.#.......',
    '#########',
    '#+++++++#',
    '#+++#+++#',
    '#+++#+++#',
    '#+++++++#',
    '#########',
  ],
  warning: [
    '....#....',
    '...#+#...',
    '...#+#...',
    '..#+++#..',
    '..#+#+#..',
    '.#++#++#.',
    '.#+++++#.',
    '#+++#+++#',
    '#########',
  ],
  contraband: [
    '...###...',
    '..#+++#..',
    '.#+#+#+#.',
    '#++#+#++#',
    '#+++#+++#',
    '#++#+#++#',
    '.#+#+#+#.',
    '..#+++#..',
    '...###...',
  ],
  locked: [
    '..#####..',
    '.#.....#.',
    '.#.....#.',
    '#########',
    '#+++++++#',
    '#+++#+++#',
    '#+++#+++#',
    '#+++++++#',
    '#########',
  ],
});
