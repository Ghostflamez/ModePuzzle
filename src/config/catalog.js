/* Module catalogue of the game's kinds: names are the in-game names, numbers and shapes
 * follow the game's rules. `description` / `effect` are this project's own summaries, not the
 * game's text. Art is this project's own pixel drawing (src/render/module-art.js); kinds and
 * shapes the game does not have are drawn with the placeholder style.
 *
 * base: template attributes in this tool's axis order [效率, 质量, 性能]
 *       (the game stores them as [性能, 效率, 质量]).
 * aliases: short names users commonly type; used by name matching (src/core/naming.js).
 * sprites: ids of the shapes the kind can appear with (see SHAPES in render/module-art.js);
 *       together they are the set of legal shapes for the kind.
 */

export const MACHINES = Object.freeze({
  system: {name: '通用', note: '可装入大多数机器的模组舱'},
  hydroponic: {name: '水培系统', note: '仅水培系统可安装（水培系统也接受通用模组）'},
  printer: {name: '3D打印机', note: '仅3D打印机可安装'},
  dna: {name: 'DNA编辑器', note: '仅DNA编辑器可安装'},
  evaporator: {name: '蒸发器', note: '仅蒸发器可安装'},
  furnace: {name: '熔炉', note: '仅熔炉可安装'},
  alarm: {name: '警报器', note: '仅警报器可安装'},
});

/** Groups shown in the type picker, in display order. */
export const KIND_GROUPS = Object.freeze([
  {id: 'basic', name: '基础模组', note: '随机为小方形 / 4格L / T / 3格折角'},
  {id: 'advanced', name: '进阶模组', note: '随机为方形 / C型 / P型'},
  {id: 'special', name: '特殊模组'},
  {id: 'hydroponic', name: '水培模组'},
  {id: 'machine', name: '其他机器专用模组'},
  {id: 'node', name: '节点'},
]);

