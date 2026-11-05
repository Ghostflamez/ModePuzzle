/* Machines whose module bays this tool can optimise, transcribed from the game code
 * (MachineHelper.LoadUpgrade / ExpandModule, Machine*.CreateMachineInventoryWindow and
 * the module type filters in each machine constructor). Chemical machines are out of scope. */

/** Bay shapes: one string per upgrade stage, row-major, '1' = unavailable, '0' = usable. */
export const BAY_LAYOUTS = Object.freeze({
  standard: {w: 7, stages: [
    '10000010001000001110000010001000001', // stage 0: corners and a centre cross missing (26 cells)
    '10000010000000000000000000001000001', // stage 1: corners missing (31 cells)
    '00000000000000000000000000000000000', // stage 2: full 7 × 5 (35 cells)
  ]},
  evaporator: {w: 4, stages: ['0000000000000000']},
});

/** Save tag holding a standard machine's bay upgrade stage. */
export const UPGRADE_STAGE_TAG = 'MODULE_UPGRADE_STAGE_INT';
/** Tag that marks machines with the standard upgradable bay. */
export const STANDARD_MACHINE_TAG = 'STANDARD_MACHINE_TAG';

export const MODULE_TYPES = Object.freeze({
  universal: 'MODULE_TYPE_UNIVERSAL',
  hydroponic: 'MODULE_TYPE_HYDROPONIC',
  printer: 'MODULE_TYPE_PRINTER',
  dna: 'MODULE_TYPE_DNA_MANIPULATOR',
  evaporator: 'MODULE_TYPE_EVAPORATOR',
  furnace: 'MODULE_TYPE_FURNACE',
  alarm: 'MODULE_TYPE_ALARM',
});

/** Module type of each catalogue machine group (MACHINES in catalog.js). */
export const MODULE_TYPE_BY_CATALOG_MACHINE = Object.freeze({
  system: MODULE_TYPES.universal, hydroponic: MODULE_TYPES.hydroponic, printer: MODULE_TYPES.printer,
  dna: MODULE_TYPES.dna, evaporator: MODULE_TYPES.evaporator, furnace: MODULE_TYPES.furnace, alarm: MODULE_TYPES.alarm,
});

const U = MODULE_TYPES.universal;
/**
 * Every vanilla machine with a module bay, by save identifier (FurnitureItemDirectory.InitDirectory
 * → Machine*.CreateMachineInventoryWindow / constructor module filters).
 * `outputs`: machine-specific effects computed in core/machine-stats.js (MACHINE_OUTPUTS).
 * `power`: 'basic' (ModuleHelper.ApplyBasicModuleEffect) or 'dealMaker' (MachineDealMaker.UpdatePowerUse).
 * Machines carrying STANDARD_MACHINE_TAG that are not listed (e.g. from mods) use UNKNOWN_STANDARD_MACHINE.
 */
export const MACHINE_BAYS = Object.freeze({
  hydroponic: {layout: 'standard', accepts: [U, MODULE_TYPES.hydroponic], outputs: ['harvest']},
  water_purifier: {layout: 'standard', accepts: [U], outputs: ['purifyAmount', 'purityCapQuality']},
  furnace: {layout: 'standard', accepts: [U, MODULE_TYPES.furnace], outputs: ['furnaceGrade']},
  plant_dna_manipulator: {layout: 'standard', accepts: [U, MODULE_TYPES.dna], outputs: ['dnaQuality']},
  printer: {layout: 'standard', accepts: [U, MODULE_TYPES.printer], outputs: ['printQuality']},
  deal_maker: {layout: 'standard', accepts: [U], outputs: ['dealChance'], power: 'dealMaker'},
  security_alarm: {layout: 'standard', accepts: [U, MODULE_TYPES.alarm], outputs: ['alarmPerformance']},
  mirage_projector: {layout: 'standard', accepts: [U], outputs: ['attractiveness']},
  moisture_farm: {layout: 'standard', accepts: [U], outputs: ['moistureVolume', 'moistureGrade']},
  desequencer: {layout: 'standard', accepts: [U, MODULE_TYPES.alarm], outputs: []},
  wine_rack: {layout: 'standard', accepts: [U], outputs: ['agingDays']},
  evaporator: {layout: 'evaporator', accepts: [U, MODULE_TYPES.evaporator], outputs: ['evaporatorRate', 'evaporatorQuality']},
});
/** Fallback for unlisted machines that have the standard upgradable bay. */
export const UNKNOWN_STANDARD_MACHINE = Object.freeze({layout: 'standard', accepts: [U], outputs: []});

