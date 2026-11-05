import test from 'node:test';
import assert from 'node:assert/strict';
import {createWriteThroughStore} from '../src/core/app-store.js';

test('desktop store: synchronous reads, writes forwarded in order', async () => {
  const log = [];
  const sink = async (op, key, value) => { await new Promise(r => setTimeout(r, op === 'set' && value === '1' ? 5 : 0)); log.push([op, key, value]); };
  const store = createWriteThroughStore({a: 'x'}, sink);
  assert.equal(store.getItem('a'), 'x');
  assert.equal(store.getItem('missing'), null);
  store.setItem('b', 1);
  store.setItem('b', 2);
  store.removeItem('a');
  assert.equal(store.getItem('b'), '2');
  assert.equal(store.getItem('a'), null);
  await store.flushed();
  assert.deepEqual(log, [['set', 'b', '1'], ['set', 'b', '2'], ['remove', 'a', undefined]]);
});

test('a failing write does not block later writes', async () => {
  const log = [];
  const store = createWriteThroughStore({}, async (op, key) => { if (key === 'bad') throw Error('disk'); log.push(key); });
  const err = console.error;
  console.error = () => {};
  store.setItem('bad', 1);
  store.setItem('good', 1);
  await store.flushed();
  console.error = err;
  assert.deepEqual(log, ['good']);
});
