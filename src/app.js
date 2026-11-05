/* UI controller: input, state, rendering and worker communication. */
import {
  METRICS, SCHEMA_VERSION, SCORING_VERSION, SELECTION_VERSION, TRAITS, NODE_EFFECT, TYPE_RULES,
  DEFAULT_RULES, LIMITS, EPSILON, MATCH_MODES, RULE_PERCENT_RANGE, RULE_PERCENT_KEYS, RISK_TRAITS, MAX_MODULE_EFFECTS,
  fillRuleText, traitConflicts,
} from './config/game-rules.js';
import {MODULE_KINDS, KIND_GROUPS, MACHINES, DEFAULT_KIND, UNOFFICIAL_KIND, PLACEHOLDER} from './config/catalog.js';
import {
  DEFAULT_BOARD, BRAND_KIND, SEARCH_BUDGETS, PIXEL_ICONS, PICKER_TABS, SHAPE_NAMES, SMALL_SQUARE_GROUP, TOAST_MS, OBJECT_URL_REVOKE_MS, NUMBER_FORMAT, BOARD_RENDER, FILES, DEMO_ITEMS, THUMBNAILS,
} from './config/ui.js';
import {
  validate, connected, normalize, orientations, defaultCustom, migrateConfig, effectiveBounds, evaluate, searchQuantity,
  boundsFromMatch, canStartMatch, matchStartValue, hedgeSummary,
} from './core/engine.js';
import {loadSavedConfig, saveConfig, backupBeforeSaveImport, STORAGE_KEY} from './core/storage.js';
import {APP_VERSION} from './config/app-info.js';
import {stackInventory, transferOne, lockResultItems, unlockAllItems} from './core/inventory.js';
import {matchKindsByName, displayName, nameTag, normalizeName} from './core/naming.js';
import {readSave, bayBoard} from './core/save-import.js';
import {
  activeMachine, boardOf, importSave, machineLayout, machineCandidates, optimisationConfig, takeSnapshot, clearSnapshot,
  isShared, setMachineShared, applySearchLimit, changeBayStage, layoutIdOf,
  confirmResult, locationOf, isImported, moduleTypeOf, FREE,
} from './core/machine-view.js';
import {machineStats, MACHINE_OUTPUTS} from './core/machine-stats.js';
import {MAX_SAVE_BYTES, MACHINE_BAYS, UNKNOWN_STANDARD_MACHINE, BAY_LAYOUTS} from './config/machines.js';
import {resolveVisual, paintVisual, thumbnail, pixelIcon, kindShapes} from './render/sprites.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const AXES = METRICS.map((_, k) => k);

/* ---------- state ---------- */

const initialBoard = () => ({
  w: DEFAULT_BOARD.w, h: DEFAULT_BOARD.h,
  cells: Array.from({length: DEFAULT_BOARD.w * DEFAULT_BOARD.h}, (_, i) => !DEFAULT_BOARD.blocked.includes(i)),
});
const blank = () => ({
  version: SCHEMA_VERSION, scoringVersion: SCORING_VERSION, selectionVersion: SELECTION_VERSION,
  board: initialBoard(), items: [], rules: {...DEFAULT_RULES}, optional: true, target: 0, custom: defaultCustom(),
});

let config = blank();
let worker = null;
let result = null;
let lastConfig = null;
let editingBoard = false;
let selectedInstance = null;
let detailTarget = 0;
let started = 0;
let toastTimer;
let storageProtected = false;
/** Inventory search / filter (session only). */
const filter = {text: '', group: 'all', trait: 'all', state: 'all'};
/** Draft of the item dialog. */
let draft = null;

try {
  const saved = loadSavedConfig(localStorage);
  if (saved) config = saved;
} catch {
  storageProtected = true;
  setTimeout(() => {
    toast('旧存档读取失败，原数据已保留且不会被覆盖；请先导出备份');
    $('#save-state').textContent = '原存档已保护，请导出备份';
  });
}

/* ---------- helpers ---------- */

function toast(msg) {
  $('#toast').textContent = msg;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), TOAST_MS);
}
const newId = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const numberFormat = new Intl.NumberFormat(NUMBER_FORMAT.locale, {maximumFractionDigits: NUMBER_FORMAT.maximumFractionDigits});
const fmt = v => numberFormat.format(Math.abs(v) < NUMBER_FORMAT.zeroBelow ? 0 : v);
const signed = v => (v > 0 ? '+' : '') + fmt(v);

function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], {type}));
  const a = el('a', {href: url, download: name});
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS);
}

const kindName = visual => (visual.kindId ? MODULE_KINDS[visual.kindId].name : PLACEHOLDER.name);
/** Official name (or the item's own name when it has no official kind). */
const itemTitle = item => displayName(item, resolveVisual(item).kindId);
/** The user's entered name, shown as an extra tag unless it only repeats the official name. */
const itemTag = item => nameTag(item, resolveVisual(item).kindId);
const itemLabel = item => (itemTag(item) ? `${itemTitle(item)}「${itemTag(item)}」` : itemTitle(item));
const itemIdOf = instance => instance.slice(0, instance.lastIndexOf(':'));
const INFERRED_BY = {name: '按名称推断', shape: '按形状与属性推断'};
const lockedCount = () => config.items.filter(i => i.locked).reduce((n, i) => n + i.qty, 0);
const displayRows = () => result?.layout?.rows || [];
const findItem = id => config.items.find(i => i.id === id);

/* ---------- static text from config ---------- */

function fillStaticText() {
  const rules = config.rules;
  $$('[data-rule]').forEach(n => { n.textContent = rules[n.dataset.rule]; });
  const usable = DEFAULT_BOARD.w * DEFAULT_BOARD.h - DEFAULT_BOARD.blocked.length;
  $$('[data-board-default]').forEach(n => { n.textContent = `${DEFAULT_BOARD.w} 列 × ${DEFAULT_BOARD.h} 行、四角不可用，共 ${usable} 格`; });
  for (const id of ['#board-w', '#board-h']) Object.assign($(id), {min: LIMITS.boardMinSide, max: LIMITS.boardMaxSide});
  for (const k of AXES) Object.assign($(`#base-${k}`), {min: -LIMITS.maxAbsBaseValue, max: LIMITS.maxAbsBaseValue});
  Object.assign($('#item-qty'), {min: 1, max: LIMITS.maxStackQuantity});
  $('#item-name').maxLength = LIMITS.maxNameLength;
  for (const id of RULE_PERCENT_KEYS) Object.assign($(`#rule-${id}`), RULE_PERCENT_RANGE);
}

function buildSelects() {
  $('#budget').replaceChildren(...SEARCH_BUDGETS.map(b => {
    const o = el('option', {value: b.seconds, text: b.label});
    o.selected = !!b.default;
    return o;
  }));
  $('#custom-primary').replaceChildren(...METRICS.map((m, k) => el('option', {value: k, text: m})));
  $('#custom-secondary').replaceChildren(el('option', {value: 'none', text: '不设置'}), ...METRICS.map((m, k) => el('option', {value: k, text: m})));
  $$('#targets [data-target]').forEach(b => { if (b.dataset.target !== 'custom') b.textContent = METRICS[Number(b.dataset.target)]; });
}

/**
 * Styled replacement for window.confirm(). `message` may be a string or an array of
 * paragraphs. Resolves true only when the confirm button is pressed.
 */
