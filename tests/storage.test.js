import test from 'node:test';import assert from 'node:assert/strict';
import{loadSavedConfig,saveConfig,STORAGE_KEY,UPGRADE_BACKUP_KEY}from'../src/core/storage.js';
import{defaultRules,migrateConfig,SCORING_VERSION,SELECTION_VERSION}from'../src/core/engine.js';
const old={version:1,board:{w:2,h:2,cells:[true,true,true,false]},items:[{id:'user-entered',name:'用户原模组',type:'module',shape:[[0,0],[1,0]],base:[20,-15,6.5],traits:['negative'],qty:3}],rules:{...defaultRules,edge:'global'},optional:false,target:2};
function memory(entries=[]){const m=new Map(entries);return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};}
test('legacy load is non-destructive; inventory, counts, rules and board remain exact',()=>{const raw=JSON.stringify(old,null,2),s=memory([[STORAGE_KEY,raw]]);const c=loadSavedConfig(s);assert.equal(s.getItem(STORAGE_KEY),raw);assert.deepEqual(c.items,old.items);assert.deepEqual(c.board,old.board);assert.deepEqual(c.rules,old.rules);assert.equal(c.target,2);assert.equal(c.optional,false);assert.equal(c.custom.primary,0);assert.equal(s.getItem(UPGRADE_BACKUP_KEY),null);});
test('first update snapshots exact original bytes; subsequent updates retain backup',()=>{const raw=JSON.stringify(old,null,2),s=memory([[STORAGE_KEY,raw]]),c=loadSavedConfig(s);c.target='custom';c.custom.bounds[0].min=100;saveConfig(s,c);assert.equal(s.getItem(UPGRADE_BACKUP_KEY),raw);assert.deepEqual(loadSavedConfig(s).items,old.items);c.custom.primary=2;c.custom.secondary=0;saveConfig(s,c);assert.equal(s.getItem(UPGRADE_BACKUP_KEY),raw);assert.deepEqual(loadSavedConfig(s).custom,c.custom);});
test('invalid saved data and backup failures cannot overwrite old data',()=>{const s=memory([[STORAGE_KEY,'invalid raw data']]);assert.throws(()=>loadSavedConfig(s));assert.equal(s.getItem(STORAGE_KEY),'invalid raw data');const raw=JSON.stringify(old);let current=raw;const failure={getItem:k=>k===STORAGE_KEY?current:null,setItem:(k,v)=>{if(k===UPGRADE_BACKUP_KEY)throw Error('quota');current=v;}};assert.throws(()=>saveConfig(failure,loadSavedConfig(failure)));assert.equal(current,raw);});

test('legacy contour config migrates without changing inventory or any other settings',()=>{
 const legacy={...structuredClone(old),scoringVersion:'integer-per-neighbour-v1',custom:{primary:2,secondary:1,bounds:[{min:-70,max:100,tolerance:true},{min:null,max:50,tolerance:false},{min:10,max:null,tolerance:false}]}};
 legacy.rules.edge='contour';const raw=JSON.stringify(legacy,null,2),s=memory([[STORAGE_KEY,raw]]);
 const loaded=loadSavedConfig(s),imported=migrateConfig(JSON.parse(raw));
 const expected=structuredClone(legacy);expected.rules.edge='global';expected.scoringVersion=SCORING_VERSION;expected.selectionVersion=SELECTION_VERSION;
 // The retired ±5% tolerance is dropped; the bounds themselves stay as entered.
 for(const b of expected.custom.bounds)delete b.tolerance;
 assert.deepEqual(loaded,expected);assert.deepEqual(imported,expected);assert.equal(s.getItem(STORAGE_KEY),raw);
 saveConfig(s,loaded);assert.equal(s.getItem(UPGRADE_BACKUP_KEY),raw);assert.deepEqual(loadSavedConfig(s),expected);
 assert.equal(legacy.rules.edge,'contour');
});
