/* Machine parameters from module totals: ModuleHelper.ApplyBasicModuleEffect.
 * Integer C# arithmetic: int division truncates toward zero; (int) casts of floats truncate too.
 *   speed = base + base*P/100                         (no performance ratio)
 *         = (int)(base + (float)(base*P/ratioP)/100)   (with MACHINE_PERFORMANCE_RATIO_INT)
 *   power = base - base*E/100                          (no efficiency ratio)
 *         = (int)(base - (float)(base*E/ratioE)/100)    (with MACHINE_EFFICIENCY_RATIO_INT > 0)
 *   power -= (int)((float)(base*P/ratioP)/100)          (MACHINE_PERFORMANCE_REDUCES_POWER_TAG)
 *   power = max(power, 1)
 * Verified against CURRENT_PROCESSING_SPEED_TAG / machinery_drawn_power stored in real saves. */
import {MACHINE_PARAM_TAGS, MIN_POWER_USE, MOISTURE_GRADES, MOISTURE_QUALITY_OFFSET, OUTPUT_CONSTANTS as C} from '../config/machines.js';
import {tl} from '../i18n/index.js';

const idiv = (a, b) => Math.trunc(a / b);
const PERCENT = 100;

/** Machine constants as stored in the save (missing tags → null / false). */
export function machineParams(tags) {
  const int = key => (tags.has(key) ? tags.get(key).valueInt ?? 0 : null);
  return {
    speedBase: int(MACHINE_PARAM_TAGS.speedBase),
    powerBase: int(MACHINE_PARAM_TAGS.powerBase),
    performanceRatio: int(MACHINE_PARAM_TAGS.performanceRatio),
    efficiencyRatio: int(MACHINE_PARAM_TAGS.efficiencyRatio),
    qualityRatio: int(MACHINE_PARAM_TAGS.qualityRatio),
    performanceReducesPower: tags.has(MACHINE_PARAM_TAGS.performanceReducesPower),
  };
}

/** Parameters for module totals [效率, 质量, 性能]. Entries are null when the machine lacks that stat. */
export function machineStats(params, totals, {power: powerRule = 'basic'} = {}) {
  const [E, , P] = totals;
  let speed = null;
  if (params.speedBase !== null) {
    const base = params.speedBase;
    speed = params.performanceRatio
      ? Math.trunc(base + idiv(base * P, params.performanceRatio) / PERCENT)
      : base + idiv(base * P, PERCENT);
  }
  let power = null;
  if (params.powerBase !== null && powerRule === 'dealMaker') {
    // MachineDealMaker.UpdatePowerUse: efficiency and performance both lower the draw.
    power = Math.max(params.powerBase - idiv(params.powerBase * (E + P), PERCENT), MIN_POWER_USE);
  } else if (params.powerBase !== null) {
    const base = params.powerBase;
    power = params.efficiencyRatio > 0
      ? Math.trunc(base - idiv(base * E, params.efficiencyRatio) / PERCENT)
      : base - idiv(base * E, PERCENT);
    if (params.performanceReducesPower && params.performanceRatio > 0) {
      power -= Math.trunc(idiv(base * P, params.performanceRatio) / PERCENT);
    }
    power = Math.max(power, MIN_POWER_USE);
  }
  return {speed, power};
}

/** ModuleHelper.GetAjustedQuality: quality / MACHINE_QUALITY_RATIO_INT, or 0 without a positive ratio. */
export const adjustedQuality = (params, Q) => (params.qualityRatio > 0 ? idiv(Q, params.qualityRatio) : 0);

const signedPct = v => `${v > 0 ? '+' : ''}${v}%`;

/**
 * Machine-specific effects, each transcribed from the method named in `source`.
 * value(params, [E, Q, P]) returns the display string; only facts visible in the code are shown.
 */
