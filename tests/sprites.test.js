import test from 'node:test';
import assert from 'node:assert/strict';
import {SHAPES, ART_CELL, ART_TONES, renderArt} from '../src/render/module-art.js';
import {MODULE_KINDS, KIND_GROUPS, MACHINES, DEFAULT_KIND, UNOFFICIAL_KIND} from '../src/config/catalog.js';
import {TYPE_RULES, TRAITS, NODE_EFFECT, fillRuleText, DEFAULT_RULES} from '../src/config/game-rules.js';
import {PIXEL_ICONS, DEMO_ITEMS} from '../src/config/ui.js';
import {orientations, validate, isNodeShape} from '../src/core/engine.js';
import {matchSprite, kindSpriteFor, kindShapes, inferKind, resolveVisual} from '../src/render/sprites.js';

const item = (shape, base = [0, 0, 0], extra = {}) => ({type: 'module', shape, base, traits: [], ...extra});

test('generated art covers exactly the module cells, with an outline, for every kind and shape', () => {
  assert.equal(ART_CELL, 16);
  for (const [id, kind] of Object.entries(MODULE_KINDS)) {
    assert.ok(ART_TONES[kind.tone], `${id} tone ${kind.tone}`);
    for (const {cells} of kindShapes(id)) {
      const {w, h, px} = renderArt(id, cells);
      const own = new Set(cells.map(c => c.join(',')));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const inside = own.has(`${Math.floor(x / ART_CELL)},${Math.floor(y / ART_CELL)}`);
        assert.equal(px[y][x] !== null, inside, `${id} ${x},${y}`);
        if (inside) assert.match(px[y][x], /^#[0-9a-f]{6}$/);
      }
    }
  }
  // Same input, same pixels.
  assert.deepEqual(renderArt('performance', SHAPES.module_red_t), renderArt('performance', SHAPES.module_red_t));
});

test('every catalogue kind references known shapes, a known group and machine', () => {
  const groups = new Set(KIND_GROUPS.map(g => g.id));
  for (const [id, kind] of Object.entries(MODULE_KINDS)) {
    assert.ok(groups.has(kind.group), id);
    assert.ok(MACHINES[kind.machine], id);
    assert.equal(kind.base.length, 3, id);
    for (const sprite of kind.sprites) assert.ok(SHAPES[sprite], `${id} -> ${sprite}`);
  }
  assert.equal(MODULE_KINDS[DEFAULT_KIND.module].type, 'module');
  assert.equal(MODULE_KINDS[DEFAULT_KIND.node].type, 'node');
});

test('official shapes: basic kinds use small square/L/T/corner, advanced use square/C/P, capped neural core is 3 cells', () => {
  const sizes = id => kindShapes(id).map(s => s.cells.length);
  assert.deepEqual(sizes('performance'), [4, 4, 4, 3]);
  assert.deepEqual(sizes('overclock'), [4, 5, 5]);
  assert.deepEqual(sizes('neuralCapped'), [3]);
  assert.deepEqual(sizes('neuralUncapped'), [4]);
  assert.deepEqual(sizes('nutrifruit'), [4]);
  assert.deepEqual(sizes('smuggler'), [2]);
});

test('node kinds are exactly the engine node shapes', () => {
  for (const id of ['nodeMedium', 'nodeSmall']) for (const {cells} of kindShapes(id)) assert.ok(isNodeShape(cells));
  for (const shape of TYPE_RULES.node.shapes) assert.ok(['nodeMedium', 'nodeSmall'].some(id => kindSpriteFor(id, shape)));
});

test('sprites are recognised in every rotation and mirror', () => {
  for (const [id, kind] of Object.entries(MODULE_KINDS)) {
    for (const sprite of kind.sprites) {
      for (const o of orientations(SHAPES[sprite])) {
        const m = kindSpriteFor(id, o.cells);
        assert.ok(m, `${id} ${JSON.stringify(o.cells)}`);
        assert.ok(matchSprite(m.sprite, o.cells));
      }
    }
  }
});

