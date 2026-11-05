import {steady} from './clock.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {solve,evaluate,generatePlacements,defaultRules,defaultCustom,validate,migrateConfig} from '../src/core/engine.js';
import {loadSavedConfig,saveConfig,STORAGE_KEY,UPGRADE_BACKUP_KEY} from '../src/core/storage.js';
const item=(id,base,required=false,qty=1,shape=[[0,0]],traits=[],type='module')=>({id,name:id,type,base,required,qty,shape,traits});
const cfg=(items,w=2,h=1)=>({version:1,board:{w,h,cells:Array(w*h).fill(true)},items,rules:{...defaultRules},optional:true,target:0,custom:defaultCustom()});
function checkRequired(c,r){if(!r.feasible)return;for(const a of c.items)if(a.required||!c.optional)assert.equal(r.placements.filter(p=>p.itemId===a.id).length,a.qty,`missing required ${a.id}`);}
const run=c=>solve(c,{...steady(),random:()=>.5,onProgress:r=>checkRequired(c,r)});
test('all-negative mandatory module is kept while optional negative modules can be omitted',()=>{
 const c=cfg([item('must',[-10,-20,-30],true),item('skip',[-5,-6,-7])]);let r=run(c);assert.equal(r.proven,true);assert.deepEqual(r.layout.total,[-10,-20,-30]);checkRequired(c,r);assert.equal(r.placements.length,1);
 c.items[0].required=false;r=run(c);assert.equal(r.best,0);assert.equal(r.placements.length,0);
});
test('mandatory wins over a higher scoring optional item when they compete for space',()=>{
 const c=cfg([item('must',[-10,-20,-30],true),item('high',[100,100,100])],1);const r=run(c);assert.equal(r.proven,true);assert.equal(r.best,-10);checkRequired(c,r);
});
test('every copy in a marked item is mandatory; global all-items mode still works',()=>{
 const c=cfg([item('must',[-10,0,0],true,2),item('skip',[-5,0,0])],3);let r=run(c);assert.equal(r.proven,true);assert.equal(r.best,-20);assert.equal(r.placements.length,2);checkRequired(c,r);
 c.optional=false;r=run(c);assert.equal(r.best,-25);assert.equal(r.placements.length,3);checkRequired(c,r);
});
test('impossible mandatory area or shape returns infeasible instead of dropping it',()=>{
 const c=cfg([item('must',[-1,0,0],true,2)],1);let r=run(c);assert.equal(r.proven,true);assert.equal(r.feasible,false);assert.equal(r.layout,null);
 const shape=cfg([item('must',[-1,0,0],true,1,[[0,0],[1,0]])],2,2);shape.board.cells=[true,false,false,true];r=run(shape);assert.equal(r.proven,true);assert.equal(r.feasible,false);
});
test('mandatory geometry conflicts remain infeasible even when total area fits',()=>{
 const c=cfg([item('must',[-1,0,0],true,2,[[0,0],[1,0]])],3,2);c.board.cells=[true,true,true,false,true,false];const r=run(c);assert.equal(r.proven,true);assert.equal(r.feasible,false);
});
test('custom bounds and priorities cannot remove mandatory items',()=>{
 const c=cfg([item('must',[-10,-5,-2],true),item('a',[15,10,0]),item('b',[15,20,0])]);c.target='custom';c.custom.bounds[0]={min:5,max:5,tolerance:false};let r=run(c);assert.equal(r.proven,true);assert.deepEqual(r.layout.total,[5,15,-2]);checkRequired(c,r);
 c.custom.bounds[0]={min:15,max:15,tolerance:false};r=run(c);assert.equal(r.proven,true);assert.equal(r.feasible,false);
});
test('time-limited results and progress never claim feasibility without mandatory copies',()=>{
 const c=cfg([item('must',[-10,0,0],true,2),item('optional',[100,0,0],false,2)],3,2);let time=0;
 const r=solve(c,{limitMs:45,now:()=>time+=10,random:()=>.5,onProgress:r=>checkRequired(c,r)});assert.equal(r.proven,false);checkRequired(c,r);
});
test('legacy inventory bytes are preserved and required flags survive config/result JSON imports',()=>{
 const c=cfg([item('must',[-10,-20,-30],true,2)]);const old=structuredClone(c);delete old.items[0].required;const raw=JSON.stringify(old,null,2),m=new Map([[STORAGE_KEY,raw]]),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};
 const loaded=loadSavedConfig(storage);assert.deepEqual(loaded.items,old.items);assert.equal(storage.getItem(STORAGE_KEY),raw);loaded.items[0].required=true;saveConfig(storage,loaded);assert.equal(storage.getItem(UPGRADE_BACKUP_KEY),raw);assert.equal(loadSavedConfig(storage).items[0].required,true);
 for(const payload of [c,{version:1,config:c,result:run(c)}]){const parsed=JSON.parse(JSON.stringify(payload));assert.deepEqual(migrateConfig(parsed.config||parsed).items,c.items);}
 for(const bad of ['true',1,null]){const broken=structuredClone(c);broken.items[0].required=bad;assert.throws(()=>validate(broken));}
});
function brute(c){const all=c.items.flatMap(a=>Array.from({length:a.qty},(_,i)=>({item:a,instance:a.id+i,ps:generatePlacements(c.board,a,c.rules)})));let best=null;const primary=c.target==='custom'?c.custom.primary:c.target,secondary=c.target==='custom'?c.custom.secondary:null;
 function visit(i,mask,l){if(i===all.length){const t=evaluate(l,c.rules).total;if(c.target==='custom'&&!c.custom.bounds.every((b,k)=>(b.min===null||t[k]>=b.min)&&(b.max===null||t[k]<=b.max)))return;if(!best||t[primary]>best[primary]||(t[primary]===best[primary]&&secondary!==null&&t[secondary]>best[secondary]))best=t;return;}const a=all[i];if(c.optional&&!a.item.required)visit(i+1,mask,l);for(const p of a.ps)if(!(mask&p.mask))visit(i+1,mask|p.mask,[...l,{...a,p}]);}visit(0,0n,[]);return best;}
test('mixed mandatory signed search matches exhaustive enumeration with duplicate items and absorption',()=>{
 let seed=721;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32),base=()=>Array.from({length:3},()=>Math.floor(random()*31)-20);
 for(let i=0;i<16;i++){
  const c=cfg([item('a',base(),true,i%4===0?2:1,[[0,0]],['negative','left']),item('b',base(),i%3===0,1,[[0,0]],['receiver','top']),item('n',[0,0,0],i%5===0,1,[[0,0],[1,0]],[],'node')],3,2);
  c.target=i%3===0?i%3:'custom';c.custom.primary=i%3;c.custom.secondary=(i+1)%3;if(i%3===1)c.custom.bounds[2]={min:-20,max:15,tolerance:false};
  const expected=brute(c),r=solve(c,{...steady(),random,onProgress:r=>checkRequired(c,r)});assert.equal(r.proven,true,`case ${i}`);assert.equal(r.feasible,expected!==null);checkRequired(c,r);
  if(expected){const p=c.target==='custom'?c.custom.primary:c.target;assert.equal(r.best,expected[p],`case ${i} primary`);if(c.target==='custom')assert.equal(r.layout.total[c.custom.secondary],expected[c.custom.secondary],`case ${i} secondary`);assert.ok(r.upperBound>=r.best);}
 }
});