function askConfirm({title, message, confirmText = '确认', danger = false}) {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').replaceChildren(...[].concat(message).map(text => el('p', {text})));
  const ok = $('#confirm-ok');
  ok.textContent = confirmText;
  ok.className = 'btn ' + (danger ? 'btn-red' : 'btn-orange');
  const icon = pixelIcon('warning', THUMBNAILS.dialogIconScale, {ink: '--chip-ink', accent: '--warn-accent'});
  const target = $('#confirm-icon');
  target.width = icon.width;
  target.height = icon.height;
  target.getContext('2d').drawImage(icon, 0, 0);
  return new Promise(resolve => {
    const finish = value => {
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onClose = () => finish(false);
    dialog.addEventListener('close', onClose);
    $$('#confirm-dialog [data-confirm]').forEach(b => { b.onclick = () => finish(b.dataset.confirm === 'ok'); });
    dialog.showModal();
    ok.focus();
  });
}

function drawReadonlyIcon() {
  const icon = pixelIcon('locked', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--warn-accent'});
  const target = $('#readonly-icon');
  target.width = icon.width;
  target.height = icon.height;
  target.getContext('2d').drawImage(icon, 0, 0);
}

function drawBrand() {
  const icon = thumbnail(resolveVisual({type: 'module', kind: BRAND_KIND, shape: kindShapes(BRAND_KIND)[0].cells, base: [0, 0, 0]}), THUMBNAILS.brand);
  const brand = $('#brand-icon');
  brand.width = icon.width;
  brand.height = icon.height;
  brand.getContext('2d').drawImage(icon, 0, 0);
}

/* ---------- persistence ---------- */

function persist() {
  try {
    if (storageProtected) throw Error('旧存档受保护');
    saveConfig(localStorage, config);
    $('#save-state').textContent = '已自动保存到此浏览器';
  } catch {
    $('#save-state').textContent = '自动保存不可用，请导出配置';
  }
}

function invalidate() {
  config = stackInventory(config);
  if (worker) {
    worker.terminate();
    worker = null;
    setRunning(false);
  }
  result = currentMachineResult();
  lastConfig = null;
  selectedInstance = null;
  $('#status').textContent = result ? '本机器当前排布' : '配置已更新，等待计算';
  $('#status-dot').className = 'dot';
  $('#search-stats').textContent = '';
  $('#result-note').textContent = config.target === 'custom'
    ? '仅显示满足所有范围的布局；搜索完成后才确认按优先级达到最优。'
    : '限时搜索返回当前最佳布局；只有搜索完成后才标记为全局最优。';
  $('#export-result').disabled = true;
  persist();
  render();
}

/* ---------- trait chips ---------- */

function traitChip(id, {compact = false} = {}) {
  const t = TRAITS[id];
  const title = `${t.name}：${fillRuleText(t.description, config.rules)}\n${t.note}`;
  const kind = t.scoring ? '' : t.risk ? ' trait-risk' : ' trait-passive';
  return el('span', {class: `trait-chip trait-${id}${kind}${compact ? ' compact' : ''}`, title},
    [pixelIcon(t.icon, THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), compact ? null : el('b', {text: t.name})]);
}
function nodeChip() {
  return el('span', {class: 'trait-chip trait-node', title: `${NODE_EFFECT.name}：${fillRuleText(NODE_EFFECT.description, config.rules)}\n${NODE_EFFECT.note}`},
    [pixelIcon(NODE_EFFECT.icon, THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), el('b', {text: NODE_EFFECT.name})]);
}

/* ---------- inventory ---------- */

function renderLocks() {
  const done = !!result?.done && !!result?.feasible && !!result?.placements?.length && !result.current;
  const machine = activeMachine(config);
  $('#lock-result').hidden = !done;
  $('#lock-result').disabled = !!worker;
  $('#lock-result').textContent = machine ? '确认更改' : '锁定本次布局中的所有插入物';
  $('#lock-result').title = machine ? `把这个排布写入「${machine.name}」：用到的模组移入本机器，未用到的本机器模组回到自由模组，并删除排布副本` : '';
  $('#unlock-all').hidden = !lockedCount();
  $('#unlock-all').disabled = !!worker;
  $('#lock-note').textContent = machine
    ? '「确认更改」只更新本工具中的数据，不会写回游戏存档；请在游戏中手动按此排布摆放。'
    : `已锁定排除 ${lockedCount()} 件。锁定件不参与优化；必选件必须用到。批量锁定只排除本次结果实际用到的数量。`;
  $('#lock-note').classList.toggle('readonly-note', !!machine);
  $('#edit-board').disabled = !!worker;
  $('#legacy-selection-note').hidden = !config.legacySelectionReview;
}

function itemCard(item, selected) {
  const visual = resolveVisual(item);
  const pinned = item.required === true && item.locked !== true;
  const card = el('article', {class: 'item-card' + (selected ? ' selected-card' : '') + (item.locked ? ' locked-card' : '') + (pinned ? ' required-pin-card' : ''), 'data-item-id': item.id});
  if (pinned) card.append(el('div', {class: 'pin-badge'}, ['★ 必选 · 置顶']));
  if (selected) {
    const rows = displayRows();
    card.append(el('div', {class: 'selected-badge', text: `已选中 · 图注 ${rows.indexOf(selected) + 1} 号 · 第 ${selected.instance.split(':').pop()} 件`}));
  }
  const tag = itemTag(item);
  const kindLabel = el('span', {class: 'kind-label' + (visual.official ? '' : ' unofficial')}, [
    tag ? el('span', {class: 'name-tag', text: tag, title: ['输入的名称', ...(item.aliases || [])].join(' / ')}) : null,
    visual.official ? null : document.createTextNode(PLACEHOLDER.name),
    visual.inferred ? el('em', {text: visual.inferredBy === 'name' ? '名称匹配' : '推断', title: `旧数据未记录官方种类，${INFERRED_BY[visual.inferredBy] || '无法推断'}`}) : null,
  ]);
  const kind = visual.kindId ? MODULE_KINDS[visual.kindId] : null;
  const head = el('div', {class: 'item-top'}, [
    el('div', {class: 'slot-thumb', title: visual.official ? kindName(visual) : PLACEHOLDER.note}, [thumbnail(visual, THUMBNAILS.card)]),
    el('div', {class: 'item-info'}, [
      el('div', {class: 'item-name', text: itemTitle(item), title: [item.name, ...(item.aliases || [])].filter(Boolean).join(' / ')}),
      kindLabel,
      el('small', {text: `${shapeName(item.shape, visual.kindId)} · ×${item.qty}${kind && kind.machine !== 'system' ? ' · ' + MACHINES[kind.machine].name + '专用' : ''}`}),
    ]),
    el('div', {class: 'item-actions'}, [
      el('button', {class: 'btn btn-small', text: '编辑', title: '编辑 ' + itemLabel(item), onclick: () => openItem(item)}),
      el('button', {class: 'btn btn-small btn-red', text: '×', title: '删除 ' + itemLabel(item), onclick: () => {
        config.items = config.items.filter(i => i.id !== item.id);
        invalidate();
      }}),
    ]),
  ]);
  card.append(head);
  card.append(el('div', {class: 'item-values'}, item.base.map((v, k) => el('span', {}, [METRICS[k], el('b', {text: signed(v), class: v < 0 ? 'negative' : v > 0 ? 'positive' : ''})]))));
  const traits = item.type === 'node' ? [nodeChip()] : item.traits.map(t => traitChip(t));
  if (kind?.contraband) traits.push(el('span', {class: 'trait-chip trait-contraband', title: '游戏中属于违禁品'}, [pixelIcon('contraband', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), el('b', {text: '违禁品'})]));
  if (kind?.effect) traits.push(el('span', {class: 'trait-chip trait-effect', title: kind.description || '', text: kind.effect}));
  if (traits.length) card.append(el('div', {class: 'traits'}, traits));
  const machine = activeMachine(config);
  const own = machine && locationOf(item) === machine.key;
  if (own) {
    const state = !machine.shared ? ' · 本机器已锁定，优化时排除' : item.locked ? ' · 已单独锁定，优化时排除' : ' · 可重新排布';
    card.append(el('div', {class: 'card-note own', text: `装在「${machine.name}」中${state}`}));
  }
  const home = config.save?.machines.find(m => m.key === locationOf(item));
  if (machine && home && !own) card.append(el('div', {class: 'card-note borrowed', text: `装在「${home.name}」中 · 已解锁，可被调用`}));
  if (machine && !own && item.type !== 'node' && !machine.accepts.includes(moduleTypeOf(item))) {
    card.classList.add('unusable-card');
    card.append(el('div', {class: 'card-warning soft', text: `「${machine.name}」不能安装这种模组`}));
  }
  for (const t of item.traits.filter(id => TRAITS[id]?.risk)) {
    card.append(el('div', {class: 'card-warning', title: TRAITS[t].note}, [pixelIcon('warning', 1, {ink: '--chip-ink', accent: '--warn-accent'}), `${TRAITS[t].name}：${TRAITS[t].warning}`]));
  }
  for (const problem of traitConflicts(item.traits)) card.append(el('div', {class: 'card-warning soft', text: problem}));
  if (item.traits.some(id => TRAITS[id]?.evolving)) card.append(learningEditor(item));
  const lockAction = el('button', {
    class: 'btn btn-small' + (item.locked ? ' btn-orange' : ''), text: item.locked ? '解锁一个' : '锁定一个',
    'aria-label': `${itemLabel(item)}：${item.locked ? '解锁一个' : '锁定一个'}`,
    onclick: () => {
      if (worker) return;
      try {
        config = transferOne(config, item.id, !item.locked, newId());
        invalidate();
        toast(item.locked ? '已解锁一件，可重新参与优化' : '已锁定一件，优化时将排除');
      } catch (e) { toast(e.message); }
    },
  });
  const must = el('input', {type: 'checkbox', class: 'required-check', 'aria-label': `${itemLabel(item)}：必选全部 ${item.qty} 件`,
    onchange: e => { item.required = e.target.checked; invalidate(); }});
  must.checked = item.required === true;
  must.disabled = item.locked === true;
  card.append(el('div', {class: 'inventory-lock-row'}, [
    el('label', {class: 'check'}, [must, `必选 · 全部 ${item.qty} 件${item.locked ? '（请先解锁）' : ''}`]),
    item.locked ? el('span', {class: 'locked-tag'}, [pixelIcon('locked', 1, {ink: '--chip-ink', accent: '--chip-accent'}), '已锁定']) : null,
    lockAction,
  ]));
  if (worker) card.querySelectorAll('button,input').forEach(b => { b.disabled = true; });
  return card;
}

const FILTER_STATES = Object.freeze([
  {id: 'all', label: '全部状态'},
  {id: 'required', label: '必选', test: item => item.required === true},
  {id: 'locked', label: '已锁定', test: item => item.locked === true},
  {id: 'free', label: '未锁定', test: item => item.locked !== true},
  {id: 'inferred', label: '待确认种类', test: item => item.kind === undefined},
  {id: 'placeholder', label: '非官方样式', test: item => !resolveVisual(item).official},
  {id: 'risk', label: '退化 / 过载', test: item => item.traits.some(t => RISK_TRAITS.includes(t))},
  {id: 'evolving', label: '自学习（数值会变）', test: item => item.traits.some(t => TRAITS[t]?.evolving)},
  {id: 'used', label: '本次布局已用', test: item => displayRows().some(r => r.itemId === item.id)},
]);
const PLACEHOLDER_GROUP = 'placeholder';

function buildFilters() {
  const option = (value, text) => el('option', {value, text});
  $('#filter-group').replaceChildren(option('all', '全部分类'), ...KIND_GROUPS.map(g => option(g.id, g.name)), option(PLACEHOLDER_GROUP, PLACEHOLDER.name));
  $('#filter-trait').replaceChildren(option('all', '全部词条'), ...Object.entries(TRAITS).map(([id, t]) => option(id, t.name)), option('none', '无词条'));
  $('#filter-state').replaceChildren(...FILTER_STATES.map(st => option(st.id, st.label)));
  $('#filter-text').oninput = e => { filter.text = e.target.value; renderItems(); };
  for (const key of ['group', 'trait', 'state']) $(`#filter-${key}`).onchange = e => { filter[key] = e.target.value; renderItems(); };
  $('#filter-reset').onclick = () => {
    Object.assign(filter, {text: '', group: 'all', trait: 'all', state: 'all'});
    for (const key of ['text', 'group', 'trait', 'state']) $(`#filter-${key}`).value = filter[key];
    renderItems();
  };
}

/** Text the search box looks through: official name, tag, aliases, kind terms, traits, machine and effect. */
function searchText(item) {
  const visual = resolveVisual(item);
  const kind = visual.kindId ? MODULE_KINDS[visual.kindId] : null;
  const traitNames = item.type === 'node' ? [NODE_EFFECT.name] : item.traits.map(t => TRAITS[t].name);
  return [itemTitle(item), item.name, ...(item.aliases || []), kind?.name, ...(kind?.aliases || []), kind?.effect,
    kind ? MACHINES[kind.machine].name : PLACEHOLDER.name, TYPE_RULES[item.type].name, ...traitNames]
    .filter(Boolean).map(normalizeName).join('|');
}

function matchesFilter(item) {
  const visual = resolveVisual(item);
  const group = visual.official ? MODULE_KINDS[visual.kindId].group : PLACEHOLDER_GROUP;
  if (filter.group !== 'all' && group !== filter.group) return false;
  if (filter.trait === 'none' ? item.traits.length > 0 : filter.trait !== 'all' && !item.traits.includes(filter.trait)) return false;
  const state = FILTER_STATES.find(st => st.id === filter.state);
  if (state?.test && !state.test(item)) return false;
  const words = filter.text.trim().split(/\s+/).map(normalizeName).filter(Boolean);
  const haystack = words.length ? searchText(item) : '';
  return words.every(w => haystack.includes(w));
}

const filterActive = () => filter.text.trim() !== '' || filter.group !== 'all' || filter.trait !== 'all' || filter.state !== 'all';

/** Quick value editor for 自学习算法 modules, whose base grows with use. */
function learningEditor(item) {
  const t = TRAITS[item.traits.find(id => TRAITS[id]?.evolving)];
  const inputs = AXES.map(k => el('input', {type: 'number', step: 'any', value: item.base[k], min: -LIMITS.maxAbsBaseValue, max: LIMITS.maxAbsBaseValue,
    'aria-label': `${itemLabel(item)} 当前${METRICS[k]}`}));
  // Growth caps come from the save; they decide whether this module can still hedge 退化.
  const caps = AXES.map(k => el('input', {type: 'number', step: 'any', min: 0, max: LIMITS.maxAbsBaseValue, value: item.learnCap?.[k] ?? '',
    placeholder: '未知', 'aria-label': `${itemLabel(item)} ${METRICS[k]}成长上限`}));
  const save = el('button', {type: 'button', class: 'btn btn-small btn-green', text: '更新', onclick: () => {
    if (worker) return;
    try {
      const next = structuredClone(config);
      const target = next.items.find(i => i.id === item.id);
      target.base = inputs.map(input => Number(input.value));
      const capValues = caps.map(input => (input.value.trim() === '' ? null : Number(input.value)));
      if (capValues.every(v => v === null)) delete target.learnCap;
      else if (capValues.some(v => v === null)) throw Error('成长上限要么三项都填，要么都留空');
      else target.learnCap = capValues;
      validate(next);
      config = next;
      invalidate();
      toast(`已更新「${itemLabel(target)}」的数值${item.qty > 1 ? `（同堆叠 ${item.qty} 件一起更新）` : ''}`);
    } catch (e) { toast(e.message); }
  }});
  [...inputs, ...caps].forEach(input => { input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save.click(); } }; });
  const full = item.learnCap && AXES.every(k => item.base[k] >= item.learnCap[k]);
  const capNote = !item.learnCap ? '成长上限未知（重新读取存档可获得），不参与退化对冲'
    : full ? '已达成长上限，不再增长，不参与退化对冲'
      : `仍在增长：${AXES.filter(k => item.base[k] < item.learnCap[k]).map(k => METRICS[k]).join('、')}；同分时优先用来对冲同属性的退化`;
  return el('div', {class: 'learning-edit', title: t.note}, [
    el('div', {class: 'learning-tip'}, [pixelIcon(t.icon, 1, {ink: '--chip-ink', accent: '--tip-accent'}), `${t.name}：${t.tip}`]),
    el('div', {class: 'learning-inputs'}, [el('span', {class: 'learning-row-label', text: '当前'}), ...inputs.map((input, k) => el('label', {}, [METRICS[k], input])), save]),
    el('div', {class: 'learning-inputs'}, [el('span', {class: 'learning-row-label', text: '上限'}), ...caps.map((input, k) => el('label', {}, [METRICS[k], input]))]),
    el('div', {class: 'learning-cap-note' + (item.learnCap && !full ? '' : ' muted'), text: capNote}),
  ]);
}

