import test from 'node:test';
import assert from 'node:assert/strict';
import {checkGameArt, loadGameArt, saveGameArt, clearGameArt, GAME_ART_FORMAT, GAME_ART_KEY} from '../src/core/game-art.js';

// Synthetic pack only: tests never contain game assets.
const sprite = (w, h, cells) => ({w, h, cells, rows: Array.from({length: h}, () => '#'.repeat(w))});
const pack = sprites => ({format: GAME_ART_FORMAT, alphabet: '#%&', transparent: '.', palette: ['#112233'], sprites});
const memory = () => {
  const m = new Map();
  return {getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k), m};
};

test('game sprite packs are checked; sprites must fit the expected shape and orientation', () => {
  const {pack: ok, used, skipped} = checkGameArt(pack({
    node_s: sprite(16, 16, [[0, 0]]),
    node_m: sprite(16, 32, [[0, 0], [0, 1]]),
    module_red_c: sprite(32, 32, [[0, 0], [0, 1], [1, 1]]),   // wrong orientation -> skipped
    not_a_shape: sprite(16, 16, [[0, 0]]),                     // unknown id -> skipped
  }));
  assert.equal(used, 2);
  assert.deepEqual(skipped.sort(), ['module_red_c', 'not_a_shape']);
  assert.deepEqual(Object.keys(ok.sprites).sort(), ['node_m', 'node_s']);
  assert.throws(() => checkGameArt({format: 'x'}));
  assert.throws(() => checkGameArt(pack({node_s: {...sprite(16, 16, [[0, 0]]), rows: ['%'.repeat(16)]}})));   // index beyond palette
  assert.throws(() => checkGameArt(pack({})));
});

test('packs live under their own storage key and can be removed', () => {
  const store = memory();
  assert.equal(loadGameArt(store), null);
  saveGameArt(store, checkGameArt(pack({node_s: sprite(16, 16, [[0, 0]])})).pack);
  assert.ok(store.m.has(GAME_ART_KEY));
  assert.equal(Object.keys(loadGameArt(store).sprites).length, 1);
  store.setItem(GAME_ART_KEY, '{broken');
  assert.equal(loadGameArt(store), null);
  clearGameArt(store);
  assert.equal(store.m.size, 0);
});
