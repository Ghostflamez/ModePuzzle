import {steady} from './clock.js';
import test from 'node:test';import assert from 'node:assert/strict';
import{orientations,connected,generatePlacements,evaluate,solve,defaultRules,validate,adjacent}from'../src/core/engine.js';
const rules={...defaultRules};const board=(w,h)=>({w,h,cells:Array(w*h).fill(true)});
const item=(id,base=[0,0,0],traits=[],shape=[[0,0]],type='module',qty=1)=>({id,name:id,base,traits,shape,type,qty});
const conf=(b,items,optional=true)=>({version:1,board:b,items,rules,optional,target:0});
function at(b,i,x,y,r=rules){const p=generatePlacements(b,i,r).find(p=>p.x===x&&p.y===y&&p.rotation===0&&!p.flipped);assert.ok(p);return{item:i,p,instance:i.id};}
test('P has eight orientations; domino two; disconnected shapes rejected',()=>{assert.equal(orientations([[1,0],[0,1],[1,1],[0,2],[1,2]]).length,8);assert.equal(orientations([[0,0],[1,0]]).length,2);assert.equal(connected([[0,0],[1,1]]),false);});
test('31-cell board admits only fully contained placements',()=>{const b=board(7,5);[0,6,28,34].forEach(i=>b.cells[i]=false);const placements=generatePlacements(b,item('p',[0,0,0],[],[[1,0],[0,1],[1,1],[0,2],[1,2]]),rules);assert.ok(placements.length>50);placements.forEach(p=>assert.ok(p.cells.every(c=>b.cells[c])));});
test('raw reads: negative feedback does not leak, nodes read raw, receiver remains local',()=>{const b=board(5,2),a=item('a',[100,-20,10],['negative','left','top','receiver']),n=item('node',[0,0,0],[],[[0,0],[1,0]],'node'),c=item('c',[-40,60,-8],['negative']);const l=[at(b,a,0,0),at(b,n,1,0),at(b,c,0,1)];const e=evaluate(l,rules);assert.deepEqual(e.rows[0].total,[140,-30,13]);assert.deepEqual(e.rows[1].total,[20,-4,2]);assert.deepEqual(e.rows[2].total,[-40,55,-8]);assert.deepEqual(e.total,[120,21,7]);});
test('multiple shared sides count once; diagonal is not adjacent; node-node no absorption',()=>{const b=board(4,3),a=item('a',[100,0,0],[],[[0,0],[1,0]]),n=item('n',[0,0,0],[],[[0,0],[1,0]],'node');const e=evaluate([at(b,a,0,0),at(b,n,0,1)],rules);assert.equal(e.total[0],120);assert.equal(adjacent(at(b,item('x'),0,0).p,at(b,item('y'),1,1).p),false);// Game: a node's value is overwritten by its absorption, so its own base never counts.
 const n2={...n,id:'n2',base:[10,0,0]};assert.equal(evaluate([at(b,n2,0,0),at(b,n,0,1)],rules).total[0],0);});
test('mounts require outer large edges; cut-corner short edges and holes never trigger',()=>{
 const b=board(7,5);[0,6,28,34,17].forEach(i=>b.cells[i]=false);
 const a=item('a',[100,-55,45],['left','top']);
 // (x,y,left,top): all four cut corners, a hole, and the two real large edges.
 for(const [x,y,left,top] of [[1,0,false,true],[0,1,true,false],[5,0,false,true],[6,1,false,false],[0,3,true,false],[1,4,false,false],[6,3,false,false],[5,4,false,false],[4,2,false,false],[3,3,false,false],[0,2,true,false],[3,0,false,true]]){
  const placed=at(b,a,x,y);assert.equal(placed.p.left,left,`left at ${x},${y}`);assert.equal(placed.p.top,top,`top at ${x},${y}`);
  assert.deepEqual(evaluate([placed],rules).total,left||top?[120,-66,54]:[100,-55,45]);
 }
 // Legacy callers cannot re-enable incorrect contour geometry.
 assert.equal(at(b,a,1,0,{...rules,edge:'contour'}).p.left,false);
});
test('a connected module can touch both true large edges; each mount rounds separately',()=>{
 const b=board(7,5);[0,6,28,34].forEach(i=>b.cells[i]=false);
 const a=item('a',[100,0,0],['left','top'],[[1,0],[0,1],[1,1]]),p=at(b,a,0,0);
 assert.equal(p.p.left,true);assert.equal(p.p.top,true);
 assert.equal(evaluate([p],rules).total[0],140);
 const odd=item('b',[48,-58,0],['left','top'],[[1,0],[0,1],[1,1]]);
 assert.deepEqual(evaluate([at(b,odd,0,0)],rules).total,[66,-80,0]);
});
test('optimizer no longer awards double mounting on a cut corner',()=>{
 const b=board(3,3);b.cells[0]=false;
 const r=solve(conf(b,[item('a',[100,0,0],['left','top'])],false),{...steady()});
 assert.equal(r.proven,true);assert.equal(r.best,120);
});
// Independent, unpruned enumerator: validates the exact optimizer including
// optional subsets, symmetric repeated pieces and its upper-bound pruning.
function brute(config){let instances=config.items.flatMap(i=>Array.from({length:i.qty},(_,n)=>({item:i,instance:i.id+n,ps:generatePlacements(config.board,i,config.rules)})));let best=-Infinity;function rec(k,mask,l){if(k===instances.length){best=Math.max(best,evaluate(l,config.rules).total[config.target]);return;}const a=instances[k];if(config.optional)rec(k+1,mask,l);for(const p of a.ps)if(!(mask&p.mask))rec(k+1,mask|p.mask,[...l,{...a,p}]);}rec(0,0n,[]);return best;}
let seed=12345;const rng=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
test('exact search matches independent brute force across mixed signed / duplicate cases',()=>{for(let c=0;c<24;c++){const b=board(3,2),a=item('a',[Math.floor(rng()*16)-7,0,0],['negative','receiver','top','left'].filter(()=>rng()>.4),[[0,0]],'module',c%3===0?2:1),d=item('b',[Math.floor(rng()*16)-7,0,0],['negative','top']),n=item('n',[0,0,0],[],[[0,0],[1,0]],'node');const cfg=conf(b,[a,d,n],c%2===0);cfg.rules={...rules,stack:c%3===0?'multiply':'add',tempBase:c%4===0?'boosted':'raw'};const expected=brute(cfg),actual=solve(cfg,{...steady(),random:rng});assert.ok(actual.proven);assert.ok(Math.abs(actual.best-expected)<1e-8,`case ${c}: ${actual.best} != ${expected}`);}});
test('forced impossibility, optional empty optimum, and repeated quantities',()=>{const bad=conf(board(1,1),[item('a',[2,0,0],[],[[0,0],[1,0]])],false);assert.equal(solve(bad).feasible,false);const negative=conf(board(1,1),[item('a',[-10,0,0])]);assert.equal(solve(negative,{...steady()}).best,0);const repeated=conf(board(2,2),[item('a',[5,0,0],['top'],[[0,0]],'module',3)],false);const s=solve(repeated,{...steady()});assert.equal(s.best,17);assert.equal(s.layout.rows.length,3);});
test('imports reject unknown rules, duplicate IDs and disconnected shape',()=>{const c=conf(board(2,2),[item('a')]);assert.doesNotThrow(()=>validate(c));assert.throws(()=>validate({...c,items:[item('a'),item('a')]}));assert.throws(()=>validate({...c,items:[item('b',[0,0,0],[],[[0,0],[1,1]])]}));});
