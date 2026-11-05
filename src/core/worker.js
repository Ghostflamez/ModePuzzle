import {solve} from './engine.js';
import {setLang} from '../i18n/index.js';
self.onmessage=({data})=>{try{if(data.lang)setLang(data.lang);const result=solve(data.config,{limitMs:data.limitMs||Infinity,onProgress:r=>self.postMessage(r)});self.postMessage(result);}catch(e){self.postMessage({error:e.message});}};