function renderItems() {
  const machine = activeMachine(config);
  const inView = item => (machine
    ? isImported(item) && (locationOf(item) === FREE || locationOf(item) === machine.key || isShared(config, locationOf(item)))
    : locationOf(item) === FREE);
  const pool = config.items.filter(inView);
  const hidden = config.items.filter(i => !inView(i)).reduce((s, i) => s + i.qty, 0);
  const total = pool.reduce((s, i) => s + i.qty, 0);
  $('#inventory-count').textContent = `${total} 件`;
  $('#inventory-empty').hidden = !!config.items.length;
  $('#inferred-note').hidden = !config.items.some(i => i.kind === undefined);
  const selected = displayRows().find(r => r.instance === selectedInstance);
  // The piece selected on the board stays visible and on top even when filtered out.
  const visible = pool.filter(item => item.id === selected?.itemId || matchesFilter(item));
  const ownFirst = item => (machine && locationOf(item) === machine.key ? 2 : machine && locationOf(item) !== FREE ? 1 : 0);
  // 必选 modules stay pinned (right after the board selection) until they are no longer required or get locked.
  const pinned = item => Number(item.required === true && item.locked !== true);
  const ordered = visible.sort((a, b) => Number(b.id === selected?.itemId) - Number(a.id === selected?.itemId)
    || pinned(b) - pinned(a) || ownFirst(b) - ownFirst(a));
  $('#items').replaceChildren(...ordered.map(item => itemCard(item, item.id === selected?.itemId ? selected : null)));
  const active = filterActive();
  const hiddenNote = hidden ? `；${machine ? '其他机器中与手动添加的' : '装在机器中的'} ${hidden} 件未显示` : '';
  $('#filter-count').textContent = (active ? `显示 ${visible.length} / 共 ${pool.length} 条` : `共 ${pool.length} 条`) + hiddenNote;
  $('#filter-reset').hidden = !active;
  $('#filter-empty').hidden = !pool.length || visible.length > 0;
}

function selectInstance(instance) {
  selectedInstance = instance;
  renderItems();
  renderBoard();
  renderDetails();
  $('.inventory .window-body').scrollTop = 0;
}

/* ---------- board ---------- */

function renderPieces() {
  const board = $('#board');
  board.querySelector('.piece-layer')?.remove();
  const rows = displayRows();
  if (editingBoard || !rows.length) return;
  const bounds = board.getBoundingClientRect();
  const cell = board.querySelector('.cell')?.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(board).columnGap) || 0;
  if (!bounds.width || !cell) return;
  const pitch = cell.width + gap;
  const ratio = window.devicePixelRatio || 1;
  const layer = el('canvas', {class: 'piece-layer', 'aria-hidden': 'true'});
  layer.width = Math.round(bounds.width * ratio);
  layer.height = Math.round(bounds.height * ratio);
  const ctx = layer.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.imageSmoothingEnabled = false;
  const originX = cell.left - bounds.left - gap / 2;
  const originY = cell.top - bounds.top - gap / 2;
  const bay = boardOf(config);
  const w = bay.w;
  const usable = bay.cells.flatMap((v, i) => (v ? [i] : []));
  const minX = Math.min(...usable.map(i => i % w));
  const minY = Math.min(...usable.map(i => Math.floor(i / w)));
  const unit = Math.round(pitch * ratio) / ratio;
  const rootStyle = getComputedStyle(document.documentElement);
  const glow = rootStyle.getPropertyValue('--mount-glow').trim();
  const plate = rootStyle.getPropertyValue('--badge-plate').trim();

  for (const row of rows) {
    const item = findItem(row.itemId);
    const coords = row.cells.map(c => [c % w, Math.floor(c / w)]);
    const mx = Math.min(...coords.map(p => p[0]));
    const my = Math.min(...coords.map(p => p[1]));
    const visual = resolveVisual(item, coords);
    const tile = paintVisual(document.createElement('canvas'), visual, Math.round(unit * ratio), {selected: row.instance === selectedInstance});
    ctx.drawImage(tile, originX + mx * pitch, originY + my * pitch, visual.w * pitch, visual.h * pitch);

    // Triggered mounts: glow on the bay edge the piece touches.
    const thick = Math.max(2, pitch * BOARD_RENDER.mountGlowScale);
    ctx.fillStyle = glow;
    if (row.left && item.traits.includes('left')) {
      for (const [x, y] of coords) if (x === minX) ctx.fillRect(originX + x * pitch, originY + y * pitch, thick, pitch);
    }
    if (row.top && item.traits.includes('top')) {
      for (const [x, y] of coords) if (y === minY) ctx.fillRect(originX + x * pitch, originY + y * pitch, pitch, thick);
    }
    // Trait badges on the piece's first cell.
    const icons = item.type === 'node' ? [] : item.traits.map(t => TRAITS[t].icon);
    if (icons.length) {
      const [bx, by] = [...coords].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      const iconSide = PIXEL_ICONS[icons[0]].length;
      const scale = Math.max(1, Math.floor(pitch * BOARD_RENDER.traitBadgeScale / iconSide));
      let x = originX + bx * pitch + thick;
      const y = originY + by * pitch + thick;
      for (const name of icons) {
        const icon = pixelIcon(name, scale, {ink: '--badge-ink', accent: '--badge-accent'});
        ctx.fillStyle = plate;
        ctx.fillRect(x - 1, y - 1, icon.width + 2, icon.height + 2);
        ctx.drawImage(icon, x, y);
        x += icon.width + 3;
      }
    }
  }
  board.append(layer);
}

function renderBoard() {
  const board = $('#board');
  const bay = boardOf(config);
  const inMachine = !!activeMachine(config);
  if (inMachine) editingBoard = false;
  board.style.setProperty('--cols', bay.w);
  board.classList.toggle('editing', editingBoard);
  const rows = displayRows();
  const lookup = new Map();
  rows.forEach((r, i) => r.cells.forEach(c => lookup.set(c, {r, index: i})));
  board.replaceChildren(...bay.cells.map((available, i) => {
    const found = lookup.get(i);
    const item = found ? findItem(found.r.itemId) : null;
    const row = Math.floor(i / bay.w) + 1;
    const col = i % bay.w + 1;
    const button = el('button', {
      class: 'cell' + (!available ? ' blocked' : '') + (found ? ' filled' : '') + (found?.r.instance === selectedInstance ? ' selected' : ''),
      text: editingBoard && !available ? '+' : '',
      'aria-label': `第 ${row} 行第 ${col} 列，${!available ? '不可用' : item ? itemLabel(item) : '空格'}`,
      title: found ? `${found.index + 1}. ${itemLabel(item)}（第 ${found.r.instance.split(':').pop()} 件）· ${kindName(resolveVisual(item))}` : '空格',
      onclick: () => {
        if (editingBoard) {
          if (available && config.board.cells.filter(Boolean).length === 1) {
            toast('至少保留一个可用格');
            return;
          }
          config.board.cells[i] = !available;
          invalidate();
        } else if (found) selectInstance(found.r.instance);
      },
    });
    if (!available && !editingBoard) button.tabIndex = -1;
    return button;
  }));
  const usable = bay.cells.filter(Boolean).length;
  $('#board-count').textContent = `${usable} 格`;
  $('#edit-board').hidden = inMachine;
  $('#occupancy').textContent = result?.feasible ? `${rows.reduce((s, r) => s + r.cells.length, 0)} / ${usable} USED` : 'STANDBY';
  $('#legend').replaceChildren(...rows.map((r, i) => {
    const item = findItem(r.itemId);
    return el('button', {class: 'legend-item' + (r.instance === selectedInstance ? ' active' : ''), title: kindName(resolveVisual(item)), onclick: () => selectInstance(r.instance)},
      [el('b', {text: String(i + 1)}), document.createTextNode(itemLabel(item))]);
  }));
  for (const k of AXES) {
    $(`#metric-${k}`).textContent = result?.layout ? signed(result.layout.total[k]) : '—';
    $(`[data-metric="${k}"]`).classList.toggle('target', config.target === k || (config.target === 'custom' && config.custom.primary === k));
  }
  $('#board-tools').hidden = !editingBoard;
  $('#edit-board').textContent = editingBoard ? '完成编辑' : '编辑插槽';
  $('#board-w').value = config.board.w;
  $('#board-h').value = config.board.h;
  requestAnimationFrame(renderPieces);
}

