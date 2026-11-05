import test from 'node:test';
import assert from 'node:assert/strict';
import {matchKindsByName, normalizeName, displayName, nameTag} from '../src/core/naming.js';
import {inferKindDetailed, resolveVisual} from '../src/render/sprites.js';
import {MODULE_KINDS} from '../src/config/catalog.js';

const I4 = [[0, 0], [0, 1], [0, 2], [0, 3]];
const SQUARE = [[0, 0], [1, 0], [0, 1], [1, 1]];
const L4 = [[0, 0], [1, 0], [2, 0], [2, 1]];
const mod = (name, shape, base) => ({type: 'module', name, shape, base, traits: []});

test('official names and aliases match; exact beats containment; type filters', () => {
  assert.deepEqual(matchKindsByName('超频', 'module'), ['overclock']);
  assert.deepEqual(matchKindsByName('超频模组', 'module'), ['overclock']);
  assert.deepEqual(matchKindsByName(' 超频模组 2 ', 'module'), ['overclock']);
  assert.deepEqual(matchKindsByName('神经核心模组（受限）', 'module'), ['neuralCapped']);
  assert.deepEqual(matchKindsByName('AI', 'module').sort(), ['neuralCapped', 'neuralUncapped']);
  assert.deepEqual(matchKindsByName('辅助节点', 'node'), ['nodeMedium']);
  assert.deepEqual(matchKindsByName('辅助节点', 'module'), []);
  assert.deepEqual(matchKindsByName('1', 'module'), []);
  assert.deepEqual(matchKindsByName('#12', 'module'), []);
  assert.equal(normalizeName('节点（中）'), normalizeName('节点(中)'));
  for (const [id, kind] of Object.entries(MODULE_KINDS)) assert.ok(matchKindsByName(kind.name, kind.type).includes(id), id);
});

test('name matching drives inference only when the kind officially has that shape', () => {
  assert.deepEqual(inferKindDetailed(mod('基因稳定模组', I4, [-25, 0, -50])), {id: 'dnaStabilizer', source: 'name'});
  assert.deepEqual(inferKindDetailed(mod('正面特性筛选模组', I4, [-25, 0, 0])), {id: 'dnaPositiveFilter', source: 'name'});
  assert.deepEqual(inferKindDetailed(mod('超频', SQUARE, [-35, 0, 28])), {id: 'overclock', source: 'name'});
  // Overclock never comes as a 4-cell L: fall back to shape + attribute signs.
  assert.equal(inferKindDetailed(mod('超频', L4, [0, 0, 16])).source, 'shape');
  assert.deepEqual(inferKindDetailed(mod('AI', [[0, 0], [1, 0], [1, 1]], [-1, 1, 1])), {id: 'neuralCapped', source: 'name'});
  assert.deepEqual(inferKindDetailed({...mod('#7', SQUARE, [0, 0, 16]), aliases: ['性能模组']}), {id: 'performance', source: 'name'});
  assert.equal(resolveVisual(mod('水培走私模组', [[0, 0], [0, 1]], [0, 0, 0])).sprite, 'farm_module6');
});

test('display name is official; entered name becomes a tag unless it repeats the official name', () => {
  const a = {...mod('超频', SQUARE, [0, 0, 0]), kind: 'overclock'};
  assert.equal(displayName(a, 'overclock'), '超频模组');
  assert.equal(nameTag(a, 'overclock'), '');
  assert.equal(nameTag({...a, name: '超频模组'}, 'overclock'), '');
  assert.equal(nameTag({...a, name: '#12'}, 'overclock'), '#12');
  assert.equal(nameTag({...a, name: '2号位'}, 'overclock'), '2号位');
  assert.equal(nameTag({...a, name: ''}, 'overclock'), '');
  assert.equal(displayName({...a, name: '自制件'}, null), '自制件');
});