/** Never offered for optimisation (chemical machines use a separate module system). */
export const EXCLUDED_MACHINES = Object.freeze(['blender', 'heating_plate', 'chem_finisher']);
/** Module items that are not part of the effect system. */
export const EXCLUDED_MODULE_IDS = Object.freeze(['chem_module']);

/** Save effect tag values → trait ids (config/game-rules.js TRAITS). */
export const SAVE_EFFECTS = Object.freeze({
  MODULE_EFFECT_SIDE_MOUNT: 'left',
  MODULE_EFFECT_TOP_MOUNT: 'top',
  MODULE_EFFECT_NEGATIVE_FEEDBACK: 'negative',
  MODULE_EFFECT_RECEIVER: 'receiver',
  MODULE_EFFECT_PREMIUM: 'premium',
  MODULE_EFFECT_INFERIOR: 'inferior',
  MODULE_EFFECT_OVERVOLTED: 'overvolted',
  MODULE_EFFECT_DEGRADING: 'degrading',
  MODULE_EFFECT_LEARNING_ALGORITHM: 'learning',
});
/** Node effect, carried by every node; not a module trait. */
export const SAVE_NODE_EFFECT = 'NODE_EFFECT_SUPPORT';
export const SAVE_EFFECT_TAGS = Object.freeze(['MODULE_EFFECT1_TAG', 'MODULE_EFFECT2_TAG']);
/** Base attribute tags in this tool's axis order [效率, 质量, 性能]. */
export const SAVE_BASE_TAGS = Object.freeze(['BONUS_PERCENTAGE_EFFICIENCY_INT', 'BONUS_PERCENTAGE_QUALITY_INT', 'BONUS_PERCENTAGE_PERFORMANCE_INT']);
/** 自学习算法 growth caps per axis, same order as SAVE_BASE_TAGS (absent tag: that axis never grows). */
export const SAVE_LEARN_CAP_TAGS = Object.freeze(['LEARNING_ALGO_MAX_EFFICIENCY_INT', 'LEARNING_ALGO_MAX_QUALITY_INT', 'LEARNING_ALGO_MAX_PERFORMANCE_INT']);
/** Machine constants read from the save (see core/machine-stats.js). */
export const MACHINE_PARAM_TAGS = Object.freeze({
  speedBase: 'BASE_PROCESSING_SPEED_TAG',
  powerBase: 'MACHINERY_DRAWN_POWER_BASE',
  performanceRatio: 'MACHINE_PERFORMANCE_RATIO_INT',
  efficiencyRatio: 'MACHINE_EFFICIENCY_RATIO_INT',
  qualityRatio: 'MACHINE_QUALITY_RATIO_INT',
  performanceReducesPower: 'MACHINE_PERFORMANCE_REDUCES_POWER_TAG',
});
/** Largest save file accepted (bytes). Real saves are a few MB. */
export const MAX_SAVE_BYTES = 64 * 1024 * 1024;
/** The game never lets a machine draw less than this much power per day. */
export const MIN_POWER_USE = 1;

/** Moisture farm water grade by (quality + offset): MachineMoistureFarm.GetOutputQuality; names from zh mech_condition_*. */
export const MOISTURE_QUALITY_OFFSET = 50;
export const MOISTURE_GRADES = Object.freeze([
  {below: 0, name: '沟渠水'},
  {below: 50, name: '铁锈水'},
  {below: 100, name: '幽灵水'},
  {below: 150, name: '基础水'},
  {below: 200, name: '优质水'},
  {below: Infinity, name: '纯水'},
]);
/** Constants that appear in the machine output code. */
export const OUTPUT_CONSTANTS = Object.freeze({
  dealBaseChance: 10,          // MachineDealMaker.GetChanceIncrease: 10 + adjusted quality, min 0
  projectorBase: 100,          // MachineProjector.GetAttractivenessBoost: 100 + Q/ratioQ + P/ratioP, min 0
  wineAgingDivisor: 125,       // MachineWineRack.GetAgingDays: 1 + max(0, Q) / 125
  moistureBaseVolume: 850000,  // MachineMoistureFarm.GetOutputVolume: 850000 * (100 + P) / 100
  furnaceGradeDivisor: 100,    // Furnace: quality / 100 purity steps
  evaporatorQualityMax: 100,   // Evaporator: quality clamped to 0..100
});

/** Inventories in the save that hold the player's own items. */
export const SAVE_INVENTORIES = Object.freeze(['mainInvJSON', 'backInvJSON']);