/* ---------- targets & custom bounds ---------- */

function renderControls() {
  $('#optional').checked = config.optional;
  $$('#targets button').forEach(b => b.classList.toggle('active', b.dataset.target === String(config.target)));
  const required = config.items.filter(i => i.required).reduce((s, i) => s + i.qty, 0);
  const runPool = activeMachine(config) ? optimisationConfig(config) : {...config, items: config.items.filter(i => locationOf(i) === FREE)};
  const limited = applySearchLimit(runPool, LIMITS.maxSearchQuantity);
  const overLimit = limited.count > LIMITS.maxSearchQuantity;
  $('#mode-hint').classList.toggle('error', overLimit);
  const limitNote = overLimit ? '（超出上限，请锁定排除一部分）'
    : limited.excludedRisk ? `（超过 ${LIMITS.maxSearchQuantity} 件，将自动排除 ${limited.excludedRisk} 件过载/退化模组）` : '';
  $('#mode-hint').textContent = `参与优化 ${limited.count} / ${LIMITS.maxSearchQuantity} 件${limitNote}。` + (config.optional
    ? `必选 ${required} 件；锁定排除 ${lockedCount()} 件；其余候选件可取舍。`
    : '要求全部未锁定的插入件放入；锁定件仍排除。');
  $('#custom-panel').hidden = config.target !== 'custom';
  $('#custom-error').textContent = '';
  $('#run').disabled = false;
  config.custom.bounds.forEach((b, k) => {
    for (const field of ['min', 'max']) {
      const input = $(`#custom-${field}-${k}`);
      input.value = b[field] ?? '';
      input.readOnly = !!b.match;
      input.title = b.match ? `由${MATCH_MODES[b.match].name}匹配的中间值决定` : '';
    }
    $(`#custom-bounds-${k}`).classList.toggle('matched', !!b.match);
    const center = $(`#custom-center-${k}`);
    center.value = b.match ? b.center ?? '' : '';
    center.placeholder = b.match ? '匹配值' : '';
    center.disabled = !b.match;
    center.title = b.match ? '' : '点击右侧「精确」或「模糊」后可用';
    refreshMatchButtons(k);
  });
  $('#custom-primary').value = String(config.custom.primary);
  $('#custom-secondary').value = config.custom.secondary === null ? 'none' : String(config.custom.secondary);
  $$('#custom-secondary option').forEach(o => { o.disabled = o.value === String(config.custom.primary); });
  const secondary = config.custom.secondary;
  $('#priority-note').textContent = `先最大化${METRICS[config.custom.primary]}${secondary === null ? '。' : `；相同时再最大化${METRICS[secondary]}。`}`;
  renderConstraintStatus();
}

function renderConstraintStatus() {
  const ranges = effectiveBounds(config.custom);
  const totals = result?.layout?.total;
  const show = v => (Number.isFinite(v) ? fmt(v) : '不限');
  for (const k of AXES) $(`#custom-effective-${k}`).textContent = `实际范围：${show(ranges[k].min)} ～ ${show(ranges[k].max)}`;
  const host = $('#constraint-result');
  host.replaceChildren();
  if (config.target !== 'custom') return;
  if (config.custom.bounds.every(b => b.min === null && b.max === null)) host.append(el('p', {class: 'hint', text: '当前未设置范围限制，仅按首要、次要优先属性优化。'}));
  if (totals) {
    host.append(el('div', {class: 'constraint-checks'}, METRICS.map((m, k) => {
      const b = ranges[k];
      const ok = totals[k] >= b.min - EPSILON && totals[k] <= b.max + EPSILON;
      const limited = Number.isFinite(b.min) || Number.isFinite(b.max);
      return el('span', {class: ok ? 'constraint-ok' : 'negative', text: `${m} ${fmt(totals[k])} · ${limited ? (ok ? '达标' : '超出范围') : '未限制'}`});
    })));
  }
}

function buildCustomEditor() {
  const host = $('#constraint-inputs');
  const numberInput = (id, label, extra = {}) => el('input', {id, type: 'number', step: 'any', min: -LIMITS.maxAbsBound, max: LIMITS.maxAbsBound,
    placeholder: '不限', 'aria-label': label, ...extra});
  for (const k of AXES) {
    const min = numberInput(`custom-min-${k}`, `${METRICS[k]}下界`, {onchange: commitCustomInputs, oninput: () => refreshMatchButtons(k)});
    const max = numberInput(`custom-max-${k}`, `${METRICS[k]}上界`, {onchange: commitCustomInputs, oninput: () => refreshMatchButtons(k)});
    // Centre value of a match mode; both bounds follow it while typing.
    const center = numberInput(`custom-center-${k}`, `${METRICS[k]}匹配值`, {class: 'match-center',
      oninput: () => syncMatchBounds(k), onchange: commitCustomInputs});
    const buttons = Object.entries(MATCH_MODES).map(([mode, m]) => el('button', {type: 'button', class: 'btn btn-small match-btn',
      'data-match': mode, 'data-axis': k, text: m.name,
      title: mode === 'exact' ? '上下界都等于中间值' : `上下界为中间值 ±${m.margin}`,
      onclick: () => toggleMatch(k, mode)}));
    host.append(el('div', {class: 'constraint-row'}, [
      el('strong', {text: METRICS[k]}),
      el('div', {id: `custom-bounds-${k}`, class: 'bounds-box'}, [min, center, max]),
      el('div', {class: 'match-buttons'}, buttons),
    ]), el('div', {id: `custom-effective-${k}`, class: 'effective-range'}));
  }
}

const parseInput = input => (input.value.trim() === '' ? null : Number(input.value));

/** Match buttons are usable with one bound, equal bounds or none — or to leave / switch an active mode. */
function refreshMatchButtons(k) {
  const active = config.custom.bounds[k].match;
  const draft = {min: parseInput($(`#custom-min-${k}`)), max: parseInput($(`#custom-max-${k}`))};
  $$(`.match-btn[data-axis="${k}"]`).forEach(b => {
    const on = b.dataset.match === active;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !!worker || (!active && !canStartMatch(draft));
  });
}

/** Live update of the read-only bounds while the centre value is typed. */
function syncMatchBounds(k) {
  const mode = config.custom.bounds[k].match;
  if (!mode) return;
  const {min, max} = boundsFromMatch(mode, parseInput($(`#custom-center-${k}`)));
  $(`#custom-min-${k}`).value = min ?? '';
  $(`#custom-max-${k}`).value = max ?? '';
}

function toggleMatch(k, mode) {
  const b = config.custom.bounds[k];
  let next;
  if (b.match === mode) {
    next = {min: b.min, max: b.max};                          // leave: keep the numbers, editable again
  } else {
    const center = b.match ? b.center : matchStartValue({min: parseInput($(`#custom-min-${k}`)), max: parseInput($(`#custom-max-${k}`))});
    next = {...boundsFromMatch(mode, center), match: mode, center};
  }
  config.custom.bounds[k] = next;
  invalidate();
  if (next.match) $(`#custom-center-${k}`).focus();
}

function readCustomInputs() {
  const secondary = $('#custom-secondary').value;
  const next = {
    primary: Number($('#custom-primary').value),
    secondary: secondary === 'none' ? null : Number(secondary),
    bounds: METRICS.map((m, k) => {
      const mode = config.custom.bounds[k].match;
      if (mode) {
        const input = $(`#custom-center-${k}`);
        if (input.validity.badInput) throw Error(`${m}匹配值必须是有效数字`);
        const center = parseInput(input);
        return {...boundsFromMatch(mode, center), match: mode, center};
      }
      const b = {};
      for (const field of ['min', 'max']) {
        const input = $(`#custom-${field}-${k}`);
        if (input.validity.badInput) throw Error(`${m}边界必须是有效数字`);
        b[field] = parseInput(input);
      }
      return b;
    }),
  };
  validate({...config, custom: next});
  return next;
}

function commitCustomInputs() {
  try {
    config.custom = readCustomInputs();
    invalidate();
  } catch (e) {
    $('#custom-error').textContent = e.message;
    $('#run').disabled = true;
  }
}

/* ---------- details ---------- */

