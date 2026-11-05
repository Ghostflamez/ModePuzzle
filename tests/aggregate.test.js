import {steady} from './clock.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,solve,generatePlacements,defaultRules,defaultCustom,migrateConfig,SCORING_VERSION,SELECTION_VERSION} from '../src/core/engine.js';
const item=(id,base,traits=[],type='module',shape=[[0,0]],qty=1)=>({id,name:id,base,traits,type,shape,qty});
const node=(id='n')=>item(id,[0,0,0],[],'node',[[0,0],[1,0]]);
const cfg=(items,w=4,h=1)=>({version:1,board:{w,h,cells:Array(w*h).fill(true)},items,rules:{...defaultRules},optional:false,target:0,custom:defaultCustom()});
function at(c,a,x,y){const p=generatePlacements(c.board,a,c.rules).find(p=>p.x===x&&p.y===y&&p.rotation===0&&!p.flipped);assert.ok(p);return{item:a,p,instance:a.id};}
test('node sums signed raw bases, rounds each axis separately and can cross zero',()=>{
 const a=item('a',[6,-6,19]),b=item('b',[-4,4,19]),n=node(),c=cfg([a,n,b]);
 const e=evaluate([at(c,a,0,0),at(c,n,1,0),at(c,b,3,0)],c.rules);
 assert.deepEqual(e.rows[1].absorptionBase,[2,-2,38]);assert.deepEqual(e.rows[1].absorbed,[0,0,7]);assert.deepEqual(e.total,[2,-2,45]);
 assert.deepEqual(evaluate([at(c,b,3,0),at(c,n,1,0),at(c,a,0,0)],c.rules).total,e.total);
});
// Game (ModuleEffectHelper): receiver = base * (10 * nodes) / 100, truncated once.
test('negative feedback sums only module negatives; receiver scales with node count and rounds once',()=>{
 const a=item('a',[-19,100,-3]),b=item('b',[-19,-19,-3]),r=item('r',[19,-19,4],['negative','receiver']),n=node(),c=cfg([a,b,r,n],5,3);
 const e=evaluate([at(c,a,0,1),at(c,b,2,1),at(c,r,1,1),at(c,n,1,0)],c.rules),row=e.rows[2];
 assert.deepEqual(row.absorptionBase,[-38,-19,-6]);assert.deepEqual(row.absorbed,[-9,-4,-1]);assert.deepEqual(row.receiver,[1,-1,0]);assert.deepEqual(row.total,[11,-24,3]);
 const n2=node('n2'),c2=cfg([r,n,n2],5,3),e2=evaluate([at(c2,r,1,1),at(c2,n,1,0),at(c2,n2,1,2)],c2.rules);
 assert.deepEqual(e2.rows[0].receiver,[3,-3,0]);assert.equal(e2.rows[0].receiverNodes,2);assert.deepEqual(e2.rows[0].absorbed,[0,0,0]);
});
test('different nodes round their own sums; duplicate shared sides do not duplicate sources',()=>{
 const a=item('a',[19,-19,4],[], 'module',[[0,0],[1,0]]),n=node(),n2=node('n2'),c=cfg([a,n,n2],3,3);
 const e=evaluate([at(c,a,0,1),at(c,n,0,0),at(c,n2,0,2)],c.rules);
 assert.deepEqual(e.rows[1].absorbed,[3,-3,0]);assert.deepEqual(e.rows[2].absorbed,[3,-3,0]);assert.equal(e.rows[1].links.length,1);
});
test('exact fractions round aggregated absorption at integer boundaries',()=>{
 const a=item('a',[2.5,-2.5,0.1]),b=item('b',[2.5,-2.5,4.9]),n=node(),c=cfg([a,n,b]);
 const row=evaluate([at(c,a,0,0),at(c,n,1,0),at(c,b,3,0)],c.rules).rows[1];assert.deepEqual(row.absorbed,[1,-1,1]);
});
test('optimizer finds newly feasible aggregate score with custom exact bounds',()=>{
 const a=item('a',[19,-19,4],[], 'module',[[0,0]],2),n=node(),c=cfg([a,n]);c.target='custom';c.custom.bounds[0]={min:45,max:45,tolerance:false};
 const r=solve(c,{...steady(),random:()=>.5});assert.equal(r.proven,true);assert.equal(r.feasible,true);assert.deepEqual(r.layout.total,[45,-45,9]);assert.equal(r.best,45);assert.ok(r.upperBound>=45);
});
// An independent arithmetic scorer: no engine scoring or adjacency helpers.
// All generated inputs are integers; exact integer numerators / 100 suffice.
// Mirrors the game's integer code: temp = base; each mount adds base*20/100;
// receiver adds base*(10*nodes)/100; negative feedback adds sum(neg)/4; node temp = sum/5.
function direct(c,l){const touching=(a,b)=>a.p.cells.some(x=>b.p.cells.some(y=>Math.abs(x%c.board.w-y%c.board.w)+Math.abs(Math.floor(x/c.board.w)-Math.floor(y/c.board.w))===1));return[0,1,2].map(k=>l.reduce((total,a)=>{
 const b=a.item.base[k],has=t=>a.item.type==='module'&&a.item.traits.includes(t);
 const mounts=(has('left')&&a.p.left?1:0)+(has('top')&&a.p.top?1:0);
 let raw=0,nodes=0;for(const x of l){if(x===a||!touching(a,x))continue;if(x.item.type==='module'){if(a.item.type==='node')raw+=x.item.base[k];else if(has('negative'))raw+=Math.min(0,x.item.base[k]);}else if(has('receiver'))nodes++;}
 const own=a.item.type==='node'?0:b+mounts*Math.trunc(b*c.rules.mount/100)+Math.trunc(b*c.rules.receiver*nodes/100);
 return total+own+Math.trunc(raw*(a.item.type==='node'?c.rules.nodeAbsorb:c.rules.negativeAbsorb)/100);
},0));}
function brute(c){const pieces=c.items.flatMap(a=>Array.from({length:a.qty},(_,i)=>({item:a,instance:a.id+i,ps:generatePlacements(c.board,a,c.rules)})));let best=null;const p=c.target==='custom'?c.custom.primary:c.target,s=c.target==='custom'?c.custom.secondary:null;
 function visit(i,mask,l){if(i===pieces.length){const t=direct(c,l);if(c.target==='custom'&&!c.custom.bounds.every((b,k)=>(b.min===null||t[k]>=b.min)&&(b.max===null||t[k]<=b.max)))return;if(best===null||t[p]>best[p]||(t[p]===best[p]&&s!==null&&t[s]>best[s]))best=t;return;}const a=pieces[i];if(c.optional)visit(i+1,mask,l);for(const placement of a.ps)if(!(mask&placement.mask))visit(i+1,mask|placement.mask,[...l,{item:a.item,p:placement,instance:a.instance}]);}
 visit(0,0n,[]);return best;
}
test('search increments and signed pruning agree with independent aggregate oracle',()=>{
 let seed=48215;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/2**32);
 for(let i=0;i<20;i++){
  const bases=()=>Array.from({length:3},()=>Math.floor(random()*39)-19),a=item('a',bases(),['negative','receiver','top'], 'module',[[0,0]],i%5===0?2:1),b=item('b',bases(),['negative','left']),n=node();const c=cfg([a,b,n],3,2);c.optional=i%2===0;c.rules.nodeAbsorb=[20,25,33][i%3];c.rules.negativeAbsorb=[25,15,40][i%3];c.rules.tempBase=i%4===0?'boosted':'raw';
  c.target=i%4===0?i%3:'custom';c.custom.primary=i%3;c.custom.secondary=(i+1)%3;if(c.target==='custom'&&i%3===0)c.custom.bounds[(i+2)%3]={min:-15,max:12,tolerance:false};
  const expected=brute(c);const r=solve(c,{...steady(),random,onProgress:r=>{if(r.layout){assert.equal(r.best,r.layout.total[c.target==='custom'?c.custom.primary:c.target]);}}});
  assert.equal(r.proven,true,`case ${i} not proven`);assert.equal(r.feasible,expected!==null,`case ${i} feasible`);
  if(expected){const p=c.target==='custom'?c.custom.primary:c.target;assert.equal(r.best,expected[p],`case ${i} primary`);if(c.target==='custom')assert.equal(r.layout.total[c.custom.secondary],expected[c.custom.secondary],`case ${i} secondary`);const l=r.layout.rows.map(row=>({item:c.items.find(a=>a.id===row.itemId),p:{cells:row.cells,left:row.left,top:row.top}}));assert.deepEqual(r.layout.total,direct(c,l),`case ${i} scored layout`);assert.ok(r.upperBound>=r.best);assert.doesNotThrow(()=>JSON.stringify(r));}
 }
});
test('previous scoring config migrates without changing user entries',()=>{
 const c=cfg([item('a',[19,-19,4],['negative'], 'module',[[0,0]],3)]);c.scoringVersion='integer-per-neighbour-outer-edges-v2';const before=JSON.stringify(c),next=migrateConfig(c);assert.equal(next.scoringVersion,SCORING_VERSION);delete next.scoringVersion;const expected=JSON.parse(before);delete expected.scoringVersion;expected.selectionVersion=SELECTION_VERSION;assert.deepEqual(next,expected);assert.equal(JSON.stringify(c),before);
});

