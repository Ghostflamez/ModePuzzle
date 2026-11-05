import {steady} from './clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {solve, evaluate, generatePlacements, defaultRules, defaultCustom, validate} from '../src/core/engine.js';
import {TRAITS, RISK_TRAITS, traitConflicts, fillRuleText, MAX_MODULE_EFFECTS} from '../src/config/game-rules.js';

const item = (id, base, traits = [], shape = [[0, 0]], qty = 1) => ({id, name: id, type: 'module', base, traits, shape, qty});
const cfg = (items, w, h = 1, target = 0) => ({version: 1, board: {w, h, cells: Array(w * h).fill(true)}, items, rules: {...defaultRules}, optional: true, target, custom: defaultCustom()});

test('non-scoring effects never change scores', () => {
  const plain = item('a', [30, -10, 5], ['left']);
  for (const t of Object.keys(TRAITS).filter(t => !TRAITS[t].scoring)) {
    const withTrait = {...plain, traits: ['left', t]};
    const c = cfg([withTrait], 2);
    const p = generatePlacements(c.board, withTrait).find(q => q.x === 0);
    const q = generatePlacements(c.board, plain).find(r => r.x === 0);
    assert.deepEqual(evaluate([{item: withTrait, p, instance: 'a'}], c.rules).total, evaluate([{item: plain, p: q, instance: 'a'}], c.rules).total, t);
  }
  assert.deepEqual([...RISK_TRAITS].sort(), ['degrading', 'overvolted']);
});

test('on equal scores the optimizer prefers modules without 退化 / 过载', () => {
  for (const risky of RISK_TRAITS) {
    const r = solve(cfg([item('risky', [10, 0, 0], [risky]), item('safe', [10, 0, 0])], 1), {...steady(), random: () => 0.5});
    assert.equal(r.proven, true);
    assert.deepEqual(r.placements.map(p => p.itemId), ['safe']);
    assert.equal(r.riskPieces, 0);
  }
  // A strictly better score still wins over the preference.
  const r = solve(cfg([item('risky', [11, 0, 0], ['overvolted']), item('safe', [10, 0, 0])], 1), {...steady(), random: () => 0.5});
  assert.deepEqual(r.placements.map(p => p.itemId), ['risky']);
  assert.equal(r.riskPieces, 1);
});

test('risk tie-break agrees with exhaustive enumeration (primary, secondary, then fewer risky)', () => {
  let seed = 7;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 12; i++) {
    const base = () => [0, 1, 2].map(() => Math.floor(random() * 7) - 2);
    const items = [
      item('a', base(), [i % 2 ? 'overvolted' : 'degrading'], [[0, 0]], 2),
      item('b', base(), ['left'], [[0, 0], [1, 0]]),
      item('c', base(), [], [[0, 0]], 2),
      item('d', base(), ['degrading', 'top']),
    ];
    const c = cfg(items, 3, 2, i % 3 === 0 ? 'custom' : i % 3);
    if (c.target === 'custom') Object.assign(c.custom, {primary: i % 3, secondary: (i + 1) % 3});
    const p = c.target === 'custom' ? c.custom.primary : c.target;
    const s = c.target === 'custom' ? c.custom.secondary : null;
    const pieces = c.items.flatMap(a => Array.from({length: a.qty}, (_, k) => ({item: a, instance: `${a.id}:${k}`, ps: generatePlacements(c.board, a)})));
    let best = null;
    const better = (x, y) => !y || x.t[p] > y.t[p] || (x.t[p] === y.t[p] && ((s !== null && x.t[s] > y.t[s]) || ((s === null || x.t[s] === y.t[s]) && x.risk < y.risk)));
    (function visit(k, mask, layout) {
      if (k === pieces.length) {
        const t = evaluate(layout, c.rules).total;
        const risk = layout.filter(l => l.item.traits.some(tr => RISK_TRAITS.includes(tr))).length;
        if (better({t, risk}, best)) best = {t, risk};
        return;
      }
      visit(k + 1, mask, layout);
      for (const pl of pieces[k].ps) if (!(mask & pl.mask)) visit(k + 1, mask | pl.mask, [...layout, {item: pieces[k].item, p: pl, instance: pieces[k].instance}]);
    })(0, 0n, []);
    const r = solve(c, {...steady(), random});
    assert.equal(r.proven, true, `case ${i}`);
    assert.equal(r.layout.total[p], best.t[p], `case ${i} primary`);
    if (s !== null) assert.equal(r.layout.total[s], best.t[s], `case ${i} secondary`);
    assert.equal(r.riskPieces, best.risk, `case ${i} risk`);
  }
});

test('effect limits and exclusions follow the game', () => {
  assert.equal(MAX_MODULE_EFFECTS, 2);
  assert.deepEqual(traitConflicts(['left', 'top']), []);
  assert.equal(traitConflicts(['left', 'top', 'receiver']).length, 1);
  assert.equal(traitConflicts(['premium', 'inferior']).length, 1);
  assert.equal(traitConflicts(['learning', 'negative']).length, 1);
  assert.equal(traitConflicts(['overvolted', 'degrading']).length, 0);
  // Exclusions are symmetric in effect even when only one side lists them.
  for (const [id, t] of Object.entries(TRAITS)) for (const other of t.incompatible || []) assert.ok(TRAITS[other], `${id} -> ${other}`);
  // Old data with more effects still loads; the UI only warns.
  assert.doesNotThrow(() => validate(cfg([item('x', [1, 0, 0], ['left', 'top', 'receiver', 'learning'])], 1)));
  assert.match(fillRuleText(TRAITS.overvolted.description), /200%.*10%/);
});