function renderDetails() {
  const host = $('#details');
  host.replaceChildren();
  if (!result?.layout) {
    host.className = 'empty';
    const custom = config.target === 'custom';
    host.textContent = result?.done && !result.feasible
      ? (result.proven
        ? (custom ? '没有同时满足范围与放置要求的布局，可放宽范围或调整候选件。' : '无法满足必选件的放置要求，请调整数量、形状或必选设置。')
        : (custom ? '尚未找到达标布局，不代表无解。可延长搜索或放宽范围。' : '尚未找到可行布局，可延长搜索时间。'))
      : '完成一次搜索后，查看每件插入件的贡献。';
    return;
  }
  host.className = '';
  const riskyRows = result.layout.rows.filter(r => findItem(r.itemId)?.traits.some(t => RISK_TRAITS.includes(t)));
  if (riskyRows.length) {
    const names = riskyRows.map(r => {
      const item = findItem(r.itemId);
      return `${itemLabel(item)}（${item.traits.filter(t => RISK_TRAITS.includes(t)).map(t => TRAITS[t].name).join('、')}）`;
    });
    host.append(el('div', {class: 'result-warning'}, [pixelIcon('warning', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--warn-accent'}),
      el('span', {text: `本布局用到 ${riskyRows.length} 件带退化或过载的模组：${names.join('、')}。同分时已优先换用其他模组，这些是为保持分数而保留的。过载每次使用有 10% 几率损坏；退化会逐次降低正向属性。`})]));
  }
  // 退化 vs 自学习 hedge: per use, how much each axis loses and regains.
  const hedge = hedgeSummary(result.layout.rows.map(r => findItem(r.itemId)).filter(Boolean));
  if (hedge.decay.some(d => d > 0)) {
    const parts = AXES.filter(k => hedge.decay[k] > 0 || hedge.grow[k] > 0)
      .map(k => `${METRICS[k]} −${hedge.decay[k]} / +${hedge.grow[k]}`);
    host.append(el('div', {class: 'result-hedge' + (hedge.uncovered ? ' partial' : '')}, [
      pixelIcon('learning', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--tip-accent'}),
      el('span', {text: `退化对冲（每次使用，退化 / 自学习）：${parts.join('，')}。` + (hedge.uncovered
        ? `仍有 ${hedge.uncovered} 点退化未被对冲：没有可用的同属性、未满上限的自学习模组，或换上它们会降低分数。`
        : '退化已全部由自学习模组对冲。')}),
    ]));
  }
  host.append(el('div', {class: 'detail-tabs segmented'}, METRICS.map((m, k) => el('button', {text: m, class: k === detailTarget ? 'active' : '', onclick: () => { detailTarget = k; renderDetails(); }}))));
  const head = el('tr', {}, ['插入件', '初始属性', '自身小计（已取整）', '吸收收益（汇总取整）', '接收器收益', '合计'].map(t => el('th', {text: t})));
  const body = el('tbody', {}, result.layout.rows.map((r, i) => el('tr', {class: selectedInstance === r.instance ? 'highlight' : ''}, [
    el('td', {}, [el('button', {class: 'link', text: `${i + 1}. ${itemLabel(findItem(r.itemId))}`, onclick: () => selectInstance(r.instance)})]),
    ...['base', 'self', 'absorbed', 'receiver', 'total'].map(k => el('td', {text: fmt(r[k][detailTarget]), class: r[k][detailTarget] < 0 ? 'negative' : ''})),
  ])));
  host.append(el('div', {class: 'table-wrap'}, [el('table', {}, [el('thead', {}, [head]), body])]));
  const r = result.layout.rows.find(row => row.instance === selectedInstance);
  if (r) {
    const item = findItem(r.itemId);
    const bw = boardOf(config).w;
    const cells = r.cells.map(c => `(${Math.floor(c / bw) + 1},${c % bw + 1})`).join(' ');
    const linkName = l => itemLabel(findItem(itemIdOf(l.id)));
    const links = r.links.map(l => (l.kind === 'absorption'
      ? `${linkName(l)}（参与吸收的初始值 ${fmt(l.absorptionBase[detailTarget])}）`
      : l.kind === 'receiver' ? `${linkName(l)}（节点，计入接收器）` : `${linkName(l)}（无属性交互）`)).join('；') || '无';
    const mounts = [];
    if (item.traits.includes('left')) mounts.push(r.left ? '侧边挂载已触发' : '侧边挂载未触发');
    if (item.traits.includes('top')) mounts.push(r.top ? '顶部挂载已触发' : '顶部挂载未触发');
    host.append(el('div', {class: 'detail-extra paper-note'}, [
      el('strong', {text: itemLabel(item)}),
      el('div', {text: `格子坐标（行,列）：${cells}`}),
      el('div', {text: `旋转 ${r.rotation}°${r.flipped ? ' · 已镜像' : ''}${mounts.length ? ' · ' + mounts.join(' · ') : ''}`}),
      el('div', {text: `吸收：相邻模组有效初始值合计 ${fmt(r.absorptionBase[detailTarget])} × ${fmt(r.absorptionRate)}% → 向零取整 ${fmt(r.absorbed[detailTarget])}`}),
      r.receiverNodes ? el('div', {text: `接收器：基础值 × ${fmt(r.receiverRate)}%（相邻 ${r.receiverNodes} 个节点）→ 向零取整 ${fmt(r.receiver[detailTarget])}`}) : null,
      el('div', {text: '相邻：' + links}),
    ]));
  }
  const used = new Map();
  result.layout.rows.forEach(row => used.set(row.itemId, (used.get(row.itemId) || 0) + 1));
  const machineView = activeMachine(config);
  const candidates = machineView ? (({own, free}) => [...own, ...free])(machineCandidates(config)) : config.items.filter(i => locationOf(i) === FREE);
  const unused = candidates.filter(i => i.qty > (used.get(i.id) || 0)).map(i => `${itemLabel(i)} ×${i.qty - (used.get(i.id) || 0)}`);
  host.append(el('div', {class: 'unused', text: '未使用：' + (unused.join('、') || '无，全部已放入')}));
}

/* ---------- save / machine view ---------- */

/** The active machine's layout from the save, shown as a result before any optimisation. */
function currentMachineResult() {
  const machine = activeMachine(config);
  if (!machine) return null;
  const layout = machineLayout(config, machine);
  return {
    current: true, done: true, feasible: true, proven: false, visits: 0, elapsedMs: 0, upperBound: null,
    layout: evaluate(layout, config.rules),
    placements: layout.map(a => ({instance: a.instance, itemId: a.item.id, cells: a.p.cells, rotation: a.p.rotation, flipped: a.p.flipped})),
  };
}

function statLine(label, value, extra = '') {
  return el('div', {class: 'stat-line'}, [el('span', {text: label}), el('b', {text: value}), extra ? el('small', {text: extra}) : null]);
}

function renderSave() {
  const save = config.save;
  $('#save-window').hidden = !save;
  if (!save) return;
  const when = new Date(save.importedAt).toLocaleString(NUMBER_FORMAT.locale);
  $('#save-meta').textContent = save.file;
  const free = config.items.filter(i => isImported(i) && locationOf(i) === FREE).reduce((s, i) => s + i.qty, 0);
  $('#save-summary').textContent = `存档时间 ${when} · ${save.machines.length} 台可优化机器 · ${free} 件自由模组（已放入候选栏）。选择一台机器查看它的模组舱与排布。`;
  const machine = activeMachine(config);
  $('#machine-list').replaceChildren(...save.machines.map(m => {
    const count = config.items.filter(i => locationOf(i) === m.key).reduce((s, i) => s + i.qty, 0);
    const active = m.key === save.active;
    const shared = !!m.shared;
    const lock = el('button', {type: 'button', class: 'machine-lock' + (shared ? ' unlocked' : ''),
      'aria-pressed': String(shared),
      title: shared ? '已全局解锁：优化其他机器时可调用本机器的模组。点击重新锁定' : '已全局锁定：本机器的模组不会被其他机器调用。点击解锁',
      onclick: e => { e.stopPropagation(); toggleShared(m); }},
    [pixelIcon(shared ? 'unlocked' : 'locked', THUMBNAILS.lockIconScale, {ink: shared ? '--lock-open-ink' : '--lock-ink', accent: shared ? '--lock-open-accent' : '--lock-accent'}), el('span', {text: shared ? '已解锁' : '锁定'})]);
    return el('div', {class: 'machine-card' + (active ? ' active' : '') + (shared ? ' shared' : '')}, [
      el('button', {class: 'machine-tab', role: 'tab', 'aria-selected': String(active),
        title: m.guessed ? '未收录的机器类型，按标准模组舱处理' : '',
        onclick: () => selectMachine(active ? null : m.key)},
      [el('b', {text: m.name}), el('small', {text: `${m.board.cells.filter(Boolean).length} 格 · ${count} 件模组`})]),
      lock,
    ]);
  }));
  $('#leave-machine').hidden = !machine;
  $('#machine-panel').hidden = !machine;
  if (!machine) return;
  const {own, free: usable, wrongType, borrowed} = machineCandidates(config);
  const qty = list => list.reduce((s, i) => s + i.qty, 0);
  $('#machine-title').textContent = machine.name;
  const original = machine.originalStage ?? machine.stage;
  $('#machine-bay').textContent = `模组舱 ${machine.board.w}×${machine.board.h} · ${machine.board.cells.filter(Boolean).length} 格 · 扩建等级 ${machine.stage}${machine.stage > original ? `（已手动升级，存档为 ${original}）` : ''}`;
  $('#machine-hint').textContent = `可用：${machine.shared ? `本机器 ${qty(own)} 件 + ` : ''}自由模组 ${qty(usable)} 件` +
    (qty(borrowed) ? ` + 已解锁机器中的 ${qty(borrowed)} 件` : '') +
    (qty(wrongType) ? `；${qty(wrongType)} 件类型不符，不能装入本机器` : '') +
    (machine.shared ? '' : `。本机器已锁定，它的 ${qty(own)} 件模组不参与优化；点机器卡片上的锁可解锁（解锁后也可升级模组舱）。确认更改后，未被采用的本机器模组会回到自由模组。`);
  renderBayUpgrade(machine);
  // Parameters: current (from the save) and, after a search, the result.
  const current = currentMachineResult();
  const now = current?.layout.total ?? AXES.map(() => 0);
  const next = result && !result.current && result.layout ? result.layout.total : null;
  const p = machine.params || {};
  const spec = MACHINE_BAYS[machine.identifier] ?? UNKNOWN_STANDARD_MACHINE;
  const power = machine.power ?? spec.power ?? 'basic';
  const statsNow = machineStats(p, now, {power});
  const statsNext = next ? machineStats(p, next, {power}) : null;
  const change = (a, b, unit = '') => (b === null || b === undefined ? `${fmt(a)}${unit}` : `${fmt(a)}${unit} → ${fmt(b)}${unit}`);
  const ratio = r => (r ? `系数 ${fmt(1 / r)}` : '');
  const lines = [
    el('div', {class: 'stat-head', text: next ? '模组效果（当前 → 优化后）' : '模组效果（当前排布）'}),
    statLine('性能', change(now[2], next?.[2], '%'), ratio(p.performanceRatio)),
    statLine('效率', change(now[0], next?.[0], '%'), ratio(p.efficiencyRatio)),
    statLine('质量', change(now[1], next?.[1], '%'), ratio(p.qualityRatio)),
  ];
  if (statsNow.speed !== null && statsNow.speed !== undefined) lines.push(statLine('作业速度', change(statsNow.speed, statsNext?.speed), `基础 ${fmt(p.speedBase)}`));
  if (statsNow.power !== null && statsNow.power !== undefined) lines.push(statLine('所需能量', change(statsNow.power, statsNext?.power, '/天'), `基础 ${fmt(p.powerBase)}/天`));
  // Machine-specific effects, each from the game method named in its tooltip.
  const outputs = (machine.outputs ?? spec.outputs ?? []).map(id => MACHINE_OUTPUTS[id]).filter(Boolean);
  if (outputs.length) lines.push(el('div', {class: 'stat-head', text: '本机器产出效果（公式取自游戏程序，鼠标悬停查看出处）'}));
  for (const o of outputs) {
    const a = o.value(p, now);
    const b = next ? o.value(p, next) : null;
    const line = statLine(o.label, b === null || b === a ? a : `${a} → ${b}`, o.note);
    line.title = `来源：${o.source}`;
    lines.push(line);
  }
  if (machine.guessed) lines.push(el('p', {class: 'hint', text: '这台机器不在已收录列表中（可能来自模组或新版本）：按标准模组舱处理，可装类型为通用模组加上它当前已装的类型；不显示产出效果。'}));
  $('#machine-stats').replaceChildren(...lines);
  const snap = save.snapshot && save.snapshot.machine === machine.key ? save.snapshot : null;
  $('#restore-layout').hidden = !snap || !result || result.current;
  $('#snapshot-note').textContent = snap ? `已保存优化前的排布副本（${new Date(snap.takenAt).toLocaleTimeString(NUMBER_FORMAT.locale)}），确认更改后删除` : '';
}

async function toggleShared(machine) {
  if (worker) return;
  if (!machine.shared) {
    const count = config.items.filter(i => locationOf(i) === machine.key).reduce((s, i) => s + i.qty, 0);
    const ok = await askConfirm({
      title: `全局解锁「${machine.name}」`,
      message: [
        `解锁后，优化其他机器时可以调用「${machine.name}」中的 ${count} 件模组。`,
        '如果在其他机器上「确认更改」并用到了这些模组，它们会从本机器的排布中移出；你需要在游戏里把它们从本机器拆下，装到新机器上。',
        '优化完成后可以随时点同一按钮重新锁定。',
      ],
      confirmText: '解锁',
      danger: true,
    });
    if (!ok) return;
  }
  config = setMachineShared(config, machine.key, !machine.shared);
  invalidate();
  toast(machine.shared ? `已重新锁定「${machine.name}」` : `已解锁「${machine.name}」，优化其他机器时可调用其模组`);
}

/** Bay upgrade controls: only for an unlocked machine with an upgradable (standard) bay. */
function renderBayUpgrade(machine) {
  const layout = BAY_LAYOUTS[layoutIdOf(machine)];
  const stages = layout.stages.length;
  const original = machine.originalStage ?? machine.stage;
  const upgradable = stages > 1;
  $('.bay-upgrade').hidden = !upgradable;
  if (!upgradable) return;
  $('#upgrade-bay').disabled = !!worker || !machine.shared || machine.stage >= stages - 1;
  $('#downgrade-bay').disabled = !!worker || !machine.shared || machine.stage <= original;
  $('#downgrade-bay').hidden = machine.stage <= original;
  $('#bay-upgrade-note').textContent = !machine.shared ? '解锁本机器后可手动升级模组舱'
    : machine.stage >= stages - 1 ? `已是最高扩建等级 ${machine.stage}`
      : `扩建等级 ${machine.stage} → ${machine.stage + 1}：${bayBoard(layoutIdOf(machine), machine.stage + 1).cells.filter(Boolean).length} 格` +
        (machine.stage > original ? `（存档为等级 ${original}）` : '');
}

function selectMachine(key) {
  if (worker) return;
  config.save = {...config.save, active: key};
  invalidate();
}

function render() {
  renderItems();
  renderBoard();
  renderControls();
  renderDetails();
  renderLocks();
  renderSave();
}

/* ---------- item dialog: colour → official sprite → attributes ---------- */

const draftType = () => (MODULE_KINDS[draft.kind]?.type ?? 'module');
const tabOfKind = kindId => PICKER_TABS.find(t => t.kinds.includes(kindId))?.id ?? 'unofficial';

/** Readable name for a shape (any rotation / mirror); basic kinds get the small-square note. */
function shapeName(cells, kindId) {
  const key = JSON.stringify(normalize(cells));
  const found = SHAPE_NAMES.find(s => orientations(s.cells).some(o => JSON.stringify(o.cells) === key));
  const name = found?.name ?? `${cells.length}格`;
  return found?.name === '方形' && MODULE_KINDS[kindId]?.group === SMALL_SQUARE_GROUP ? `${name}（小）` : name;
}

function draftItem() {
  return {type: draftType(), kind: draft.kind, shape: draft.shape, base: AXES.map(k => Number($(`#base-${k}`).value) || 0), traits: []};
}

function renderColorTabs() {
  $('#color-tabs').replaceChildren(...PICKER_TABS.map(tab => {
    const sample = tab.kinds[0]
      ? resolveVisual({type: MODULE_KINDS[tab.kinds[0]].type, kind: tab.kinds[0], shape: kindShapes(tab.kinds[0])[0].cells, base: [0, 0, 0]})
      : resolveVisual({type: 'module', kind: UNOFFICIAL_KIND, shape: [[0, 0], [1, 0], [0, 1]], base: [0, 0, 0]});
    const active = tab.id === draft.tab;
    return el('button', {type: 'button', role: 'tab', class: `color-tab tab-${tab.id}` + (active ? ' active' : ''), 'aria-selected': String(active), title: tab.hint,
      onclick: () => selectTab(tab.id)}, [thumbnail(sample, THUMBNAILS.tab), el('span', {text: tab.label})]);
  }));
  $('#tab-hint').textContent = PICKER_TABS.find(t => t.id === draft.tab).hint;
}

function renderKindTiles() {
  const tab = PICKER_TABS.find(t => t.id === draft.tab);
  const custom = tab.id === 'unofficial';
  $('#kind-tiles').hidden = custom;
  $('#custom-shape').hidden = !custom;
  if (custom) {
    renderShapeEditor();
    return;
  }
  const current = JSON.stringify(normalize(draft.shape));
  $('#kind-tiles').replaceChildren(...tab.kinds.flatMap(kindId => kindShapes(kindId).map(({cells}) => {
    const selected = draft.kind === kindId && JSON.stringify(cells) === current;
    const visual = resolveVisual({type: MODULE_KINDS[kindId].type, kind: kindId, shape: cells, base: [0, 0, 0]});
    return el('button', {type: 'button', role: 'option', class: 'kind-tile' + (selected ? ' active' : ''), 'aria-selected': String(selected),
      title: MODULE_KINDS[kindId].description || MODULE_KINDS[kindId].name,
      onclick: () => {
        draft.kindTouched = true;
        selectKind(kindId, cells, {applyTemplate: !draft.id});
      }},
    [el('span', {class: 'tile-art'}, [thumbnail(visual, THUMBNAILS.tile)]), el('b', {text: MODULE_KINDS[kindId].name}), el('small', {text: shapeName(cells, kindId)})]);
  })));
}

function renderShapeEditor() {
  const side = LIMITS.shapeEditorSide;
  const editor = $('#shape-editor');
  editor.style.setProperty('--side', side);
  editor.replaceChildren();
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const on = draft.shape.some(c => c[0] === x && c[1] === y);
      editor.append(el('button', {type: 'button', class: 'shape-cell' + (on ? ' on' : ''), 'aria-label': `形状第${y + 1}行第${x + 1}列`, 'aria-pressed': String(on),
        onclick: () => {
          draft.shape = on ? draft.shape.filter(c => c[0] !== x || c[1] !== y) : [...draft.shape, [x, y]];
          renderShapeEditor();
          renderSelected();
        }}));
    }
  }
}

