import {normalize,validate,SELECTION_VERSION} from './engine.js';
import {tl} from '../i18n/index.js';

// Names and IDs identify entries; gameplay properties determine stack equality.
// `sources` lists the save uniqueId of each copy (one per qty) and never splits a stack.
// Required and excluded are independent state dimensions; names do not affect equality.
export function stackKey(item){
 const extra=Object.fromEntries(Object.entries(item).filter(([k])=>!['id','name','qty','aliases','sources','required','locked','shape','traits'].includes(k)).sort(([a],[b])=>a.localeCompare(b)));
 return JSON.stringify({...extra,shape:normalize(item.shape),traits:[...item.traits].sort(),required:item.required===true,locked:item.locked===true});
}
export function stackInventory(input){
 validate(input);const next=structuredClone(input),groups=new Map(),items=[],mapping=new Map();
 // Locking (by hand or in a batch) always drops 必选; manualLock is a retired mark from an earlier build.
 for(const item of next.items){delete item.manualLock;if(item.locked)item.required=false;}
 for(const item of next.items){
  const key=stackKey(item),target=groups.get(key);
  if(!target){groups.set(key,item);items.push(item);for(let i=1;i<=item.qty;i++)mapping.set(`${item.id}:${i}`,{itemId:item.id,instance:`${item.id}:${i}`});continue;}
  const offset=target.qty;
  for(let i=1;i<=item.qty;i++)mapping.set(`${item.id}:${i}`,{itemId:target.id,instance:`${target.id}:${offset+i}`});
  target.qty+=item.qty;
  if(target.sources||item.sources)target.sources=[...(target.sources||[]),...(item.sources||[])];
  const aliases=[...new Set([...(target.aliases||[]),item.name,...(item.aliases||[])])].filter(name=>name!==target.name);
  if(aliases.length)target.aliases=aliases;
 }
 next.items=items;next.selectionVersion=SELECTION_VERSION;
 if(next.lockedPlacements)next.lockedPlacements=next.lockedPlacements.map(l=>({...l,...mapping.get(l.instance)}));
 return validate(next);
}
// One transactional move: source -1, opposite-state destination +1.
export function transferOne(input,itemId,locked,newId){
 validate(input);const next=structuredClone(input),source=next.items.find(a=>a.id===itemId);
 if(!source)throw Error(tl('找不到该插入件'));
 if(typeof locked!=='boolean'||(source.locked===true)===locked)throw Error(tl('该插入件已处于目标锁定状态'));
 if(source.qty===1){next.items.splice(next.items.indexOf(source),1);source.locked=locked;if(locked)source.required=false;next.items.push(source);return stackInventory(next);}
 const movedSources=source.sources?[source.sources.pop()]:undefined;
 if(typeof newId!=='string'||!newId||next.items.some(a=>a.id===newId))throw Error(tl('新条目 ID 无效'));
 const moved={...structuredClone(source),id:newId,qty:1,locked,required:locked?false:source.required===true,...(movedSources?{sources:movedSources}:{})};
 source.qty--;next.items.push(moved);return stackInventory(next);
}
export function lockResultItems(input,placements,newId){
 validate(input);const next=structuredClone(input),counts=new Map(),seen=new Set();
 for(const p of placements){const item=next.items.find(a=>a.id===p.itemId);
  if(!item||item.locked||seen.has(p.instance)||!Array.from({length:item.qty},(_,i)=>`${item.id}:${i+1}`).includes(p.instance))throw Error(tl('优化结果与当前候选件不一致，请重新计算'));
  seen.add(p.instance);counts.set(item.id,(counts.get(item.id)||0)+1);
 }
 const moved=[];for(const item of next.items){const n=counts.get(item.id)||0;if(!n)continue;
  if(n===item.qty){moved.push({...structuredClone(item),locked:true,required:false});item.qty=0;continue;}
  const id=newId();if(!id||next.items.some(a=>a.id===id)||moved.some(a=>a.id===id))throw Error(tl('新条目 ID 无效'));
  const split=item.sources?{sources:item.sources.splice(item.sources.length-n,n)}:{};
  moved.push({...structuredClone(item),id,qty:n,locked:true,required:false,...split});item.qty-=n;
 }
 next.items=next.items.filter(a=>a.qty>0).concat(moved);return stackInventory(next);
}
export function unlockAllItems(input){const next=structuredClone(input);for(const item of next.items)if(item.locked)item.locked=false;return stackInventory(next);}
// Keep a monotonic counter even after deletion or merging. Existing #N names
// (including aliases retained from merged entries) reserve their numbers.
export function assignItemName(config,text){
 let next=config.nextAutoName??1;
 for(const item of config.items)for(const name of [item.name,...(item.aliases||[])]){
  const match=/^#([1-9]\d*)$/.exec(name);if(match){const n=Number(match[1]);if(Number.isSafeInteger(n)&&n<Number.MAX_SAFE_INTEGER)next=Math.max(next,n+1);}
 }
 const name=text.trim();
 if(name){const match=/^#([1-9]\d*)$/.exec(name);if(match){const n=Number(match[1]);if(Number.isSafeInteger(n)&&n<Number.MAX_SAFE_INTEGER)config.nextAutoName=Math.max(next,n+1);}return name;}
 if(!Number.isSafeInteger(next)||next<1||next>=Number.MAX_SAFE_INTEGER)throw Error(tl('自动名称编号已超出范围'));
 config.nextAutoName=next+1;return`#${next}`;
}