export const MACHINE_OUTPUTS = Object.freeze({
  harvest: {label: tl('收获量'), source: 'HydroponicHelper.GetHarvestCount',
    note: tl('基础收获量 × (1 + 实际质量%)，四舍五入'),
    value: (p, [, Q]) => signedPct(adjustedQuality(p, Q))},
  purifyAmount: {label: tl('净化量加成'), source: 'MachinePurifier.PurifyContainer',
    note: tl('在水质决定的基础倍率上再加 性能%，整体 ×1.25'),
    value: (p, [, , P]) => signedPct(P)},
  purityCapQuality: {label: tl('纯度上限用质量'), source: 'MachinePurifier.GetMaxPurityCap',
    note: tl('质量总值决定可达到的最高纯度'),
    value: (p, [, Q]) => String(Q)},
  furnaceGrade: {label: tl('品质档位'), source: tl('MachineFurnace（熔炼）'),
    note: tl('质量 ÷ {0} 取整；装有高炉模组时 −1', C.furnaceGradeDivisor),
    value: (p, [, Q]) => String(idiv(Q, C.furnaceGradeDivisor))},
  dnaQuality: {label: tl('成功率用质量'), source: 'MachineDnaManipulator.PlanOperation',
    note: tl('实际质量与基因复杂度共同决定成功率'),
    value: (p, [, Q]) => String(adjustedQuality(p, Q))},
  printQuality: {label: tl('打印品质加成'), source: 'MachinePrinter.HandlePrintedItemQuality',
    note: tl('实际质量（另加金属锭品质）用于枪械框架与近战武器的品质'),
    value: (p, [, Q]) => signedPct(adjustedQuality(p, Q))},
  dealChance: {label: tl('交易成功率加成'), source: 'MachineDealMaker.GetChanceIncrease',
    note: tl('{0} + 实际质量，最低 0', C.dealBaseChance),
    value: (p, [, Q]) => `+${Math.max(0, C.dealBaseChance + adjustedQuality(p, Q))}%`},
  alarmPerformance: {label: tl('警报性能'), source: 'MachineAlarm.GetAlarmePerformance',
    note: tl('直接使用性能总值'),
    value: (p, [, , P]) => String(P)},
  attractiveness: {label: tl('吸引力'), source: 'MachineProjector.GetAttractivenessBoost',
    note: tl('{0} + 质量÷质量系数 + 性能÷性能系数，最低 0', C.projectorBase),
    value: (p, [, Q, P]) => `${Math.max(0, C.projectorBase + idiv(Q, Math.max(1, p.qualityRatio ?? 0)) + idiv(P, Math.max(1, p.performanceRatio ?? 0)))}%`},
  moistureVolume: {label: tl('产水量'), source: 'MachineMoistureFarm.GetOutputVolume',
    note: tl('基础 {0} × (100 + 性能)%', C.moistureBaseVolume),
    value: (p, [, , P]) => `${Math.max(0, 100 + P)}%`},
  moistureGrade: {label: tl('产出水质'), source: 'MachineMoistureFarm.GetOutputQuality',
    note: tl('按 质量 + {0} 分档', MOISTURE_QUALITY_OFFSET),
    value: (p, [, Q]) => MOISTURE_GRADES.find(g => Q + MOISTURE_QUALITY_OFFSET < g.below).name},
  agingDays: {label: tl('每日陈酿'), source: 'MachineWineRack.GetAgingDays',
    note: tl('1 + 质量 ÷ {0}（质量最低按 0 计）', C.wineAgingDivisor),
    value: (p, [, Q]) => tl('{0} 天', 1 + idiv(Math.max(0, Q), C.wineAgingDivisor))},
  evaporatorRate: {label: tl('处理倍率'), source: tl('MachineEvaporator（蒸发）'),
    note: tl('1 + 性能 ÷ 100'),
    value: (p, [, , P]) => `×${(1 + P / PERCENT).toFixed(2)}`},
  evaporatorQuality: {label: tl('有效质量'), source: tl('MachineEvaporator（蒸发）'),
    note: tl('质量限制在 0–{0}', C.evaporatorQualityMax),
    value: (p, [, Q]) => String(Math.min(C.evaporatorQualityMax, Math.max(0, Q)))},
});