test('generation-time feedback boost is never applied twice, even with legacy switches',()=>{
 const a=item('a',[-68,0,56],['negative','top','receiver']),n=node(),b=item('b',[-19,0,-8]),c=cfg([a,n,b],4,3);
 const rules={...c.rules,negativeBoost:25,tempBase:'boosted'};
 const result=evaluate([at(c,a,0,0),at(c,n,1,0),at(c,b,0,1)],rules);
 assert.deepEqual(result.rows[0].self,[-81,0,67]);
 assert.deepEqual(result.rows[0].boost,[0,0,0]);
 assert.deepEqual(result.rows[0].receiver,[-6,0,5]);
 assert.deepEqual(result.rows[0].absorbed,[-4,0,-2]);
 assert.deepEqual(result.rows[1].absorbed,[-13,0,11]);
 c.rules=rules;const snapshot=structuredClone(c),m=migrateConfig(c);
 assert.deepEqual(c,snapshot);assert.deepEqual(m.items,c.items);
 assert.equal(m.rules.negativeBoost,undefined);assert.equal(m.rules.tempBase,undefined);
});
test('known nine-piece arrangement matches efficiency -296 and performance 266',()=>{
 const cells=[[1,2,7,8,9],[10,17],[22,23,24,29,31],[15,16],[14,21],[32,33],[18,25],[4,5,11,12],[13,19,20,26,27]];
 const bases=[[-55,0,45],[0,0,0],[-68,0,56],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,16],[-55,0,45]];
 const nodes=new Set([1,3,4,6]),board={w:7,h:5,cells:Array.from({length:35},(_,i)=>![0,6,28,34].includes(i))};
 const layout=cells.map((cs,i)=>{
  const coords=cs.map(c=>[c%7,Math.floor(c/7)]),mx=Math.min(...coords.map(c=>c[0])),my=Math.min(...coords.map(c=>c[1]));
  const a=item(String(i),bases[i],i===0?['left','top']:i===2?['negative']:[],nodes.has(i)?'node':'module',coords.map(([x,y])=>[x-mx,y-my]));
  const p=generatePlacements(board,a,defaultRules).find(p=>p.cells.length===cs.length&&p.cells.every(c=>cs.includes(c)));assert.ok(p);
  return{item:a,p,instance:String(i)};
 });
 assert.deepEqual(evaluate(layout,defaultRules).total,[-296,0,266]);
 // Do not silently fix a user's entered sign: +68 must remain +68.
 layout[2].item.base[0]=68;
 assert.deepEqual(evaluate(layout,defaultRules).total,[-56,0,266]);
});
