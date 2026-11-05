import {steady} from './clock.js';
import test from 'node:test';import assert from 'node:assert/strict';
import{solve,defaultRules,defaultCustom,effectiveBounds,migrateConfig,generatePlacements,evaluate}from'../src/core/engine.js';
const item=(id,base,traits=[],qty=1,shape=[[0,0]],type='module')=>({id,name:id,type,shape,base,traits,qty});
const cfg=(items,w=2,h=1)=>({version:1,board:{w,h,cells:Array(w*h).fill(true)},items,rules:{...defaultRules},optional:true,target:'custom',custom:defaultCustom()});
const run=c=>solve(c,{...steady(),random:()=>.5});
test('bounds are used exactly as entered; missing bounds stay unconstrained',()=>{const c=defaultCustom();c.bounds=[{min:100,max:200},{min:-100,max:-20},{min:null,max:0}];assert.deepEqual(effectiveBounds(c),[{min:100,max:200},{min:-100,max:-20},{min:-Infinity,max:0}]);});
test('the retired ±5% tolerance in old saves is ignored and removed',()=>{const c=cfg([item('a',[95,0,0])],1);c.custom.bounds[0]={min:100,max:null,tolerance:true};const m=migrateConfig(c);assert.equal('tolerance' in m.custom.bounds[0],false);assert.equal(run(c).feasible,false);});
test('primary always outranks secondary, secondary breaks primary ties',()=>{let c=cfg([item('a',[10,0,0]),item('b',[9,10000,0])],1);let r=run(c);assert.equal(r.proven,true);assert.deepEqual(r.layout.total,[10,0,0]);c.items=[item('a',[10,0,0]),item('b',[10,7,0])];r=run(c);assert.deepEqual(r.layout.total,[10,7,0]);c.custom.primary=1;c.custom.secondary=0;r=run(c);assert.deepEqual(r.layout.total,[10,7,0]);});
test('bounds override priorities; only satisfying layouts are returned',()=>{const c=cfg([item('a',[100,0,-50]),item('b',[90,5,3])],1);c.custom.bounds[2].min=0;const r=run(c);assert.deepEqual(r.layout.total,[90,5,3]);assert.equal(r.proven,true);});
test('a future negative item can restore an exceeded upper bound',()=>{const c=cfg([item('a',[100,0,0]),item('b',[-30,0,0])]);c.custom.bounds[0]={min:70,max:70,tolerance:false};const r=run(c);assert.equal(r.feasible,true);assert.equal(r.layout.total[0],70);assert.equal(r.layout.rows.length,2);});
test('lower-only, upper-only, no limits and exact-zero limits',()=>{const c=cfg([item('a',[95,0,0])],1);c.custom.bounds[0].min=100;assert.equal(run(c).feasible,false);c.custom.bounds[0].min=95;assert.equal(run(c).layout.total[0],95);c.custom.bounds[0]={min:null,max:0,tolerance:false};assert.equal(run(c).layout.total[0],0);c.custom.bounds[0]={min:null,max:null,tolerance:false};assert.equal(run(c).layout.total[0],95);});
test('forced negative total and negative upper limit remain valid',()=>{const c=cfg([item('a',[-20,10,0])],1);c.optional=false;c.custom.bounds[0]={min:-21,max:-19,tolerance:false};assert.equal(run(c).layout.total[0],-20);c.custom.bounds[0].max=-25;assert.throws(()=>run(c));});
test('validation rejects inverted bounds and duplicate priorities',()=>{const c=cfg([]);c.custom.bounds[0]={min:1,max:0,tolerance:true};assert.throws(()=>migrateConfig(c));c.custom=defaultCustom();c.custom.secondary=0;assert.throws(()=>migrateConfig(c));});
// Independent exhaustive search over tiny boards, with direct range / priority
// comparisons instead of the optimizer's comparison and bounding functions.
function brute(c){const all=c.items.flatMap(i=>Array.from({length:i.qty},(_,n)=>({item:i,instance:i.id+n,ps:generatePlacements(c.board,i,c.rules)})));let best=null;function rec(k,mask,layout){if(k===all.length){const t=evaluate(layout,c.rules).total;for(let m=0;m<3;m++){const b=c.custom.bounds[m],min=b.min===null?-Infinity:b.min,max=b.max===null?Infinity:b.max;if(t[m]<min-1e-9||t[m]>max+1e-9)return;}const p=c.custom.primary,s=c.custom.secondary;if(!best||t[p]>best[p]+1e-9||(Math.abs(t[p]-best[p])<1e-9&&s!==null&&t[s]>best[s]+1e-9))best=t;return;}const a=all[k];if(c.optional)rec(k+1,mask,layout);for(const p of a.ps)if(!(mask&p.mask))rec(k+1,mask|p.mask,[...layout,{...a,p}]);}rec(0,0n,[]);return best;}
let seed=99887;const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
test('signed constrained lexicographic search matches independent exhaustive oracle',()=>{for(let n=0;n<28;n++){const a=item('a',Array.from({length:3},()=>Math.floor(rng()*16)-7),['left','negative','receiver'],n%4===0?2:1),b=item('b',Array.from({length:3},()=>Math.floor(rng()*16)-7),['top','negative']),node=item('n',[0,0,0],[],1,[[0,0],[1,0]],'node');const c=cfg([a,b,node],3,2);c.optional=n%2===0;c.rules.stack=n%3===0?'multiply':'add';c.custom.primary=n%3;c.custom.secondary=n%5===0?null:(n+1)%3;c.custom.bounds.forEach((b,k)=>{b.min=n%3===k?Math.floor(rng()*15)-8:null;b.max=n%4===k?Math.floor(rng()*15)+8:null;});const expected=brute(c),actual=solve(c,{...steady(),random:rng});assert.equal(actual.proven,true,`unproven case ${n}`);assert.equal(actual.feasible,expected!==null,`feasibility case ${n}`);if(expected){for(const k of[c.custom.primary,c.custom.secondary].filter(k=>k!==null))assert.ok(Math.abs(actual.layout.total[k]-expected[k])<1e-8,`case ${n} axis ${k}: ${actual.layout.total} != ${expected}`);}}});
test('timeout does not claim proof or return a violating solution',()=>{const c=cfg([item('a',[10,10,0],[],3)],3,2);c.custom.bounds[1].min=10;let time=0;const r=solve(c,{limitMs:1,now:()=>time+=10});assert.equal(r.feasible,false);assert.equal(r.proven,false);assert.equal(r.layout,null);
});

