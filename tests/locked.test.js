import {steady} from './clock.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {solve,defaultRules,defaultCustom,validate,migrateConfig,SELECTION_VERSION} from '../src/core/engine.js';
import {transferOne,lockResultItems,unlockAllItems,stackInventory} from '../src/core/inventory.js';
import {loadSavedConfig,saveConfig,STORAGE_KEY} from '../src/core/storage.js';
const item=(id,base=[0,0,0],qty=1,locked=false,required=false)=>({id,name:id,base,qty,shape:[[0,0]],type:'module',traits:[],locked,required});
const cfg=(items,w=3)=>({version:1,selectionVersion:SELECTION_VERSION,board:{w,h:1,cells:Array(w).fill(true)},items,rules:{...defaultRules},optional:true,target:0,custom:defaultCustom()});
function check(c,r){if(!r.feasible)return;for(const a of c.items){const n=r.placements.filter(p=>p.itemId===a.id).length;if(a.locked)assert.equal(n,0);else if(a.required||!c.optional)assert.equal(n,a.qty);}}
const run=c=>solve(c,{...steady(),random:()=>.5,onProgress:r=>check(c,r)});
test('locked high-scoring stock is excluded while an all-negative required piece is included',()=>{
 const c=cfg([item('excluded',[1000,1000,1000],1,true),item('must',[-10,-20,-30],1,false,true),item('skip',[-5,0,0])]);const r=run(c);assert.equal(r.proven,true);assert.deepEqual(r.layout.total,[-10,-20,-30]);assert.equal(r.placements.length,1);check(c,r);
});
test('locks exclude even when redundancy is disabled, never occupy board space',()=>{
 const c=cfg([item('excluded',[1000,0,0],100,true)],1);c.optional=false;const r=run(c);assert.equal(r.proven,true);assert.equal(r.feasible,true);assert.equal(r.best,0);assert.equal(r.placements.length,0);
 const d=cfg([item('excluded',[1000,0,0],3,true),item('ordinary',[10,0,0])],1);d.optional=false;assert.equal(run(d).best,10);
});
test('single lock excludes just one copy; unlock restores eligibility',()=>{
 const c=cfg([item('a',[10,0,0],3)]);const n=transferOne(c,'a',true,'excluded');assert.equal(n.items.find(a=>a.id==='a').qty,2);assert.equal(run(n).best,20);const restored=transferOne(n,'excluded',false,'unused');assert.equal(restored.items.length,1);assert.equal(run(restored).best,30);
});
test('locking one required copy clears required only on that copy',()=>{
 const c=cfg([item('must',[-10,0,0],3,false,true)]),n=transferOne(c,'must',true,'excluded');assert.equal(n.items.find(a=>a.id==='must').required,true);assert.equal(n.items.find(a=>a.id==='excluded').required,false);const r=run(n);assert.equal(r.best,-20);check(n,r);
});
test('result batch lock transfers exactly used quantities and merges existing excluded stock',()=>{
 const c=cfg([item('a',[10,0,0],4),item('old',[10,0,0],2,true)],2),r=run(c);assert.equal(r.placements.length,2);const n=lockResultItems(c,r.placements,()=> 'split');assert.equal(n.items.find(a=>a.id==='a').qty,2);assert.equal(n.items.find(a=>a.id==='old').qty,4);assert.equal(n.items.reduce((s,a)=>s+a.qty,0),6);assert.equal(run(n).best,20);
 const all=lockResultItems(cfg([item('must',[-10,0,0],1,false,true)],1),[{itemId:'must',instance:'must:1'}],()=> 'unused');assert.equal(all.items[0].locked,true);assert.equal(all.items[0].required,false);assert.equal(run(all).best,0);
});
test('unlock all preserves other required markers and does not restore old required intent on excluded copies',()=>{
 const c=cfg([item('excluded',[10,0,0],1,true),item('must',[-1,0,0],1,false,true)]),n=unlockAllItems(c);assert.ok(n.items.every(a=>!a.locked));assert.equal(n.items.find(a=>a.id==='must').required,true);assert.equal(n.items.find(a=>a.id==='excluded').required,false);
});
test('conflicting flags and stale batch results are rejected atomically',()=>{
 const c=cfg([item('a',[10,0,0])]);assert.throws(()=>validate(cfg([item('bad',[1,0,0],1,true,true)])));assert.throws(()=>validate(cfg([{...item('bad'),locked:'true'}])));
 const before=JSON.stringify(c);for(const ps of [[{itemId:'missing',instance:'missing:1'}],[{itemId:'a',instance:'a:2'}],[{itemId:'a',instance:'a:1'},{itemId:'a',instance:'a:1'}]])assert.throws(()=>lockResultItems(c,ps,()=> 'new'));assert.equal(JSON.stringify(c),before);
});
test('legacy mixed markers remain required with a review notice; explicit old positional locks convert to excluded quantities',()=>{
 const c=cfg([item('a',[10,0,0],3,false,true)]);delete c.selectionVersion;c.lockedPlacements=[{itemId:'a',instance:'a:2',cells:[1],rotation:0,flipped:false}];const original=JSON.stringify(c),n=migrateConfig(c);assert.equal(n.legacySelectionReview,true);assert.equal(n.selectionVersion,SELECTION_VERSION);assert.equal(n.lockedPlacements,undefined);assert.equal(n.items.find(a=>a.required).qty,2);assert.equal(n.items.find(a=>a.locked).qty,1);assert.equal(JSON.stringify(c),original);assert.equal(run(n).placements.length,2);
 const ordinary=cfg([item('b',[0,0,0],1,false,true)]);assert.equal(migrateConfig(ordinary).legacySelectionReview,undefined);
});
test('independent required/locked states survive storage, JSON and stacking',()=>{
 const c=cfg([item('normal',[10,0,0]),item('must',[10,0,0],1,false,true),item('excluded',[10,0,0],1,true)]);assert.equal(stackInventory(c).items.length,3);const m=new Map(),s={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};saveConfig(s,c);const raw=s.getItem(STORAGE_KEY);assert.deepEqual(loadSavedConfig(s).items,c.items);assert.equal(s.getItem(STORAGE_KEY),raw);const restored=migrateConfig(JSON.parse(JSON.stringify({config:c,result:run(c)})).config);check(restored,run(restored));
});
test('custom bounds and timed progress never use excluded stock',()=>{
 const c=cfg([item('excluded',[100,0,0],1,true),item('must',[-10,0,0],1,false,true)]);c.target='custom';c.custom.bounds[0].min=0;const r=run(c);assert.equal(r.proven,true);assert.equal(r.feasible,false);
 let t=0;const timed=solve(c,{limitMs:45,now:()=>t+=10,onProgress:r=>check(c,r)});check(c,timed);
});
