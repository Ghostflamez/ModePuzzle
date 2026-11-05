import {solve} from './engine.js';
self.onmessage=({data})=>{try{const result=solve(data.config,{limitMs:data.limitMs||Infinity,onProgress:r=>self.postMessage(r)});self.postMessage(result);}catch(e){self.postMessage({error:e.message});}};