function renderSelected() {
  const visual = resolveVisual(draftItem());
  const canvas = thumbnail(visual, THUMBNAILS.preview);
  const preview = $('#shape-preview');
  preview.width = canvas.width;
  preview.height = canvas.height;
  preview.getContext('2d').drawImage(canvas, 0, 0);
  const kind = MODULE_KINDS[draft.kind];
  $('#selected-kind-name').textContent = kind
    ? `${kind.name} · ${shapeName(draft.shape, draft.kind)}`
    : `${PLACEHOLDER.name} · ${draft.shape.length} 格`;
  const info = $('#kind-info');
  if (!kind) {
    info.replaceChildren(el('p', {class: 'hint', text: PLACEHOLDER.note}));
  } else {
    info.replaceChildren(
      el('div', {class: 'kind-meta'}, [
        el('span', {class: 'pill', text: MACHINES[kind.machine].name}),
        kind.contraband ? el('span', {class: 'pill pill-red', text: '违禁品'}) : null,
        el('span', {class: 'muted', text: `模板：${kind.base.map((v, k) => `${METRICS[k]} ${signed(v)}`).join(' · ')}`}),
      ]),
      ...[kind.effect ? el('p', {class: 'kind-effect', text: `独特效果：${kind.effect}`}) : null].filter(Boolean),
    );
  }
  $('#apply-template').hidden = !kind || draftType() === 'node';
  // Nodes: the game overwrites a node's value with what it absorbs, so its own base is fixed at 0.
  const isNode = draftType() === 'node';
  AXES.forEach(k => {
    $(`#base-${k}`).disabled = isNode;
    if (isNode) $(`#base-${k}`).value = 0;
  });
  $('#base-hint').textContent = isNode
    ? '节点自身没有属性：游戏中节点的数值直接等于它从相邻模组吸收的部分。'
    : '填写游戏中显示的基础属性（不含挂载等临时加成），支持负数。';
  $('#trait-editor').hidden = isNode;
  $('#node-info').hidden = !isNode;
  $('#item-title').textContent = (draft.id ? '编辑' : '添加') + (isNode ? '节点' : '模组');
}

function selectTab(tabId) {
  draft.tab = tabId;
  if (tabId === 'unofficial') {
    draft.kind = UNOFFICIAL_KIND;
  } else if (tabOfKind(draft.kind) !== tabId) {
    const first = PICKER_TABS.find(t => t.id === tabId).kinds[0];
    selectKind(first, kindShapes(first)[0].cells, {applyTemplate: !draft.id});
    return;
  }
  renderColorTabs();
  renderKindTiles();
  renderSelected();
}

function selectKind(kindId, cells, {applyTemplate}) {
  draft.kind = kindId;
  draft.tab = tabOfKind(kindId);
  draft.shape = structuredClone(cells);
  if (applyTemplate) MODULE_KINDS[kindId].base.forEach((v, k) => { $(`#base-${k}`).value = v; });
  renderColorTabs();
  renderKindTiles();
  renderSelected();
}

