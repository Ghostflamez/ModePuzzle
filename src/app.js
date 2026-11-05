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
import {getLang, switchLang, translateDom} from './i18n/index.js';
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
import {resolveVisual, paintVisual, thumbnail, pixelIcon, kindShapes, setGameArt, gameArtActive} from './render/sprites.js';
import {checkGameArt, loadGameArt, saveGameArt, clearGameArt} from './core/game-art.js';
import {openStore, createWriteThroughStore} from './core/app-store.js';
import {tl} from './i18n/index.js';

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

/** Data store: localStorage in the browser, a file in AppData in the desktop build (see boot). */
let store = null;

function loadStoredConfig() {
  try {
    const saved = loadSavedConfig(store);
    if (saved) config = saved;
  } catch {
    storageProtected = true;
    setTimeout(() => {
      toast(tl('旧存档读取失败，原数据已保留且不会被覆盖；请先导出备份'));
      $('#save-state').textContent = tl('原存档已保护，请导出备份');
    });
  }
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

/** Machine name in the UI language: a game name saved in the other language is translated
 * (keeping any " #2" suffix); player-chosen names have no translation and stay as they are. */
const machineName = m => String(m.name).replace(/^(.*?)( #\d+)?$/, (_, base, n = '') => tl(base) + n);
const kindName = visual => (visual.kindId ? MODULE_KINDS[visual.kindId].name : PLACEHOLDER.name);
/** Official name (or the item's own name when it has no official kind). */
const itemTitle = item => displayName(item, resolveVisual(item).kindId);
/** The user's entered name, shown as an extra tag unless it only repeats the official name. */
const itemTag = item => nameTag(item, resolveVisual(item).kindId);
const itemLabel = item => (itemTag(item) ? tl('{0}「{1}」', itemTitle(item), itemTag(item)) : itemTitle(item));
const itemIdOf = instance => instance.slice(0, instance.lastIndexOf(':'));
const INFERRED_BY = {name: tl('按名称推断'), shape: tl('按形状与属性推断')};
const lockedCount = () => config.items.filter(i => i.locked).reduce((n, i) => n + i.qty, 0);
const displayRows = () => result?.layout?.rows || [];
const findItem = id => config.items.find(i => i.id === id);

/* ---------- static text from config ---------- */

function fillStaticText() {
  const rules = config.rules;
  $$('[data-rule]').forEach(n => { n.textContent = rules[n.dataset.rule]; });
  const usable = DEFAULT_BOARD.w * DEFAULT_BOARD.h - DEFAULT_BOARD.blocked.length;
  $$('[data-board-default]').forEach(n => { n.textContent = tl('{0} 列 × {1} 行、四角不可用，共 {2} 格', DEFAULT_BOARD.w, DEFAULT_BOARD.h, usable); });
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
  $('#custom-secondary').replaceChildren(el('option', {value: 'none', text: tl('不设置')}), ...METRICS.map((m, k) => el('option', {value: k, text: m})));
  $$('#targets [data-target]').forEach(b => { if (b.dataset.target !== 'custom') b.textContent = METRICS[Number(b.dataset.target)]; });
}

/**
 * Styled replacement for window.confirm(). `message` may be a string or an array of
 * paragraphs. Resolves true only when the confirm button is pressed.
 */
function askConfirm({title, message, confirmText = tl('确认'), danger = false}) {
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
    if (storageProtected) throw Error(tl('旧存档受保护'));
    if (!store || store.volatile) throw Error(tl('存储不可用'));
    saveConfig(store, config);
    $('#save-state').textContent = globalThis.MODEPUZZLE_DESKTOP ? tl('已自动保存到本机') : tl('已自动保存到此浏览器');
  } catch {
    $('#save-state').textContent = tl('自动保存不可用，请导出配置');
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
  $('#status').textContent = result ? tl('本机器当前排布') : tl('配置已更新，等待计算');
  $('#status-dot').className = 'dot';
  $('#search-stats').textContent = '';
  $('#result-note').textContent = config.target === 'custom'
    ? tl('仅显示满足所有范围的布局；搜索完成后才确认按优先级达到最优。')
    : tl('限时搜索返回当前最佳布局；只有搜索完成后才标记为全局最优。');
  $('#export-result').disabled = true;
  persist();
  render();
}

/* ---------- trait chips ---------- */

function traitChip(id, {compact = false} = {}) {
  const t = TRAITS[id];
  const title = tl('{0}：{1}\n{2}', t.name, fillRuleText(t.description, config.rules), t.note);
  const kind = t.scoring ? '' : t.risk ? ' trait-risk' : ' trait-passive';
  return el('span', {class: `trait-chip trait-${id}${kind}${compact ? ' compact' : ''}`, title},
    [pixelIcon(t.icon, THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), compact ? null : el('b', {text: t.name})]);
}
function nodeChip() {
  return el('span', {class: 'trait-chip trait-node', title: tl('{0}：{1}\n{2}', NODE_EFFECT.name, fillRuleText(NODE_EFFECT.description, config.rules), NODE_EFFECT.note)},
    [pixelIcon(NODE_EFFECT.icon, THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), el('b', {text: NODE_EFFECT.name})]);
}

/* ---------- inventory ---------- */

function renderLocks() {
  const done = !!result?.done && !!result?.feasible && !!result?.placements?.length && !result.current;
  const machine = activeMachine(config);
  $('#lock-result').hidden = !done;
  $('#lock-result').disabled = !!worker;
  $('#lock-result').textContent = machine ? tl('确认更改') : tl('锁定本次布局中的所有插入物');
  $('#lock-result').title = machine ? tl('把这个排布写入「{0}」：用到的模组移入本机器，未用到的本机器模组回到自由模组，并删除排布副本', machineName(machine)) : '';
  $('#unlock-all').hidden = !lockedCount();
  $('#unlock-all').disabled = !!worker;
  $('#lock-note').textContent = machine
    ? tl('「确认更改」只更新本工具中的数据，不会写回游戏存档；请在游戏中手动按此排布摆放。')
    : tl('已锁定排除 {0} 件。锁定件不参与优化；必选件必须用到。批量锁定只排除本次结果实际用到的数量。', lockedCount());
  $('#lock-note').classList.toggle('readonly-note', !!machine);
  $('#edit-board').disabled = !!worker;
  $('#legacy-selection-note').hidden = !config.legacySelectionReview;
}

function itemCard(item, selected) {
  const visual = resolveVisual(item);
  const pinned = item.required === true && item.locked !== true;
  const card = el('article', {class: 'item-card' + (selected ? ' selected-card' : '') + (item.locked ? ' locked-card' : '') + (pinned ? ' required-pin-card' : ''), 'data-item-id': item.id});
  if (pinned) card.append(el('div', {class: 'pin-badge'}, [tl('★ 必选 · 置顶')]));
  if (selected) {
    const rows = displayRows();
    card.append(el('div', {class: 'selected-badge', text: tl('已选中 · 图注 {0} 号 · 第 {1} 件', rows.indexOf(selected) + 1, selected.instance.split(':').pop())}));
  }
  const tag = itemTag(item);
  const kindLabel = el('span', {class: 'kind-label' + (visual.official ? '' : ' unofficial')}, [
    tag ? el('span', {class: 'name-tag', text: tag, title: [tl('输入的名称'), ...(item.aliases || [])].join(' / ')}) : null,
    visual.official ? null : document.createTextNode(PLACEHOLDER.name),
    visual.inferred ? el('em', {text: visual.inferredBy === 'name' ? tl('名称匹配') : tl('推断'), title: tl('旧数据未记录官方种类，{0}', INFERRED_BY[visual.inferredBy] || tl('无法推断'))}) : null,
  ]);
  const kind = visual.kindId ? MODULE_KINDS[visual.kindId] : null;
  const head = el('div', {class: 'item-top'}, [
    el('div', {class: 'slot-thumb', title: visual.official ? kindName(visual) : PLACEHOLDER.note}, [thumbnail(visual, THUMBNAILS.card)]),
    el('div', {class: 'item-info'}, [
      el('div', {class: 'item-name', text: itemTitle(item), title: [item.name, ...(item.aliases || [])].filter(Boolean).join(' / ')}),
      kindLabel,
      el('small', {text: `${shapeName(item.shape, visual.kindId)} · ×${item.qty}${kind && kind.machine !== 'system' ? ' · ' + tl('{0}专用', MACHINES[kind.machine].name) : ''}`}),
    ]),
    el('div', {class: 'item-actions'}, [
      el('button', {class: 'btn btn-small', text: tl('编辑'), title: tl('编辑 ') + itemLabel(item), onclick: () => openItem(item)}),
      el('button', {class: 'btn btn-small btn-red', text: '×', title: tl('删除 ') + itemLabel(item), onclick: () => {
        config.items = config.items.filter(i => i.id !== item.id);
        invalidate();
      }}),
    ]),
  ]);
  card.append(head);
  card.append(el('div', {class: 'item-values'}, item.base.map((v, k) => el('span', {}, [METRICS[k], el('b', {text: signed(v), class: v < 0 ? 'negative' : v > 0 ? 'positive' : ''})]))));
  const traits = item.type === 'node' ? [nodeChip()] : item.traits.map(t => traitChip(t));
  if (kind?.contraband) traits.push(el('span', {class: 'trait-chip trait-contraband', title: tl('游戏中属于违禁品')}, [pixelIcon('contraband', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--chip-accent'}), el('b', {text: tl('违禁品')})]));
  if (kind?.effect) traits.push(el('span', {class: 'trait-chip trait-effect', title: kind.description || '', text: kind.effect}));
  if (traits.length) card.append(el('div', {class: 'traits'}, traits));
  const machine = activeMachine(config);
  const own = machine && locationOf(item) === machine.key;
  if (own) {
    const state = !machine.shared ? tl(' · 本机器已锁定，优化时排除') : item.locked ? tl(' · 已单独锁定，优化时排除') : tl(' · 可重新排布');
    card.append(el('div', {class: 'card-note own', text: tl('装在「{0}」中{1}', machineName(machine), state)}));
  }
  const home = config.save?.machines.find(m => m.key === locationOf(item));
  if (machine && home && !own) card.append(el('div', {class: 'card-note borrowed', text: tl('装在「{0}」中 · 已解锁，可被调用', home.name)}));
  if (machine && !own && item.type !== 'node' && !machine.accepts.includes(moduleTypeOf(item))) {
    card.classList.add('unusable-card');
    card.append(el('div', {class: 'card-warning soft', text: tl('「{0}」不能安装这种模组', machineName(machine))}));
  }
  for (const t of item.traits.filter(id => TRAITS[id]?.risk)) {
    card.append(el('div', {class: 'card-warning', title: TRAITS[t].note}, [pixelIcon('warning', 1, {ink: '--chip-ink', accent: '--warn-accent'}), tl('{0}：{1}', TRAITS[t].name, TRAITS[t].warning)]));
  }
  for (const problem of traitConflicts(item.traits)) card.append(el('div', {class: 'card-warning soft', text: problem}));
  const lockAction = el('button', {
    class: 'btn btn-small' + (item.locked ? ' btn-orange' : ''), text: item.locked ? tl('解锁一个') : tl('锁定一个'),
    'aria-label': tl('{0}：{1}', itemLabel(item), item.locked ? tl('解锁一个') : tl('锁定一个')),
    onclick: () => {
      if (worker) return;
      try {
        config = transferOne(config, item.id, !item.locked, newId());
        invalidate();
        toast(item.locked ? tl('已解锁一件，可重新参与优化') : tl('已锁定一件，优化时将排除'));
      } catch (e) { toast(e.message); }
    },
  });
  const must = el('input', {type: 'checkbox', class: 'required-check', 'aria-label': tl('{0}：必选全部 {1} 件', itemLabel(item), item.qty),
    onchange: e => { item.required = e.target.checked; invalidate(); }});
  must.checked = item.required === true;
  must.disabled = item.locked === true;
  card.append(el('div', {class: 'inventory-lock-row'}, [
    el('label', {class: 'check'}, [must, tl('必选 · 全部 {0} 件{1}', item.qty, item.locked ? tl('（请先解锁）') : '')]),
    item.locked ? el('span', {class: 'locked-tag'}, [pixelIcon('locked', 1, {ink: '--chip-ink', accent: '--chip-accent'}), tl('已锁定')]) : null,
    lockAction,
  ]));
  if (worker) card.querySelectorAll('button,input').forEach(b => { b.disabled = true; });
  return card;
}

const FILTER_STATES = Object.freeze([
  {id: 'all', label: tl('全部状态')},
  {id: 'required', label: tl('必选'), test: item => item.required === true},
  {id: 'locked', label: tl('已锁定'), test: item => item.locked === true},
  {id: 'free', label: tl('未锁定'), test: item => item.locked !== true},
  {id: 'inferred', label: tl('待确认种类'), test: item => item.kind === undefined},
  {id: 'placeholder', label: tl('非官方样式'), test: item => !resolveVisual(item).official},
  {id: 'risk', label: tl('退化 / 过载'), test: item => item.traits.some(t => RISK_TRAITS.includes(t))},
  {id: 'evolving', label: tl('自学习（数值会变）'), test: item => item.traits.some(t => TRAITS[t]?.evolving)},
  {id: 'used', label: tl('本次布局已用'), test: item => displayRows().some(r => r.itemId === item.id)},
]);
const PLACEHOLDER_GROUP = 'placeholder';

function buildFilters() {
  const option = (value, text) => el('option', {value, text});
  $('#filter-group').replaceChildren(option('all', tl('全部分类')), ...KIND_GROUPS.map(g => option(g.id, g.name)), option(PLACEHOLDER_GROUP, PLACEHOLDER.name));
  $('#filter-trait').replaceChildren(option('all', tl('全部词条')), ...Object.entries(TRAITS).map(([id, t]) => option(id, t.name)), option('none', tl('无词条')));
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

function renderItems() {
  const machine = activeMachine(config);
  const inView = item => (machine
    ? isImported(item) && (locationOf(item) === FREE || locationOf(item) === machine.key || isShared(config, locationOf(item)))
    : locationOf(item) === FREE);
  const pool = config.items.filter(inView);
  const hidden = config.items.filter(i => !inView(i)).reduce((s, i) => s + i.qty, 0);
  const total = pool.reduce((s, i) => s + i.qty, 0);
  $('#inventory-count').textContent = tl('{0} 件', total);
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
  const hiddenNote = hidden ? tl('；{0} {1} 件未显示', machine ? tl('其他机器中与手动添加的') : tl('装在机器中的'), hidden) : '';
  $('#filter-count').textContent = (active ? tl('显示 {0} / 共 {1} 条', visible.length, pool.length) : tl('共 {0} 条', pool.length)) + hiddenNote;
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
      'aria-label': tl('第 {0} 行第 {1} 列，{2}', row, col, !available ? tl('不可用') : item ? itemLabel(item) : tl('空格')),
      title: found ? tl('{0}. {1}（第 {2} 件）· {3}', found.index + 1, itemLabel(item), found.r.instance.split(':').pop(), kindName(resolveVisual(item))) : tl('空格'),
      onclick: () => {
        if (editingBoard) {
          if (available && config.board.cells.filter(Boolean).length === 1) {
            toast(tl('至少保留一个可用格'));
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
  $('#board-count').textContent = tl('{0} 格', usable);
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
  $('#edit-board').textContent = editingBoard ? tl('完成编辑') : tl('编辑插槽');
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
  const limitNote = overLimit ? tl('（超出上限，请锁定排除一部分）')
    : limited.excludedRisk ? tl('（超过 {0} 件，将自动排除 {1} 件过载/退化模组）', LIMITS.maxSearchQuantity, limited.excludedRisk) : '';
  $('#mode-hint').textContent = tl('参与优化 {0} / {1} 件{2}。', limited.count, LIMITS.maxSearchQuantity, limitNote) + (config.optional
    ? tl('必选 {0} 件；锁定排除 {1} 件；其余候选件可取舍。', required, lockedCount())
    : tl('要求全部未锁定的插入件放入；锁定件仍排除。'));
  $('#custom-panel').hidden = config.target !== 'custom';
  $('#custom-error').textContent = '';
  $('#run').disabled = false;
  config.custom.bounds.forEach((b, k) => {
    for (const field of ['min', 'max']) {
      const input = $(`#custom-${field}-${k}`);
      input.value = b[field] ?? '';
      input.readOnly = !!b.match;
      input.title = b.match ? tl('由{0}匹配的中间值决定', MATCH_MODES[b.match].name) : '';
    }
    $(`#custom-bounds-${k}`).classList.toggle('matched', !!b.match);
    const center = $(`#custom-center-${k}`);
    center.value = b.match ? b.center ?? '' : '';
    center.placeholder = b.match ? tl('匹配值') : '';
    center.disabled = !b.match;
    center.title = b.match ? '' : tl('点击右侧「精确」或「模糊」后可用');
    refreshMatchButtons(k);
  });
  $('#custom-primary').value = String(config.custom.primary);
  $('#custom-secondary').value = config.custom.secondary === null ? 'none' : String(config.custom.secondary);
  $$('#custom-secondary option').forEach(o => { o.disabled = o.value === String(config.custom.primary); });
  const secondary = config.custom.secondary;
  $('#priority-note').textContent = tl('先最大化{0}{1}', METRICS[config.custom.primary], secondary === null ? tl('。') : tl('；相同时再最大化{0}。', METRICS[secondary]));
  renderConstraintStatus();
}

function renderConstraintStatus() {
  const ranges = effectiveBounds(config.custom);
  const totals = result?.layout?.total;
  const show = v => (Number.isFinite(v) ? fmt(v) : tl('不限'));
  for (const k of AXES) $(`#custom-effective-${k}`).textContent = tl('实际范围：{0} ～ {1}', show(ranges[k].min), show(ranges[k].max));
  const host = $('#constraint-result');
  host.replaceChildren();
  if (config.target !== 'custom') return;
  if (config.custom.bounds.every(b => b.min === null && b.max === null)) host.append(el('p', {class: 'hint', text: tl('当前未设置范围限制，仅按首要、次要优先属性优化。')}));
  if (totals) {
    host.append(el('div', {class: 'constraint-checks'}, METRICS.map((m, k) => {
      const b = ranges[k];
      const ok = totals[k] >= b.min - EPSILON && totals[k] <= b.max + EPSILON;
      const limited = Number.isFinite(b.min) || Number.isFinite(b.max);
      return el('span', {class: ok ? 'constraint-ok' : 'negative', text: `${m} ${fmt(totals[k])} · ${limited ? (ok ? tl('达标') : tl('超出范围')) : tl('未限制')}`});
    })));
  }
}

function buildCustomEditor() {
  const host = $('#constraint-inputs');
  const numberInput = (id, label, extra = {}) => el('input', {id, type: 'number', step: 'any', min: -LIMITS.maxAbsBound, max: LIMITS.maxAbsBound,
    placeholder: tl('不限'), 'aria-label': label, ...extra});
  for (const k of AXES) {
    const min = numberInput(`custom-min-${k}`, tl('{0}下界', METRICS[k]), {onchange: commitCustomInputs, oninput: () => refreshMatchButtons(k)});
    const max = numberInput(`custom-max-${k}`, tl('{0}上界', METRICS[k]), {onchange: commitCustomInputs, oninput: () => refreshMatchButtons(k)});
    // Centre value of a match mode; both bounds follow it while typing.
    const center = numberInput(`custom-center-${k}`, tl('{0}匹配值', METRICS[k]), {class: 'match-center',
      oninput: () => syncMatchBounds(k), onchange: commitCustomInputs});
    const buttons = Object.entries(MATCH_MODES).map(([mode, m]) => el('button', {type: 'button', class: 'btn btn-small match-btn',
      'data-match': mode, 'data-axis': k, text: m.name,
      title: mode === 'exact' ? tl('上下界都等于中间值') : tl('上下界为中间值 ±{0}', m.margin),
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
        if (input.validity.badInput) throw Error(tl('{0}匹配值必须是有效数字', m));
        const center = parseInput(input);
        return {...boundsFromMatch(mode, center), match: mode, center};
      }
      const b = {};
      for (const field of ['min', 'max']) {
        const input = $(`#custom-${field}-${k}`);
        if (input.validity.badInput) throw Error(tl('{0}边界必须是有效数字', m));
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
        ? (custom ? tl('没有同时满足范围与放置要求的布局，可放宽范围或调整候选件。') : tl('无法满足必选件的放置要求，请调整数量、形状或必选设置。'))
        : (custom ? tl('尚未找到达标布局，不代表无解。可延长搜索或放宽范围。') : tl('尚未找到可行布局，可延长搜索时间。')))
      : tl('完成一次搜索后，查看每件插入件的贡献。');
    return;
  }
  host.className = '';
  const riskyRows = result.layout.rows.filter(r => findItem(r.itemId)?.traits.some(t => RISK_TRAITS.includes(t)));
  if (riskyRows.length) {
    const names = riskyRows.map(r => {
      const item = findItem(r.itemId);
      return tl('{0}（{1}）', itemLabel(item), item.traits.filter(t => RISK_TRAITS.includes(t)).map(t => TRAITS[t].name).join(tl('、')));
    });
    host.append(el('div', {class: 'result-warning'}, [pixelIcon('warning', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--warn-accent'}),
      el('span', {text: tl('本布局用到 {0} 件带退化或过载的模组：{1}。同分时已优先换用其他模组，这些是为保持分数而保留的。过载每次使用有 10% 几率损坏；退化会逐次降低正向属性。', riskyRows.length, names.join(tl('、')))})]));
  }
  // 退化 vs 自学习 hedge: per use, how much each axis loses and regains.
  const hedge = hedgeSummary(result.layout.rows.map(r => findItem(r.itemId)).filter(Boolean));
  if (hedge.decay.some(d => d > 0)) {
    const parts = AXES.filter(k => hedge.decay[k] > 0 || hedge.grow[k] > 0)
      .map(k => `${METRICS[k]} −${hedge.decay[k]} / +${hedge.grow[k]}`);
    host.append(el('div', {class: 'result-hedge' + (hedge.uncovered ? ' partial' : '')}, [
      pixelIcon('learning', THUMBNAILS.traitIconScale, {ink: '--chip-ink', accent: '--tip-accent'}),
      el('span', {text: tl('退化对冲（每次使用，退化 / 自学习）：{0}。', parts.join(tl('，'))) + (hedge.uncovered
        ? tl('仍有 {0} 点退化未被对冲：没有可用的同属性、未满上限的自学习模组，或换上它们会降低分数。', hedge.uncovered)
        : tl('退化已全部由自学习模组对冲。'))}),
    ]));
  }
  host.append(el('div', {class: 'detail-tabs segmented'}, METRICS.map((m, k) => el('button', {text: m, class: k === detailTarget ? 'active' : '', onclick: () => { detailTarget = k; renderDetails(); }}))));
  const head = el('tr', {}, [tl('插入件'), tl('初始属性'), tl('自身小计（已取整）'), tl('吸收收益（汇总取整）'), tl('接收器收益'), tl('合计')].map(t => el('th', {text: t})));
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
      ? tl('{0}（参与吸收的初始值 {1}）', linkName(l), fmt(l.absorptionBase[detailTarget]))
      : l.kind === 'receiver' ? tl('{0}（节点，计入接收器）', linkName(l)) : tl('{0}（无属性交互）', linkName(l)))).join(tl('；')) || tl('无');
    const mounts = [];
    if (item.traits.includes('left')) mounts.push(r.left ? tl('侧边挂载已触发') : tl('侧边挂载未触发'));
    if (item.traits.includes('top')) mounts.push(r.top ? tl('顶部挂载已触发') : tl('顶部挂载未触发'));
    host.append(el('div', {class: 'detail-extra paper-note'}, [
      el('strong', {text: itemLabel(item)}),
      el('div', {text: tl('格子坐标（行,列）：{0}', cells)}),
      el('div', {text: tl('旋转 {0}°{1}{2}', r.rotation, r.flipped ? tl(' · 已镜像') : '', mounts.length ? ' · ' + mounts.join(' · ') : '')}),
      el('div', {text: tl('吸收：相邻模组有效初始值合计 {0} × {1}% → 向零取整 {2}', fmt(r.absorptionBase[detailTarget]), fmt(r.absorptionRate), fmt(r.absorbed[detailTarget]))}),
      r.receiverNodes ? el('div', {text: tl('接收器：基础值 × {0}%（相邻 {1} 个节点）→ 向零取整 {2}', fmt(r.receiverRate), r.receiverNodes, fmt(r.receiver[detailTarget]))}) : null,
      el('div', {text: tl('相邻：') + links}),
    ]));
  }
  const used = new Map();
  result.layout.rows.forEach(row => used.set(row.itemId, (used.get(row.itemId) || 0) + 1));
  const machineView = activeMachine(config);
  const candidates = machineView ? (({own, free}) => [...own, ...free])(machineCandidates(config)) : config.items.filter(i => locationOf(i) === FREE);
  const unused = candidates.filter(i => i.qty > (used.get(i.id) || 0)).map(i => `${itemLabel(i)} ×${i.qty - (used.get(i.id) || 0)}`);
  host.append(el('div', {class: 'unused', text: tl('未使用：') + (unused.join(tl('、')) || tl('无，全部已放入'))}));
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
  $('#save-summary').textContent = tl('存档时间 {0} · {1} 台可优化机器 · {2} 件自由模组（已放入候选栏）。选择一台机器查看它的模组舱与排布。', when, save.machines.length, free);
  const machine = activeMachine(config);
  $('#machine-list').replaceChildren(...save.machines.map(m => {
    const count = config.items.filter(i => locationOf(i) === m.key).reduce((s, i) => s + i.qty, 0);
    const active = m.key === save.active;
    const shared = !!m.shared;
    const lock = el('button', {type: 'button', class: 'machine-lock' + (shared ? ' unlocked' : ''),
      'aria-pressed': String(shared),
      title: shared ? tl('已全局解锁：优化其他机器时可调用本机器的模组。点击重新锁定') : tl('已全局锁定：本机器的模组不会被其他机器调用。点击解锁'),
      onclick: e => { e.stopPropagation(); toggleShared(m); }},
    [pixelIcon(shared ? 'unlocked' : 'locked', THUMBNAILS.lockIconScale, {ink: shared ? '--lock-open-ink' : '--lock-ink', accent: shared ? '--lock-open-accent' : '--lock-accent'}), el('span', {text: shared ? tl('已解锁') : tl('锁定')})]);
    return el('div', {class: 'machine-card' + (active ? ' active' : '') + (shared ? ' shared' : '')}, [
      el('button', {class: 'machine-tab', role: 'tab', 'aria-selected': String(active),
        title: m.guessed ? tl('未收录的机器类型，按标准模组舱处理') : '',
        onclick: () => selectMachine(active ? null : m.key)},
      [el('b', {text: machineName(m)}), el('small', {text: tl('{0} 格 · {1} 件模组', m.board.cells.filter(Boolean).length, count)})]),
      lock,
    ]);
  }));
  $('#leave-machine').hidden = !machine;
  $('#machine-panel').hidden = !machine;
  if (!machine) return;
  const {own, free: usable, wrongType, borrowed} = machineCandidates(config);
  const qty = list => list.reduce((s, i) => s + i.qty, 0);
  $('#machine-title').textContent = machineName(machine);
  const original = machine.originalStage ?? machine.stage;
  $('#machine-bay').textContent = tl('模组舱 {0}×{1} · {2} 格 · 扩建等级 {3}{4}', machine.board.w, machine.board.h, machine.board.cells.filter(Boolean).length, machine.stage, machine.stage > original ? tl('（已手动升级，存档为 {0}）', original) : '');
  $('#machine-hint').textContent = tl('可用：{0}自由模组 {1} 件', machine.shared ? tl('本机器 {0} 件 + ', qty(own)) : '', qty(usable)) +
    (qty(borrowed) ? tl(' + 已解锁机器中的 {0} 件', qty(borrowed)) : '') +
    (qty(wrongType) ? tl('；{0} 件类型不符，不能装入本机器', qty(wrongType)) : '') +
    (machine.shared ? '' : tl('。本机器已锁定，它的 {0} 件模组不参与优化；点机器卡片上的锁可解锁（解锁后也可升级模组舱）。确认更改后，未被采用的本机器模组会回到自由模组。', qty(own)));
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
  const ratio = r => (r ? tl('系数 {0}', fmt(1 / r)) : '');
  const lines = [
    el('div', {class: 'stat-head', text: next ? tl('模组效果（当前 → 优化后）') : tl('模组效果（当前排布）')}),
    statLine(tl('性能'), change(now[2], next?.[2], '%'), ratio(p.performanceRatio)),
    statLine(tl('效率'), change(now[0], next?.[0], '%'), ratio(p.efficiencyRatio)),
    statLine(tl('质量'), change(now[1], next?.[1], '%'), ratio(p.qualityRatio)),
  ];
  if (statsNow.speed !== null && statsNow.speed !== undefined) lines.push(statLine(tl('作业速度'), change(statsNow.speed, statsNext?.speed), tl('基础 {0}', fmt(p.speedBase))));
  if (statsNow.power !== null && statsNow.power !== undefined) lines.push(statLine(tl('所需能量'), change(statsNow.power, statsNext?.power, tl('/天')), tl('基础 {0}/天', fmt(p.powerBase))));
  // Machine-specific effects, each from the game method named in its tooltip.
  const outputs = (machine.outputs ?? spec.outputs ?? []).map(id => MACHINE_OUTPUTS[id]).filter(Boolean);
  if (outputs.length) lines.push(el('div', {class: 'stat-head', text: tl('本机器产出效果（公式取自游戏程序，鼠标悬停查看出处）')}));
  for (const o of outputs) {
    const a = o.value(p, now);
    const b = next ? o.value(p, next) : null;
    const line = statLine(o.label, b === null || b === a ? a : `${a} → ${b}`, o.note);
    line.title = tl('来源：{0}', o.source);
    lines.push(line);
  }
  if (machine.guessed) lines.push(el('p', {class: 'hint', text: tl('这台机器不在已收录列表中（可能来自模组或新版本）：按标准模组舱处理，可装类型为通用模组加上它当前已装的类型；不显示产出效果。')}));
  $('#machine-stats').replaceChildren(...lines);
  const snap = save.snapshot && save.snapshot.machine === machine.key ? save.snapshot : null;
  $('#restore-layout').hidden = !snap || !result || result.current;
  $('#snapshot-note').textContent = snap ? tl('已保存优化前的排布副本（{0}），确认更改后删除', new Date(snap.takenAt).toLocaleTimeString(NUMBER_FORMAT.locale)) : '';
}

async function toggleShared(machine) {
  if (worker) return;
  if (!machine.shared) {
    const count = config.items.filter(i => locationOf(i) === machine.key).reduce((s, i) => s + i.qty, 0);
    const ok = await askConfirm({
      title: tl('全局解锁「{0}」', machineName(machine)),
      message: [
        tl('解锁后，优化其他机器时可以调用「{0}」中的 {1} 件模组。', machineName(machine), count),
        tl('如果在其他机器上「确认更改」并用到了这些模组，它们会从本机器的排布中移出；你需要在游戏里把它们从本机器拆下，装到新机器上。'),
        tl('优化完成后可以随时点同一按钮重新锁定。'),
      ],
      confirmText: tl('解锁'),
      danger: true,
    });
    if (!ok) return;
  }
  config = setMachineShared(config, machine.key, !machine.shared);
  invalidate();
  toast(machine.shared ? tl('已重新锁定「{0}」', machineName(machine)) : tl('已解锁「{0}」，优化其他机器时可调用其模组', machineName(machine)));
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
  $('#bay-upgrade-note').textContent = !machine.shared ? tl('解锁本机器后可手动升级模组舱')
    : machine.stage >= stages - 1 ? tl('已是最高扩建等级 {0}', machine.stage)
      : tl('扩建等级 {0} → {1}：{2} 格', machine.stage, machine.stage + 1, bayBoard(layoutIdOf(machine), machine.stage + 1).cells.filter(Boolean).length) +
        (machine.stage > original ? tl('（存档为等级 {0}）', original) : '');
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
  const name = found?.name ?? tl('{0}格', cells.length);
  return found?.name === tl('方形') && MODULE_KINDS[kindId]?.group === SMALL_SQUARE_GROUP ? tl('{0}（小）', name) : name;
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
      editor.append(el('button', {type: 'button', class: 'shape-cell' + (on ? ' on' : ''), 'aria-label': tl('形状第{0}行第{1}列', y + 1, x + 1), 'aria-pressed': String(on),
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
    : tl('{0} · {1} 格', PLACEHOLDER.name, draft.shape.length);
  const info = $('#kind-info');
  if (!kind) {
    info.replaceChildren(el('p', {class: 'hint', text: PLACEHOLDER.note}));
  } else {
    info.replaceChildren(
      el('div', {class: 'kind-meta'}, [
        el('span', {class: 'pill', text: MACHINES[kind.machine].name}),
        kind.contraband ? el('span', {class: 'pill pill-red', text: tl('违禁品')}) : null,
        el('span', {class: 'muted', text: tl('模板：{0}', kind.base.map((v, k) => `${METRICS[k]} ${signed(v)}`).join(' · '))}),
      ]),
      ...[kind.effect ? el('p', {class: 'kind-effect', text: tl('独特效果：{0}', kind.effect)}) : null].filter(Boolean),
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
    ? tl('节点自身没有属性：游戏中节点的数值直接等于它从相邻模组吸收的部分。')
    : tl('填写游戏中显示的基础属性（不含挂载等临时加成），支持负数。');
  $('#trait-editor').hidden = isNode;
  $('#node-info').hidden = !isNode;
  $('#item-title').textContent = draft.id ? (isNode ? tl('编辑节点') : tl('编辑模组')) : (isNode ? tl('添加节点') : tl('添加模组'));
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
    el('div', {class: 'trait-group-label', text: tl('不参与计分（数值已含在基础属性中）')}),
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
    ? problems.join(tl('；')) + tl('（旧数据可保留，建议按游戏实际修改）')
    : tl('已选 {0} / {1} 个词条；与已选词条冲突的选项会变灰。', chosen.length, MAX_MODULE_EFFECTS);
}

function openItem(item = null, type = 'module') {
  if (worker) {
    toast(tl('请先停止搜索再修改候选件'));
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
    el('span', {text: tl('{0}：{1}', NODE_EFFECT.name, fillRuleText(NODE_EFFECT.description, config.rules))}));
  $('#form-error').textContent = item?.kind === undefined && item
    ? tl('旧数据未记录种类，已{0}为「{1}」，保存后记录。', INFERRED_BY[visual.inferredBy] || tl('推断'), kindName(visual)) : '';
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
    hint.textContent = e.target.value.trim() ? tl('未匹配到官方名称，将作为标签保存。') : '';
    return;
  }
  const names = matches.map(id => MODULE_KINDS[id].name).join(' / ');
  if (draft.kindTouched || matches.includes(draft.kind)) {
    hint.textContent = tl('名称对应官方：{0}', names);
    return;
  }
  selectKind(matches[0], kindShapes(matches[0])[0].cells, {applyTemplate: !draft.id});
  hint.textContent = tl('已按名称选中「{0}」{1}', MODULE_KINDS[matches[0]].name, matches.length > 1 ? tl('（也可能是 {0}）', names) : '');
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
    if (!connected(draft.shape)) throw Error(tl('形状不能为空，并且所有格子必须共边相连'));
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
  toast(tl('已为 {0} 个条目写入官方种类', count));
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
      toast(tl('已在本工具中更新「{0}」的排布（未写回存档），请回到游戏中手动摆放', machineName(machine)));
    } catch (e) { toast(e.message); }
    return;
  }
  try {
    const count = result.placements.length;
    config = lockResultItems(config, result.placements, newId);
    invalidate();
    toast(tl('已锁定 {0} 件，下次优化将排除这些插入物', count));
  } catch (e) { toast(e.message); }
};
$('#unlock-all').onclick = () => {
  if (worker) return;
  config = unlockAllItems(config);
  invalidate();
  toast(tl('已解除全部锁定，必选标记保持不变'));
};

$('#edit-board').onclick = () => {
  if (worker) {
    toast(tl('请先停止搜索再编辑插槽'));
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
    toast(tl('尺寸范围为 {0}–{1} 行列', LIMITS.boardMinSide, LIMITS.boardMaxSide));
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
    el('h3', {text: tl('参与计分的词条')}), ...[...scoring, [nodeChip(), NODE_EFFECT]].map(block),
    el('h3', {text: tl('不参与计分的词条（数值已体现在基础属性中）')}), ...passive.map(block),
    el('p', {class: 'hint', text: tl('游戏中每个模组最多 {0} 个词条；优化时分数相同则优先不用带退化或过载的模组。', MAX_MODULE_EFFECTS)}),
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
    ? (r.feasible ? (custom ? tl('已证明按优先级全局最优') : tl('已证明全局最优')) : (custom ? tl('已证明无达标布局') : tl('已证明无可行布局')))
    : (r.feasible ? (custom ? tl('当前最佳达标布局 · 尚未证明最优') : tl('当前最佳 · 尚未证明最优'))
      : r.done ? (custom ? tl('尚未找到达标布局') : tl('尚未找到可行布局')) : (custom ? tl('正在寻找达标布局') : tl('正在寻找可行布局')));
  $('#status').textContent = status;
  $('#status-dot').className = 'dot ' + (!r.done ? 'running' : r.proven ? 'success' : 'warn');
  $('#search-stats').textContent = `${(r.elapsedMs / 1000).toFixed(1)} s · ${fmt(r.visits)} states`;
  const bound = r.upperBound !== null && r.feasible ? tl(' {0}理论上界 ≤ {1}；', custom ? tl('{0}首要项', METRICS[config.custom.primary]) : '', fmt(r.upperBound)) : '';
  $('#result-note').textContent = r.proven
    ? (r.feasible
      ? (custom ? tl('已满足全部范围，并证明首要属性最大、同分时次要属性最大。') : tl('已穷尽所有可能改善结果的分支；当前布局在本次配置与规则下达到最高值。'))
      : (custom ? tl('已排除全部可能达标的布局；可放宽范围、启用浮动或调整候选件。') : tl('已穷尽或排除全部布局；可减少候选件、修改插槽，或开启允许冗余。')))
    : `${r.done ? tl('本次搜索已停止。') : tl('搜索仍在进行，可随时停止。')}${bound} ${r.feasible
      ? (custom ? tl('当前布局已满足所有范围，继续搜索可能改善优先属性。') : tl('当前布局是可行解，延长搜索可能继续提升。'))
      : tl('尚未找到可行解不等于无解，请尝试更长搜索时间。')}`;
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
      toast(machine ? tl('没有可用于本机器的模组') : tl('请先添加至少一个模组或节点'));
      return;
    }
    const limited = applySearchLimit(runConfig, LIMITS.maxSearchQuantity);
    if (limited.count > LIMITS.maxSearchQuantity) {
      toast(tl('参与优化的候选件有 {0} 件{1}，仍超过上限 {2} 件。请用「锁定一个」排除一部分', limited.count, limited.excludedRisk ? tl('（已排除 {0} 件过载/退化模组）', limited.excludedRisk) : '', LIMITS.maxSearchQuantity));
      return;
    }
    if (limited.excludedRisk) toast(tl('候选超过 {0} 件，已自动排除 {1} 件过载/退化模组', LIMITS.maxSearchQuantity, limited.excludedRisk));
    runConfig = limited.config;
    editingBoard = false;
    selectedInstance = null;
    result = null;
    detailTarget = config.target === 'custom' ? config.custom.primary : config.target;
    lastConfig = structuredClone(runConfig);
    started = performance.now();
    render();
    setRunning(true);
    $('#status').textContent = tl('正在准备搜索…');
    $('#status-dot').className = 'dot running';
    $('#result-note').textContent = tl('正在生成所有旋转、镜像与合法落点。');
    worker = createWorker();
    worker.onmessage = ({data}) => {
      if (data.error) {
        toast(data.error);
        $('#status').textContent = tl('计算失败');
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
      toast(tl('计算线程加载或运行失败，请刷新页面后重试'));
      $('#status').textContent = tl('计算失败');
      worker?.terminate();
      worker = null;
      setRunning(false);
      console.error(e);
    };
    worker.postMessage({config: structuredClone(runConfig), limitMs: Number($('#budget').value) * 1000, lang: getLang()});
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
    $('#status').textContent = tl('已停止，尚未找到可行布局');
    $('#status-dot').className = 'dot warn';
    $('#result-note').textContent = tl('可以增加搜索时长后重试。');
  }
};

/* ---------- import / export ---------- */

$('#export-btn').onclick = () => {
  if (!storageProtected) {
    download(FILES.config, config);
    return;
  }
  try {
    download(FILES.originalBackup, store.getItem(STORAGE_KEY) || '');
  } catch {
    toast(tl('无法读取原存档'));
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
    title: tl('导入游戏存档'),
    message: [
      tl('导入会覆盖当前候选栏的全部 {0} 件（包括手动添加的条目），以存档为准。', current),
      tl('覆盖前的配置会自动备份在浏览器中；也建议先「导出配置」另存一份。'),
      tl('存档只读取、不会被修改。'),
    ],
    confirmText: tl('覆盖并选择存档'),
  })) return;
  $('#save-file').click();
};
$('#save-file').onchange = async e => {
  const file = e.target.files[0];
  try {
    if (!file) return;
    if (file.size > MAX_SAVE_BYTES) throw Error(tl('存档文件过大'));
    const parsed = readSave(await file.text());
    try { backupBeforeSaveImport(store, config); } catch { /* storage full or unavailable: the confirm already warned */ }
    config = importSave(config, parsed, {file: file.name, importedAt: file.lastModified, newId});
    editingBoard = false;
    invalidate();
    const skipped = Object.entries(parsed.skipped).map(([k, n]) => tl('{0} {1} 件', k, n)).join(tl('、'));
    toast(tl('已读取 {0} 台机器、{1} 件自由模组{2}', parsed.machines.length, parsed.free.length, skipped ? tl('（跳过：{0}）', skipped) : ''));
  } catch (err) {
    toast(tl('读取存档失败：') + err.message);
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
    toast(tl('「{0}」模组舱{1}为扩建等级 {2}（{3} 格）。仅在本工具中生效，请在游戏中使用模组舱扩建套件', machineName(machine), step > 0 ? tl('升级') : tl('撤回'), next.stage, next.board.cells.filter(Boolean).length));
  } catch (e) { toast(e.message); }
}
$('#upgrade-bay').onclick = () => changeStage(1);
$('#downgrade-bay').onclick = () => changeStage(-1);
$('#restore-layout').onclick = () => {
  if (worker) return;
  config = clearSnapshot(config);
  invalidate();
  toast(tl('已恢复为优化前的排布，副本已删除'));
};
$('#import-btn').onclick = () => $('#import-file').click();
$('#import-file').onchange = async e => {
  const file = e.target.files[0];
  try {
    if (!file) return;
    if (file.size > LIMITS.maxImportBytes) throw Error(tl('配置文件不能超过 {0} MB', fmt(LIMITS.maxImportBytes / 1024 / 1024)));
    const parsed = JSON.parse(await file.text());
    config = structuredClone(stackInventory(migrateConfig(parsed.config || parsed)));
    editingBoard = false;
    fillStaticText();
    invalidate();
    toast(tl('配置已导入'));
  } catch (err) {
    toast(tl('导入失败：') + err.message);
  } finally {
    $('#import-file').value = '';
  }
};
/* ---------- opt-in game sprites (read from the user's own install) ---------- */

/** Desktop build: the launcher exposes window.pywebview.api once ready. */
const desktopApi = () => (window.pywebview?.api?.read_game_sprites ? window.pywebview.api : null);

function applyGameArt(pack) {
  setGameArt(pack);
  drawBrand();
  render();
}

function refreshGameArtDialog() {
  const desktop = !!desktopApi();
  $('#game-art-desktop').hidden = !desktop;
  $('#game-art-browser').hidden = desktop;
  $('#game-art-allow').textContent = desktop ? tl('允许并读取') : tl('选择贴图包…');
  $('#game-art-off').disabled = !gameArtActive();
  const status = $('#game-art-status');
  status.textContent = gameArtActive() ? tl('已启用：正在使用本机游戏贴图。') : tl('未启用：正在使用原创像素画。');
  status.classList.toggle('on', gameArtActive());
}

function useGameArt(raw) {
  const {pack, used, skipped} = checkGameArt(raw);
  try { saveGameArt(store, pack); } catch { toast(tl('本机存储不可用，贴图只在本次打开期间有效')); }
  applyGameArt(pack);
  refreshGameArtDialog();
  toast(tl('已启用本机游戏贴图（{0} 张）', used) + (skipped.length ? tl('，{0} 张形状不符已跳过', skipped.length) : ''));
}

$('#game-art-btn').onclick = async () => {
  refreshGameArtDialog();
  $('#game-art-dialog').showModal();
  const api = desktopApi();
  if (api && !$('#game-art-dir').value) $('#game-art-dir').value = await api.find_game_dir() || '';
};
$('#game-art-find').onclick = async () => {
  const dir = await desktopApi().find_game_dir();
  $('#game-art-dir').value = dir || '';
  if (!dir) toast(tl('没有在 Steam 库中找到游戏，请手动选择安装目录'));
};
$('#game-art-browse').onclick = async () => {
  const dir = await desktopApi().choose_game_dir();
  if (dir) $('#game-art-dir').value = dir;
};
$('#game-art-allow').onclick = async () => {
  const api = desktopApi();
  if (!api) { $('#game-art-file').click(); return; }
  const dir = $('#game-art-dir').value.trim();
  if (!dir) { toast(tl('请先填写或选择游戏安装目录')); return; }
  const button = $('#game-art-allow');
  button.disabled = true;
  button.textContent = tl('读取中…');
  try {
    const res = await api.read_game_sprites(dir);
    if (!res.ok) throw Error(res.error);
    useGameArt(res.pack);
  } catch (err) {
    toast(tl('读取失败：') + err.message);
  } finally {
    button.disabled = false;
    refreshGameArtDialog();
  }
};
$('#game-art-file').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    useGameArt(JSON.parse(await file.text()));
  } catch (err) {
    toast(tl('贴图包无效：') + err.message);
  } finally {
    e.target.value = '';
  }
};
$('#game-art-off').onclick = () => {
  try { clearGameArt(store); } catch { /* storage unavailable: nothing stored */ }
  applyGameArt(null);
  refreshGameArtDialog();
  toast(tl('已停用并删除本机游戏贴图，恢复原创像素画'));
};

$('#demo-btn').onclick = async () => {
  if (config.items.length && !await askConfirm({title: tl('加载演示数据'), message: tl('加载演示会替换当前配置。建议先「导出配置」备份。'), confirmText: tl('替换为演示数据'), danger: true})) return;
  config = blank();
  config.items = structuredClone(DEMO_ITEMS);
  invalidate();
  toast(tl('已加载官方模板数值的演示数据，请替换为你的实际属性'));
};

/* ---------- boot ---------- */

$('#app-version').textContent = 'v' + APP_VERSION;
async function boot() {
  // Static page text first (index.html is written in Chinese), then the language switch.
  document.documentElement.lang = getLang() === 'en' ? 'en' : 'zh-CN';
  translateDom(document.documentElement);
  $$('#lang-switch [data-lang]').forEach(b => {
    const on = b.dataset.lang === getLang();
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
    b.onclick = () => switchLang(b.dataset.lang);
  });
  try {
    store = await openStore();
    store.getItem(STORAGE_KEY);            // localStorage can throw on access (blocked / private mode)
  } catch {
    store = Object.assign(createWriteThroughStore({}, () => {}), {volatile: true});   // session only
    $('#save-state').textContent = tl('自动保存不可用，请导出配置');
  }
  if (store !== globalThis.localStorage && !store.volatile) $('#save-state').textContent = tl('自动保存在本机');
  loadStoredConfig();
  try { setGameArt(loadGameArt(store)); } catch { /* storage unavailable */ }
  fillStaticText();
  buildSelects();
  buildFilters();
  buildCustomEditor();
  drawBrand();
  drawReadonlyIcon();
  new ResizeObserver(() => requestAnimationFrame(renderPieces)).observe($('#board'));
  result = currentMachineResult();
  render();
  $('#result-note').textContent = tl('限时搜索返回当前最佳布局；只有搜索完成后才标记为全局最优。');
}

boot();