import {boundsFromMatch, canStartMatch, matchStartValue} from '../src/core/engine.js';
test('exact / fuzzy matching derives both bounds from one value', () => {
  assert.deepEqual(boundsFromMatch('exact', 120), {min: 120, max: 120});
  assert.deepEqual(boundsFromMatch('fuzzy', 120), {min: 115, max: 125});
  assert.deepEqual(boundsFromMatch('fuzzy', -3), {min: -8, max: 2});
  assert.deepEqual(boundsFromMatch('exact', null), {min: null, max: null});
  assert.equal(canStartMatch({min: 10, max: null}), true);
  assert.equal(canStartMatch({min: null, max: 10}), true);
  assert.equal(canStartMatch({min: 10, max: 10}), true);
  assert.equal(canStartMatch({min: null, max: null}), true);
  assert.equal(canStartMatch({min: 5, max: 10}), false);
  assert.equal(matchStartValue({min: null, max: 40}), 40);
  assert.equal(matchStartValue({min: null, max: null}), null);
  const c = cfg([item('a', [100, 0, 0])], 1);
  c.custom.bounds[0] = {min: 95, max: 105, match: 'fuzzy', center: 100};
  assert.doesNotThrow(() => migrateConfig(c));
  assert.equal(run(c).layout.total[0], 100);
  c.custom.bounds[0] = {min: 90, max: 105, match: 'fuzzy', center: 100};
  assert.throws(() => migrateConfig(c));
  c.custom.bounds[0] = {min: 100, max: 100, match: 'nope', center: 100};
  assert.throws(() => migrateConfig(c));
});

import {driftOf, hedgeSummary} from '../src/core/engine.js';
test('退化 decays positive axes; 自学习 grows only under its cap', () => {
  assert.deepEqual(driftOf({traits: ['degrading'], base: [10, 0, -3]}), [-1, 0, 0]);
  assert.deepEqual(driftOf({traits: ['learning'], base: [4, 9, 0], learnCap: [8, 9, 0]}), [1, 0, 0]);
  assert.deepEqual(driftOf({traits: ['learning'], base: [4, 0, 0]}), [0, 0, 0]);
  const h = hedgeSummary([{traits: ['degrading'], base: [10, 5, 0]}, {traits: ['learning'], base: [1, 0, 0], learnCap: [8, 0, 0]}]);
  assert.deepEqual(h, {decay: [1, 1, 0], grow: [1, 0, 0], uncovered: 1});
});

test('at equal score and risk, a growing 自学习 module hedging the same axis is preferred', () => {
  // Target 效率. One 退化 module is required (it carries 质量); two equal-score fillers compete for the last cell:
  // a plain 0-value module and a 自学习 module growing 效率 and 质量 (0 now, caps 6). Both add 0 to 效率 now.
  const deg = {...item('deg', [5, 4, 0]), traits: ['degrading'], required: true};
  const plain = item('plain', [0, 0, 0]);
  const learn = {...item('learn', [0, 0, 0]), traits: ['learning'], learnCap: [6, 6, 0]};
  for (const order of [[deg, plain, learn], [deg, learn, plain]]) {
    const c = cfg(order, 2);
    c.optional = true;
    c.items.forEach(i => { i.required = i.id === 'deg'; });
    const r = run(c);
    assert.equal(r.layout.total[0], 5);
    assert.equal(r.uncoveredDecay, 0);
    assert.ok(r.placements.some(p => p.itemId === 'learn'));
  }
  // A capped 自学习 module does not count as a hedge.
  const capped = {...learn, base: [6, 6, 0]};
  const c = cfg([deg, capped], 2);
  c.optional = true;
  c.items.forEach(i => { i.required = i.id === 'deg'; });
  assert.equal(run(c).uncoveredDecay, 2);
  // A cap on a module without 自学习 is rejected.
  assert.throws(() => migrateConfig(cfg([{...item('x', [1, 0, 0]), learnCap: [1, 1, 1]}], 1)));
});