function buildTraitOptions(item) {
  const option = ([id, t]) => {
    const input = el('input', {type: 'checkbox', value: id, onchange: refreshTraitLimits});
    input.checked = item?.traits.includes(id) || false;
    return el('label', {class: `trait-option trait-${id}`, title: t.note}, [
      input,
      traitChip(id),
      el('small', {text: fillRuleText(t.description, config.rules)}),
    ]);
  };
  const entries = Object.entries(TRAITS);
  $('#trait-options').replaceChildren(
    ...entries.filter(([, t]) => t.scoring).map(option),
    el('div', {class: 'trait-group-label', text: '不参与计分（数值已含在基础属性中）'}),
    ...entries.filter(([, t]) => !t.scoring).map(option),
    el('p', {id: 'trait-limit', class: 'hint'}),
  );
  refreshTraitLimits();
}

/** Disable options that would exceed the game's effect slots or combine exclusive effects. */
function refreshTraitLimits() {
  const boxes = $$('#trait-options input[type=checkbox]');
  const chosen = boxes.filter(b => b.checked).map(b => b.value);
  for (const box of boxes) {
    if (box.checked) {
      box.disabled = false;
      continue;
    }
    box.disabled = traitConflicts([...chosen, box.value]).length > 0;
  }
  const problems = traitConflicts(chosen);
  $('#trait-limit').textContent = problems.length
    ? problems.join('；') + '（旧数据可保留，建议按游戏实际修改）'
    : `已选 ${chosen.length} / ${MAX_MODULE_EFFECTS} 个词条；与已选词条冲突的选项会变灰。`;
}

function openItem(item = null, type = 'module') {
  if (worker) {
    toast('请先停止搜索再修改候选件');
    return;
  }
  const visual = item ? resolveVisual(item) : null;
  const kindId = item ? (item.kind ?? visual.kindId ?? UNOFFICIAL_KIND) : DEFAULT_KIND[type];
  const official = MODULE_KINDS[kindId];
  draft = {id: item?.id || null, kindTouched: !!item, kind: kindId, tab: tabOfKind(kindId),
    shape: structuredClone(item?.shape || kindShapes(kindId)[0].cells)};
  // Keep an official kind's art in sync with the stored shape (any rotation).
  if (official) {
    const match = kindShapes(kindId).find(s => orientations(s.cells).some(o => JSON.stringify(o.cells) === JSON.stringify(normalize(draft.shape))));
    if (match) draft.shape = structuredClone(match.cells);
  }
  $('#item-name').value = item?.name || '';
  $('#item-qty').value = item?.qty || 1;
  $('#item-required').checked = item?.required === true;
  $('#item-required').disabled = item?.locked === true;
  $('#item-locked').checked = item?.locked === true;
  const base = item?.base || official?.base || AXES.map(() => 0);
  AXES.forEach(k => { $(`#base-${k}`).value = base[k]; });
  buildTraitOptions(item);
  $('#node-info').replaceChildren(pixelIcon(NODE_EFFECT.icon, THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}),
    el('span', {text: `${NODE_EFFECT.name}：${fillRuleText(NODE_EFFECT.description, config.rules)}`}));
  $('#form-error').textContent = item?.kind === undefined && item
    ? `旧数据未记录种类，已${INFERRED_BY[visual.inferredBy] || '推断'}为「${kindName(visual)}」，保存后记录。` : '';
  $('#name-match').textContent = '';
  renderColorTabs();
  renderKindTiles();
  renderSelected();
  $('#item-dialog').showModal();
}

// Name matching: an official name or alias selects that sprite until the user picks one by hand.
$('#item-name').oninput = e => {
  const matches = matchKindsByName(e.target.value, null);
  const hint = $('#name-match');
  if (!matches.length) {
    hint.textContent = e.target.value.trim() ? '未匹配到官方名称，将作为标签保存。' : '';
    return;
  }
  const names = matches.map(id => MODULE_KINDS[id].name).join(' / ');
  if (draft.kindTouched || matches.includes(draft.kind)) {
    hint.textContent = `名称对应官方：${names}`;
    return;
  }
  selectKind(matches[0], kindShapes(matches[0])[0].cells, {applyTemplate: !draft.id});
  hint.textContent = `已按名称选中「${MODULE_KINDS[matches[0]].name}」${matches.length > 1 ? `（也可能是 ${names}）` : ''}`;
};
$('#apply-template').onclick = () => {
  const kind = MODULE_KINDS[draft.kind];
  if (kind) kind.base.forEach((v, k) => { $(`#base-${k}`).value = v; });
  renderSelected();
};
$('#shape-clear').onclick = () => {
  draft.shape = [];
  renderShapeEditor();
  renderSelected();
};
AXES.forEach(k => { $(`#base-${k}`).oninput = renderSelected; });

$('#item-form').onsubmit = e => {
  e.preventDefault();
  try {
    if (!connected(draft.shape)) throw Error('形状不能为空，并且所有格子必须共边相连');
    let next = structuredClone(config);
    const old = next.items.find(i => i.id === draft.id);
    const name = $('#item-name').value.trim();
    const type = draftType();
    const item = {
      ...(old || {}), id: draft.id || newId(), name, type, kind: draft.kind, shape: normalize(draft.shape),
      base: AXES.map(k => Number($(`#base-${k}`).value)), qty: Number($('#item-qty').value),
      required: $('#item-required').checked, locked: old?.locked === true,
      traits: type === 'node' ? [] : $$('#trait-options input:checked').map(i => i.value),
    };
    if (old) next.items[next.items.indexOf(old)] = item;
    else next.items.push(item);
    validate(next);
    const desired = $('#item-locked').checked;
    next = desired !== item.locked ? transferOne(next, item.id, desired, newId()) : stackInventory(next);
    config = next;
    $('#item-dialog').close();
    invalidate();
  } catch (err) {
    $('#form-error').textContent = err.message;
  }
};

/* ---------- toolbar & dialogs ---------- */

$('#add-module').onclick = () => openItem(null, 'module');
$('#add-node').onclick = () => openItem(null, 'node');
$$('[data-close]').forEach(b => { b.onclick = () => $(`#${b.dataset.close}`).close(); });
$('#help-btn').onclick = () => $('#help-dialog').showModal();
$('#confirm-kinds').onclick = () => {
  let count = 0;
  config.items = config.items.map(item => {
    if (item.kind !== undefined) return item;
    count++;
    return {...item, kind: resolveVisual(item).kindId ?? UNOFFICIAL_KIND};
  });
  invalidate();
  toast(`已为 ${count} 个条目写入官方种类`);
};
$('#review-selection').onclick = () => {
  delete config.legacySelectionReview;
  persist();
  renderLocks();
};
$('#lock-result').onclick = () => {
  if (worker || !result?.done || !result.feasible || !result.placements.length || result.current) return;
  const machine = activeMachine(config);
  if (machine) {
    try {
      config = confirmResult(config, result.placements);
      invalidate();
      toast(`已在本工具中更新「${machine.name}」的排布（未写回存档），请回到游戏中手动摆放`);
    } catch (e) { toast(e.message); }
    return;
  }
  try {
    const count = result.placements.length;
    config = lockResultItems(config, result.placements, newId);
    invalidate();
    toast(`已锁定 ${count} 件，下次优化将排除这些插入物`);
  } catch (e) { toast(e.message); }
};
$('#unlock-all').onclick = () => {
  if (worker) return;
  config = unlockAllItems(config);
  invalidate();
  toast('已解除全部锁定，必选标记保持不变');
};

$('#edit-board').onclick = () => {
  if (worker) {
    toast('请先停止搜索再编辑插槽');
    return;
  }
  editingBoard = !editingBoard;
  renderBoard();
};
$('#resize-board').onclick = () => {
  const w = Number($('#board-w').value);
  const h = Number($('#board-h').value);
  const ok = v => Number.isInteger(v) && v >= LIMITS.boardMinSide && v <= LIMITS.boardMaxSide;
  if (!ok(w) || !ok(h)) {
    toast(`尺寸范围为 ${LIMITS.boardMinSide}–${LIMITS.boardMaxSide} 行列`);
    return;
  }
  config.board = {w, h, cells: Array(w * h).fill(true)};
  invalidate();
};
$('#reset-board').onclick = () => {
  config.board = initialBoard();
  invalidate();
};

$$('#targets button').forEach(b => {
  b.onclick = () => {
    config.target = b.dataset.target === 'custom' ? 'custom' : Number(b.dataset.target);
    detailTarget = config.target === 'custom' ? config.custom.primary : config.target;
    invalidate();
  };
});
$('#optional').onchange = e => {
  config.optional = e.target.checked;
  invalidate();
};
$('#custom-primary').onchange = () => {
  if ($('#custom-primary').value === $('#custom-secondary').value) $('#custom-secondary').value = 'none';
  commitCustomInputs();
};
$('#custom-secondary').onchange = commitCustomInputs;

function renderRulesTraits() {
  const block = ([chip, t]) => el('div', {class: 'rule-trait'}, [chip, el('p', {text: fillRuleText(t.description, config.rules)}), el('small', {text: t.note})]);
  const scoring = Object.entries(TRAITS).filter(([, t]) => t.scoring).map(([id, t]) => [traitChip(id), t]);
  const passive = Object.entries(TRAITS).filter(([, t]) => !t.scoring).map(([id, t]) => [traitChip(id), t]);
  $('#rules-traits').replaceChildren(
    el('h3', {text: '参与计分的词条'}), ...[...scoring, [nodeChip(), NODE_EFFECT]].map(block),
    el('h3', {text: '不参与计分的词条（数值已体现在基础属性中）'}), ...passive.map(block),
    el('p', {class: 'hint', text: `游戏中每个模组最多 ${MAX_MODULE_EFFECTS} 个词条；优化时分数相同则优先不用带退化或过载的模组。`}),
  );
}
function populateRules(rules) {
  for (const [k, v] of Object.entries(rules)) {
    const input = $(`#rule-${k}`);
    if (input) input.value = v;
  }
  $('#rules-error').textContent = '';
}
$('#rules-btn').onclick = () => {
  populateRules(config.rules);
  renderRulesTraits();
  $('#rules-dialog').showModal();
};
$('#reset-rules').onclick = () => populateRules(DEFAULT_RULES);
$('#save-rules').onclick = () => {
  try {
    const next = structuredClone(config);
    for (const k of RULE_PERCENT_KEYS) next.rules[k] = Number($(`#rule-${k}`).value);
    validate(next);
    config = next;
    $('#rules-dialog').close();
    fillStaticText();
    invalidate();
  } catch (e) {
    $('#rules-error').textContent = e.message;
  }
};

/* ---------- search ---------- */

