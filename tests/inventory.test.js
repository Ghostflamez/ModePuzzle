import {steady} from './clock.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {stackInventory,transferOne,assignItemName} from '../src/core/inventory.js';
import {defaultRules,defaultCustom,validate,resolveLockedPlacements,solve} from '../src/core/engine.js';
import {loadSavedConfig,saveConfig,STORAGE_KEY,UPGRADE_BACKUP_KEY} from '../src/core/storage.js';
const item=(id,qty=1,locked=false,required=false)=>({id,name:id,type:'module',base:[-19,4,12],shape:[[0,0]],traits:[],qty,required,locked});
const cfg=items=>({version:1,board:{w:4,h:2,cells:Array(8).fill(true)},items,rules:{...defaultRules},optional:true,target:0,custom:defaultCustom()});
const sum=c=>c.items.reduce((n,a)=>n+a.qty,0);
test('locking one splits exactly one and repeated locking merges into the existing target',()=>{
 const c=cfg([item('source',3)]),original=structuredClone(c);let n=transferOne(c,'source',true,'new');assert.deepEqual(c,original);assert.equal(n.items.find(a=>a.id==='source').qty,2);assert.equal(n.items.find(a=>a.id==='new').qty,1);assert.equal(n.items.find(a=>a.id==='new').locked,true);
 n=transferOne(n,'source',true,'discard-id');assert.equal(n.items.find(a=>a.id==='source').qty,1);assert.equal(n.items.find(a=>a.id==='new').qty,2);assert.equal(n.items.length,2);
 n=transferOne(n,'source',true,'unused-id');assert.equal(n.items.length,1);assert.equal(n.items[0].id,'new');assert.equal(n.items[0].qty,3);assert.equal(sum(n),3);
});
test('unlocking one merges back and removes exhausted stacks without zero quantities',()=>{
 let c=cfg([item('unlocked',2),item('locked',2,true)]);c=transferOne(c,'locked',false,'new');assert.deepEqual(c.items.map(a=>[a.id,a.qty,a.locked]),[['unlocked',3,false],['locked',1,true]]);
 c=transferOne(c,'locked',false,'unused');assert.equal(c.items.length,1);assert.equal(c.items[0].id,'unlocked');assert.equal(c.items[0].qty,4);
});
test('stacking ignores names, input ordering of cells/traits and absent false state',()=>{
 const a=item('first',2),b=item('second',3);a.shape=[[0,0],[1,0]];b.shape=[[2,1],[1,1]];a.traits=['left','top'];b.traits=['top','left'];delete b.required;
 const n=stackInventory(cfg([a,b]));assert.equal(n.items.length,1);assert.equal(n.items[0].qty,5);assert.equal(n.items[0].name,'first');assert.deepEqual(n.items[0].aliases,['second']);assert.deepEqual(stackInventory(n),n);
});
test('different states, shapes, attributes, traits, types and extensions do not merge',()=>{
 const a=item('a'),b={...item('b'),locked:true},c={...item('c'),base:[-19,4,13]},d={...item('d'),shape:[[0,0],[1,0]]},e={...item('e'),traits:['negative']},f={...item('f'),effect:'special'},g={...item('g'),type:'node',shape:[[0,0],[1,0]]};assert.equal(stackInventory(cfg([a,b,c,d,e,f,g])).items.length,7);
});
test('large identical inventories stack up to total cap with no count loss',()=>{
 const c=cfg([item('a',50),item('b',50)]);const n=stackInventory(c);assert.equal(n.items[0].qty,100);assert.equal(n.items.length,1);assert.doesNotThrow(()=>validate(n));const split=transferOne(n,'a',true,'new');assert.equal(sum(split),100);assert.equal(split.items.find(a=>a.locked).qty,1);
});
test('automatic names increase after merges and deletions and reserve imported names',()=>{
 const c=cfg([{...item('old'),name:'#7'}]);assert.equal(assignItemName(c,''),'#8');assert.equal(assignItemName(c,'   '),'#9');c.items=[];assert.equal(assignItemName(c,''),'#10');assert.equal(assignItemName(c,'custom name'),'custom name');assert.equal(assignItemName(c,'#20'),'#20');assert.equal(assignItemName(c,''),'#21');
 c.items=[{...item('merged'),name:'label',aliases:['#30']}];assert.equal(assignItemName(c,''),'#31');const restored=JSON.parse(JSON.stringify(c));assert.equal(assignItemName(restored,''),'#32');
});
test('legacy loading merges in memory, preserves exact stored bytes and creates a backup on saving',()=>{
 const old=cfg([item('a',3),item('b',2)]),raw=JSON.stringify(old,null,2),m=new Map([[STORAGE_KEY,raw]]),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};const n=loadSavedConfig(storage);assert.equal(n.items.length,1);assert.equal(n.items[0].qty,5);assert.equal(storage.getItem(STORAGE_KEY),raw);saveConfig(storage,n);assert.equal(storage.getItem(UPGRADE_BACKUP_KEY),raw);assert.equal(loadSavedConfig(storage).items[0].qty,5);
});
test('invalid transitions are atomic and numeric optimization excludes the transferred copy',()=>{
 const c=cfg([item('a',3)]),raw=JSON.stringify(c);assert.throws(()=>transferOne(c,'missing',true,'new'));assert.throws(()=>transferOne(c,'a',true,'a'));assert.throws(()=>transferOne(c,'a',false,'new'));assert.equal(JSON.stringify(c),raw);
 const n=transferOne(c,'a',true,'locked'),r=solve(n,{...steady(),random:()=>.5});assert.equal(r.proven,true);assert.equal(r.placements.length,0);assert.equal(r.best,0);assert.equal(n.items.find(a=>a.id==='locked').locked,true);
});

test('locking by hand or in a batch clears 必选; old manualLock marks are retired', async () => {
  const {transferOne, lockResultItems} = await import('../src/core/inventory.js');
  const {defaultRules, defaultCustom} = await import('../src/core/engine.js');
  const base = {version: 1, board: {w: 3, h: 1, cells: [true, true, true]}, rules: {...defaultRules}, optional: true, target: 0, custom: defaultCustom(),
    items: [{id: 'a', name: 'a', type: 'module', base: [1, 0, 0], traits: [], shape: [[0, 0]], qty: 3, required: true, manualLock: true}]};
  const s0 = stackInventory(base);
  assert.equal(s0.items[0].manualLock, undefined);
  assert.equal(s0.items[0].required, true);
  const hand = transferOne(s0, 'a', true, 'x');
  assert.equal(hand.items.find(i => i.locked).required, false);
  assert.equal(hand.items.find(i => !i.locked).required, true);
  const batch = lockResultItems(s0, [{itemId: 'a', instance: 'a:1'}], () => 'y');
  assert.equal(batch.items.find(i => i.locked).required, false);
  // A locked entry can never carry 必选, even if imported that way.
  assert.equal(stackInventory({...base, items: [{...base.items[0], locked: true, required: false}]}).items[0].required, false);
});