export const MODULE_KINDS = Object.freeze({
  performance: {name: '性能模组', aliases: ['性能'], gameId: 'system_module_performance', group: 'basic', machine: 'system', type: 'module',
    base: [0, 0, 16], tone: 'red', sprites: ['module_red', 'module_red_l', 'module_red_t', 'module_red_c']},
  efficiency: {name: '效率模组', aliases: ['效率'], gameId: 'system_module_efficiancy', group: 'basic', machine: 'system', type: 'module',
    base: [16, 0, 0], tone: 'green', sprites: ['module_green', 'module_green_l', 'module_green_t', 'module_green_c']},
  quality: {name: '质量模组', aliases: ['质量'], gameId: 'system_module_quality', group: 'basic', machine: 'system', type: 'module',
    base: [0, 8, 0], tone: 'yellow', sprites: ['module_yellow', 'module_yellow_l', 'module_yellow_t', 'module_yellow_c']},

  overclock: {name: '超频模组', aliases: ['超频'], gameId: 'system_module_overclock', group: 'advanced', machine: 'system', type: 'module',
    base: [-44, 0, 36], tone: 'red', sprites: ['module_red_2', 'module_red_2_s', 'module_red_2_h']},
  eco: {name: '环保模组', aliases: ['环保'], gameId: 'system_module_eco', group: 'advanced', machine: 'system', type: 'module',
    base: [32, 0, -16], tone: 'green', sprites: ['module_green_2', 'module_green_2_s', 'module_green_2_h']},
  fineness: {name: '精炼模组', aliases: ['精炼'], gameId: 'system_module_fineness', group: 'advanced', machine: 'system', type: 'module',
    base: [-15, 25, -8], tone: 'yellow', sprites: ['module_yellow_2', 'module_yellow_2_s', 'module_yellow_2_h']},

  streamlining: {name: '优化模组', aliases: ['优化'], gameId: 'system_module_streamlining', group: 'special', machine: 'system', type: 'module',
    base: [25, -16, 8], tone: 'green', sprites: ['module_green_3']},
  neuralCapped: {name: '神经核心模组（受限）', aliases: ['神经核心', '受限神经核心', '神经核心（受限）', 'AI', 'AI模组', 'AI核心'], gameId: 'system_capped_neural_core', group: 'special', machine: 'system', type: 'module',
    base: [-100, 50, 100], tone: 'purple', contraband: true, sprites: ['module_black_4'],
    description: '装有安全限制的 AI 核心，属于违禁品；限制让它更稳定，也压低了性能。'},
  neuralUncapped: {name: '神经核心模组（无限制）', aliases: ['神经核心', '无限制神经核心', '神经核心（无限制）', 'AI', 'AI模组', 'AI核心'], gameId: 'system_uncapped_neural_core', group: 'special', machine: 'system', type: 'module',
    base: [-100, 100, 200], tone: 'purple', contraband: true, sprites: ['module_black_5'],
    description: '去掉限制的 AI 核心，属于违禁品；性能极高，但随时可能失控。'},
  blank: {name: '空白模组', aliases: ['空白'], gameId: 'blank_module', group: 'special', machine: 'system', type: 'module',
    base: [0, 0, 0], tone: 'white', sprites: ['module_white'],
    description: '没有属性的空模组，可在相应机器上改写成其他模组。'},
  corrupt: {name: '损坏模组', aliases: ['损坏', '故障模组'], gameId: 'system_module_corrupt', group: 'special', machine: 'system', type: 'module',
    base: [-5, 0, -8], tone: 'dark', sprites: ['module_corrupt'],
    description: '已损坏，用电子元件可以修好。'},
  ruined: {name: '报废模组', aliases: ['报废'], gameId: 'system_module_ruined', group: 'special', machine: 'system', type: 'module',
    base: [0, 0, 0], tone: 'dark', sprites: ['module_ruined'],
    description: '彻底报废，只能拆解回收。'},

  nutrifruit: {name: '营养果水培模组', aliases: ['营养果'], gameId: 'farm_module_nutrifruit', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [-10, 0, -10], tone: 'green', sprites: ['farm_module_l2'], effect: '营养果产量+1',
    description: '种营养果时增产，对其他作物无效。'},
  dreamCapNeutralizer: {name: '梦帽菇中和水培模组', aliases: ['梦帽菇中和', '食用帽菇'], gameId: 'farm_module_dream_cap', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [15, 0, 15], tone: 'green', sprites: ['farm_module_l4'], effect: '移除梦帽菇的违禁品状态；将类型设为食物；梦帽菇产量+2',
    description: '把梦帽菇变成可食用、非违禁的帽菇并增产；效果可叠加，只作用于梦帽菇。'},
  nightmareCap: {name: '梦帽菇梦魇化水培模组', aliases: ['梦帽菇梦魇化', '梦魇帽菇', '梦魇化'], gameId: 'farm_module_nightmare_cap', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [-50, 0, -33], tone: 'green', contraband: true, sprites: ['farm_module5'], effect: '种出的梦帽菇将变为梦魇帽菇',
    description: '把梦帽菇变成有毒的梦魇帽菇，只作用于梦帽菇。'},
  kottonLoom: {name: '韧棉自动织造水培模组', aliases: ['韧棉织造', '韧棉自动织造', '韧棉'], gameId: 'farm_module_kotton_loom', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [-100, 0, -50], tone: 'green', sprites: ['farm_module_l1'], effect: '产出韧棉织物，而非韧棉纤维',
    description: '种韧棉时直接产出织物，只作用于韧棉。'},
  hydroreedFilter: {name: '水培芦苇滤芯模组', aliases: ['水培芦苇滤芯', '芦苇滤芯', '芦苇'], gameId: 'farm_module_hydroreed_filter', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [-15, 0, 0], tone: 'green', sprites: ['farm_module_l6'], effect: '水培芦苇滤芯产量+1',
    description: '让成熟的水培芦苇可以收获为滤芯，只作用于水培芦苇。'},
  fillerweed: {name: '填料草增产水培模组', aliases: ['填料草增产', '填料草'], gameId: 'farm_module_fillerweed_production', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [-25, 0, 0], tone: 'green', sprites: ['farm_module_l5'], effect: '填料草不再产出种子；填料草产量+4',
    description: '填料草增产但不再结种；不可叠加，只作用于填料草。'},
  smuggler: {name: '水培走私模组', aliases: ['水培走私', '走私'], gameId: 'farm_module_smuggler', group: 'hydroponic', machine: 'hydroponic', type: 'module',
    base: [0, 0, 0], tone: 'green', sprites: ['farm_module6'], effect: '移除生长中种子的违禁品状态',
    description: '让正在生长的种子不再算违禁品。'},

  metalPrinting: {name: '金属打印模组', aliases: ['金属打印'], gameId: 'printer_module_metal', group: 'machine', machine: 'printer', type: 'module',
    base: [-50, 0, 0], tone: 'blue', sprites: ['long_module1'], effect: '金属打印',
    description: '让 3D 打印机可以使用金属打印芯片。'},
  cnc: {name: '计算机数控模组', aliases: ['计算机数控', '数控', 'CNC'], gameId: 'printer_module_cnc', group: 'machine', machine: 'printer', type: 'module',
    base: [-25, 0, -25], tone: 'dark', sprites: ['long_module3'], effect: '计算机数控',
    description: '与金属打印模组一起安装后，可使用枪械框架与零件芯片。'},
  meleeBatch: {name: '近战武器批量打印模组', aliases: ['近战武器批量打印', '近战批量', '批量打印'], gameId: 'printer_module_melee_batch', group: 'machine', machine: 'printer', type: 'module',
    base: [-50, 0, -50], tone: 'tan', sprites: ['long_module2'], effect: '近战武器打印数量+1',
    description: '打印近战武器时每次多出一把；更慢、更耗电。'},
  dnaStabilizer: {name: '基因稳定模组', aliases: ['基因稳定'], gameId: 'dna_manipulator_module_stabilizer', group: 'machine', machine: 'dna', type: 'module',
    base: [-25, 0, -50], tone: 'blue', sprites: ['long_module1'], effect: '提取后保留目标',
    description: '提取 DNA 后保留目标，可用来去除特性而不销毁目标。'},
  dnaPositiveFilter: {name: '正面特性筛选模组', aliases: ['正面特性筛选', '正面筛选'], gameId: 'dna_manipulator_module_positive_filter', group: 'machine', machine: 'dna', type: 'module',
    base: [-25, 0, 0], tone: 'blue', sprites: ['long_module1'], effect: '仅提取正面特性',
    description: '只提取正面特性；没有正面特性时什么也不提取。'},
  dnaNegativeFilter: {name: '负面特性筛选模组', aliases: ['负面特性筛选', '负面筛选'], gameId: 'dna_manipulator_module_negative_filter', group: 'machine', machine: 'dna', type: 'module',
    base: [-25, 0, 0], tone: 'blue', sprites: ['long_module1'], effect: '仅提取负面特性',
    description: '只提取负面特性；没有负面特性时什么也不提取。'},
  dnaPrecision: {name: '精准提取模组', aliases: ['精准提取'], gameId: 'dna_manipulator_module_precision', group: 'machine', machine: 'dna', type: 'module',
    base: [-75, 0, -75], tone: 'blue', sprites: ['long_module1'], effect: '仅提取已扫描的特性',
    description: '先用它扫描写有特性的 DNA 数据盘，装进 DNA 编辑器后只提取扫描过的特性。'},
  solventRecovery: {name: '蒸发器溶剂回收模组', aliases: ['溶剂回收', '蒸发器溶剂回收'], gameId: 'evaporator_module_solvent_recovery', group: 'machine', machine: 'evaporator', type: 'module',
    base: [-25, 50, 0], tone: 'blue', sprites: ['long_module1'], effect: '仅回收溶剂'},
  furnaceJunk: {name: '熔炉模组（垃圾处理）', aliases: ['垃圾处理', '熔炉垃圾处理'], gameId: 'furnace_module_junk', group: 'machine', machine: 'furnace', type: 'module',
    base: [0, 0, 0], tone: 'dark', sprites: ['long_module3'], effect: '将垃圾转化为废金属',
    description: '让熔炉把垃圾熔成废金属。'},
  furnaceBlast: {name: '熔炉模组（高炉）', aliases: ['高炉', '熔炉高炉'], gameId: 'furnace_module_blast', group: 'machine', machine: 'furnace', type: 'module',
    base: [-100, 0, 0], tone: 'dark', sprites: ['farm_module_l8'], effect: '投入消耗增加；每晚产量增加；纯度降低',
    description: '用低一档的材料炼出高一档金属锭，纯度略低；不可叠加。'},
  alarmTransmitter: {name: '警报传输模组', aliases: ['警报传输', '警报'], gameId: 'alarm_module_transmitter', group: 'machine', machine: 'alarm', type: 'module',
    base: [-50, 0, 0], tone: 'red', sprites: ['farm_module_l7'], effect: '每晚获得+1点声望',
    description: '把监控录像发给指定派系，换取声望。'},

  nodeMedium: {name: '节点（中）', aliases: ['辅助节点', '节点', '中节点', '节点中'], gameId: 'node_medium', group: 'node', machine: 'system', type: 'node',
    base: [0, 0, 0], tone: 'grey', sprites: ['node_m'],
    description: '1×2 / 1×1 的电路件，汇总相邻模组的属性，并为带接收器的模组提供加成。'},
  nodeSmall: {name: '节点（小）', aliases: ['小节点', '节点小'], gameId: 'node_small', group: 'node', machine: 'system', type: 'node',
    base: [0, 0, 0], tone: 'grey', sprites: ['node_s'],
    description: '1×2 / 1×1 的电路件，汇总相邻模组的属性，并为带接收器的模组提供加成。'},
});

/** Kind used when the user adds a node without choosing. */
export const DEFAULT_KIND = Object.freeze({module: 'efficiency', node: 'nodeMedium'});

/** Kind id for user-defined modules that have no official counterpart (always placeholder art). */
export const UNOFFICIAL_KIND = 'unofficial';

/** Display style for anything without official art. */
export const PLACEHOLDER = Object.freeze({name: '非官方样式', note: '官方不存在此种类或形状组合，以占位样式显示'});