test('no invented styles: a kind never renders with a shape it does not officially have', () => {
  const tShape = [[1, 0], [0, 1], [1, 1], [1, 2]];
  assert.equal(resolveVisual(item(tShape, [0, 0, 16], {kind: 'performance'})).sprite, 'module_red_t');
  const v = resolveVisual(item(tShape, [-44, 0, 36], {kind: 'overclock'}));
  assert.equal(v.official, false);
  assert.equal(v.sprite, null);
  assert.equal(resolveVisual(item([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]])).official, false);
  assert.equal(resolveVisual(item([[0, 0], [1, 0], [0, 1], [1, 1]], [16, 0, 0], {kind: UNOFFICIAL_KIND})).official, false);
});

test('legacy items without kind are inferred from shape and attribute signs, never altered', () => {
  const square = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const a = item(square, [20, 0, 0]);
  const copy = structuredClone(a);
  assert.equal(inferKind(a), 'efficiency');
  assert.deepEqual(a, copy);
  assert.equal(inferKind(item(square, [-30, 0, 40])), 'overclock');
  assert.equal(inferKind(item(square, [-80, 60, 150])), 'neuralUncapped');
  assert.equal(inferKind(item([[0, 0], [1, 0], [1, 1]], [0, 0, 12])), 'performance');
  assert.equal(inferKind({type: 'node', shape: [[0, 0], [1, 0]], base: [0, 0, 0], traits: []}), 'nodeMedium');
  const v = resolveVisual(a);
  assert.equal(v.inferred, true);
  assert.equal(v.sprite, 'module_green');
});

test('engine accepts official kinds and the unofficial marker, rejects unknown kinds and type mismatches', () => {
  const cfg = items => ({version: 1, board: {w: 3, h: 3, cells: Array(9).fill(true)}, items, rules: {...DEFAULT_RULES}, optional: true, target: 0});
  const base = {id: 'a', name: 'a', type: 'module', shape: [[0, 0], [1, 0], [0, 1], [1, 1]], base: [1, 0, 0], traits: [], qty: 1};
  assert.doesNotThrow(() => validate(cfg([{...base, kind: 'efficiency'}])));
  assert.doesNotThrow(() => validate(cfg([{...base, kind: UNOFFICIAL_KIND}])));
  assert.throws(() => validate(cfg([{...base, kind: 'nope'}])));
  assert.throws(() => validate(cfg([{...base, kind: 'nodeMedium'}])));
  assert.doesNotThrow(() => validate(cfg([{...base, id: 'n', type: 'node', shape: [[0, 0]], base: [0, 0, 0], kind: 'nodeSmall'}])));
  assert.throws(() => validate(cfg([{...base, id: 'n', type: 'node', shape: [[0, 0], [1, 0], [2, 0]], base: [0, 0, 0]}])));
  assert.doesNotThrow(() => validate(cfg(structuredClone(DEMO_ITEMS))));
});

test('official trait text is filled from the active rules', () => {
  assert.match(fillRuleText(TRAITS.receiver.description, DEFAULT_RULES), /10%/);
  assert.match(fillRuleText(TRAITS.left.description, {...DEFAULT_RULES, mount: 30}), /30%/);
  assert.match(fillRuleText(NODE_EFFECT.description, DEFAULT_RULES), /20%/);
  for (const t of [...Object.values(TRAITS), NODE_EFFECT]) assert.ok(PIXEL_ICONS[t.icon], t.name);
  for (const rows of Object.values(PIXEL_ICONS)) assert.ok(rows.every(r => r.length === rows[0].length));
});

test('colour picker lists every official kind exactly once and each colour/shape pair maps to one kind', async () => {
  const {PICKER_TABS, SHAPE_NAMES} = await import('../src/config/ui.js');
  const listed = PICKER_TABS.flatMap(t => t.kinds);
  assert.deepEqual([...listed].sort(), Object.keys(MODULE_KINDS).sort());
  assert.equal(new Set(listed).size, listed.length);
  for (const tab of PICKER_TABS) {
    const seen = new Set();
    for (const id of tab.kinds) for (const {sprite} of kindShapes(id)) {
      assert.ok(!seen.has(`${id}:${sprite}`));
      seen.add(`${id}:${sprite}`);
    }
  }
  for (const kind of Object.keys(MODULE_KINDS)) for (const {cells} of kindShapes(kind)) {
    assert.ok(SHAPE_NAMES.some(s => orientations(s.cells).some(o => JSON.stringify(o.cells) === JSON.stringify(cells))), kind);
  }
});