/** The offline single-file build provides a bundled classic worker via OFFLINE_WORKER_URL. */
function createWorker() {
  const offline = globalThis.OFFLINE_WORKER_URL;
  return offline ? new Worker(offline) : new Worker(new URL('./core/worker.js', import.meta.url), {type: 'module'});
}

function setRunning(running) {
  $('#run').hidden = running;
  $('#stop').hidden = !running;
  $('#search-progress').hidden = !running;
  for (const sel of ['#optional', '#edit-board', '#add-module', '#add-node', '#demo-btn', '#import-btn', '#save-import-btn', '#rules-btn', '#budget', '#upgrade-bay', '#downgrade-bay', '#leave-machine', '#restore-layout']) $(sel).disabled = running;
  $$('.machine-tab').forEach(b => { b.disabled = running; });
  $$('#targets button, .item-card button, .item-card input, #custom-panel input, #custom-panel select').forEach(b => { b.disabled = running; });
  if (!running) $$('#custom-secondary option').forEach(o => { o.disabled = o.value === String(config.custom.primary); });
  // Centre boxes stay idle unless their row is in a match mode.
  if (!running) AXES.forEach(k => { $(`#custom-center-${k}`).disabled = !config.custom.bounds[k].match; refreshMatchButtons(k); });
  renderLocks();
  if (running) {
    $('#lock-result').disabled = true;
    $('#unlock-all').disabled = true;
    $('#edit-board').disabled = true;
  }
}

function showResult(r) {
  result = r;
  $('#export-result').disabled = !r.feasible;
  const custom = config.target === 'custom';
  const status = r.proven
    ? (r.feasible ? (custom ? '已证明按优先级全局最优' : '已证明全局最优') : (custom ? '已证明无达标布局' : '已证明无可行布局'))
    : (r.feasible ? (custom ? '当前最佳达标布局 · 尚未证明最优' : '当前最佳 · 尚未证明最优')
      : r.done ? (custom ? '尚未找到达标布局' : '尚未找到可行布局') : (custom ? '正在寻找达标布局' : '正在寻找可行布局'));
  $('#status').textContent = status;
  $('#status-dot').className = 'dot ' + (!r.done ? 'running' : r.proven ? 'success' : 'warn');
  $('#search-stats').textContent = `${(r.elapsedMs / 1000).toFixed(1)} s · ${fmt(r.visits)} states`;
  const bound = r.upperBound !== null && r.feasible ? ` ${custom ? METRICS[config.custom.primary] + '首要项' : ''}理论上界 ≤ ${fmt(r.upperBound)}；` : '';
  $('#result-note').textContent = r.proven
    ? (r.feasible
      ? (custom ? '已满足全部范围，并证明首要属性最大、同分时次要属性最大。' : '已穷尽所有可能改善结果的分支；当前布局在本次配置与规则下达到最高值。')
      : (custom ? '已排除全部可能达标的布局；可放宽范围、启用浮动或调整候选件。' : '已穷尽或排除全部布局；可减少候选件、修改插槽，或开启允许冗余。'))
    : `${r.done ? '本次搜索已停止。' : '搜索仍在进行，可随时停止。'}${bound} ${r.feasible
      ? (custom ? '当前布局已满足所有范围，继续搜索可能改善优先属性。' : '当前布局是可行解，延长搜索可能继续提升。')
      : '尚未找到可行解不等于无解，请尝试更长搜索时间。'}`;
  renderItems();
  renderBoard();
  renderDetails();
  renderConstraintStatus();
  renderLocks();
  renderSave();
}

$('#run').onclick = () => {
  try {
    if (config.target === 'custom') config.custom = readCustomInputs();
    validate(config);
    const machine = activeMachine(config);
    if (machine) {
      // Keep a copy of the machine's current layout until the change is confirmed or restored.
      config = takeSnapshot(config, Date.now());
      persist();
    }
    // Outside a machine view, modules installed in machines are not available.
    let runConfig = machine ? optimisationConfig(config) : {...config, items: config.items.filter(i => locationOf(i) === FREE)};
    if (!runConfig.items.some(i => !i.locked)) {
      toast(machine ? '没有可用于本机器的模组' : '请先添加至少一个模组或节点');
      return;
    }
    const limited = applySearchLimit(runConfig, LIMITS.maxSearchQuantity);
    if (limited.count > LIMITS.maxSearchQuantity) {
      toast(`参与优化的候选件有 ${limited.count} 件${limited.excludedRisk ? `（已排除 ${limited.excludedRisk} 件过载/退化模组）` : ''}，仍超过上限 ${LIMITS.maxSearchQuantity} 件。请用「锁定一个」排除一部分`);
      return;
    }
    if (limited.excludedRisk) toast(`候选超过 ${LIMITS.maxSearchQuantity} 件，已自动排除 ${limited.excludedRisk} 件过载/退化模组`);
    runConfig = limited.config;
    editingBoard = false;
    selectedInstance = null;
    result = null;
    detailTarget = config.target === 'custom' ? config.custom.primary : config.target;
    lastConfig = structuredClone(runConfig);
    started = performance.now();
    render();
    setRunning(true);
    $('#status').textContent = '正在准备搜索…';
    $('#status-dot').className = 'dot running';
    $('#result-note').textContent = '正在生成所有旋转、镜像与合法落点。';
    worker = createWorker();
    worker.onmessage = ({data}) => {
      if (data.error) {
        toast(data.error);
        $('#status').textContent = '计算失败';
        worker.terminate();
        worker = null;
        setRunning(false);
        return;
      }
      showResult(data);
      if (data.done) {
        worker.terminate();
        worker = null;
        setRunning(false);
      }
    };
    worker.onerror = e => {
      toast('计算线程加载或运行失败，请刷新页面后重试');
      $('#status').textContent = '计算失败';
      worker?.terminate();
      worker = null;
      setRunning(false);
      console.error(e);
    };
    worker.postMessage({config: structuredClone(runConfig), limitMs: Number($('#budget').value) * 1000});
  } catch (e) {
    toast(e.message);
    setRunning(false);
  }
};

$('#stop').onclick = () => {
  worker?.terminate();
  worker = null;
  setRunning(false);
  if (result) showResult({...result, done: true, proven: false, elapsedMs: performance.now() - started});
  else {
    $('#status').textContent = '已停止，尚未找到可行布局';
    $('#status-dot').className = 'dot warn';
    $('#result-note').textContent = '可以增加搜索时长后重试。';
  }
};

/* ---------- import / export ---------- */

$('#export-btn').onclick = () => {
  if (!storageProtected) {
    download(FILES.config, config);
    return;
  }
  try {
    download(FILES.originalBackup, localStorage.getItem(STORAGE_KEY) || '');
  } catch {
    toast('无法读取原存档');
  }
};
$('#export-result').onclick = () => {
  if (result?.feasible) {
    download(FILES.result, {version: SCHEMA_VERSION, config: lastConfig || config,
      result: {...result, coordinateConvention: 'cell = row * board.w + column; zero based'}});
  }
};
$('#save-import-btn').onclick = async () => {
  const current = config.items.reduce((s, i) => s + i.qty, 0);
  if (current && !await askConfirm({
    title: '导入游戏存档',
    message: [
      `导入会覆盖当前候选栏的全部 ${current} 件（包括手动添加的条目），以存档为准。`,
      '覆盖前的配置会自动备份在浏览器中；也建议先「导出配置」另存一份。',
      '存档只读取、不会被修改。',
    ],
    confirmText: '覆盖并选择存档',
  })) return;
  $('#save-file').click();
};
$('#save-file').onchange = async e => {
  const file = e.target.files[0];
  try {
    if (!file) return;
    if (file.size > MAX_SAVE_BYTES) throw Error('存档文件过大');
    const parsed = readSave(await file.text());
    try { backupBeforeSaveImport(localStorage, config); } catch { /* storage full or unavailable: the confirm already warned */ }
    config = importSave(config, parsed, {file: file.name, importedAt: file.lastModified, newId});
    editingBoard = false;
    invalidate();
    const skipped = Object.entries(parsed.skipped).map(([k, n]) => `${k} ${n} 件`).join('、');
    toast(`已读取 ${parsed.machines.length} 台机器、${parsed.free.length} 件自由模组${skipped ? `（跳过：${skipped}）` : ''}`);
  } catch (err) {
    toast('读取存档失败：' + err.message);
  } finally {
    $('#save-file').value = '';
  }
};
$('#leave-machine').onclick = () => selectMachine(null);
function changeStage(step) {
  const machine = activeMachine(config);
  if (worker || !machine) return;
  try {
    config = changeBayStage(config, machine.key, step);
    invalidate();
    const next = activeMachine(config);
    toast(`「${machine.name}」模组舱${step > 0 ? '升级' : '撤回'}为扩建等级 ${next.stage}（${next.board.cells.filter(Boolean).length} 格）。仅在本工具中生效，请在游戏中使用模组舱扩建套件`);
  } catch (e) { toast(e.message); }
}
$('#upgrade-bay').onclick = () => changeStage(1);
$('#downgrade-bay').onclick = () => changeStage(-1);
$('#restore-layout').onclick = () => {
  if (worker) return;
  config = clearSnapshot(config);
  invalidate();
  toast('已恢复为优化前的排布，副本已删除');
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const file = e.target.files[0];
  try {
    if (!file) return;
    if (file.size > LIMITS.maxImportBytes) throw Error(`配置文件不能超过 ${fmt(LIMITS.maxImportBytes / 1024 / 1024)} MB`);
    const parsed = JSON.parse(await file.text());
    config = structuredClone(stackInventory(migrateConfig(parsed.config || parsed)));
    editingBoard = false;
    fillStaticText();
    invalidate();
    toast('配置已导入');
  } catch (err) {
    toast('导入失败：' + err.message);
  } finally {
    $('#import-file').value = '';
  }
};
$('#demo-btn').onclick = async () => {
  if (config.items.length && !await askConfirm({title: '加载演示数据', message: '加载演示会替换当前配置。建议先「导出配置」备份。', confirmText: '替换为演示数据', danger: true})) return;
  config = blank();
  config.items = structuredClone(DEMO_ITEMS);
  invalidate();
  toast('已加载官方模板数值的演示数据，请替换为你的实际属性');
};

/* ---------- boot ---------- */

$('#app-version').textContent = 'v' + APP_VERSION;
fillStaticText();
buildSelects();
buildFilters();
buildCustomEditor();
drawBrand();
drawReadonlyIcon();
new ResizeObserver(() => requestAnimationFrame(renderPieces)).observe($('#board'));
result = currentMachineResult();
render();
$('#result-note').textContent = '限时搜索返回当前最佳布局；只有搜索完成后才标记为全局最优。';
