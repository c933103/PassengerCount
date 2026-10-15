import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {mergeNativeTrack}=await import(pathToFileURL(resolve(process.env.PC_SOURCE_DIR || process.cwd(), 'native-track.js')));
let seed=0x15a5c0de;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const width=40, scale=10n**BigInt(width);
// Independent generated-data oracle: UTC whole seconds and full decimal tail.
function oracle(s){
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(s);
 if(!m||Number(m[2])!==2||Number(m[3])<28||Number(m[3])>29)return null;
 const offset=m[8]==='Z'?0:(m[9]==='+'?1:-1)*(Number(m[10])*60+Number(m[11]));
 return BigInt(Date.UTC(...[m[1],Number(m[2])-1,m[3],m[4],m[5],m[6]].map(Number))/1000-offset*60)*scale+BigInt((m[7]||'').padEnd(width,'0'));
}
function spelling(second,fraction,offset){
 const local=new Date(second*1000+offset*60000).toISOString().slice(0,19);
 const sign=offset<0?'-':'+';const abs=Math.abs(offset);
 return local+(fraction?'.'+fraction:'')+(offset===0?'Z':`${sign}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`);
}
const base=Date.UTC(2024,1,29,0,0,0)/1000;
const offsets=[0,480,-300,330,345];
const fractions=['','5','5000','5000000000','5001234566','5001234567','5001234568','000000000000000000001','123456789012345678901234567890'];
const malformed=['2027','2024-02-30T00:00:00Z','2024-02-29T00:00:00.500z','not-a-timestamp'];
let cases=0,points=0;
for(let trial=0;trial<1500;trial++){
 const records=fractions.map((fraction,i)=>({nativeId:`valid-${i}`,nativeOrder:Math.floor(random()*5),lat:22+i/1000,lng:114,accuracy:4,speed:2,heading:30,source:'gps',time:spelling(base+(i<4?0:Math.floor(random()*3)-1),fraction,offsets[Math.floor(random()*offsets.length)])}));
 malformed.forEach((time,i)=>records.push({nativeId:`invalid-${i}`,nativeOrder:Math.floor(random()*5),lat:23+i/1000,lng:114,accuracy:4,speed:2,heading:30,source:'gps',time}));
 shuffle(records);const cut=1+Math.floor(random()*(records.length-1));const retained=records.slice(0,cut),incoming=records.slice(cut);
 const original=JSON.stringify([retained,incoming]);const merged=mergeNativeTrack(retained,incoming);
 assert.equal(JSON.stringify([retained,incoming]),original);
 assert.equal(merged.length,records.length);
 const expected=records.filter(p=>oracle(p.time)!==null).map((p,i)=>({p,i,k:oracle(p.time)})).sort((a,b)=>a.k<b.k?-1:a.k>b.k?1:a.p.nativeOrder-b.p.nativeOrder||a.i-b.i).map(x=>x.p);
 const actual=merged.filter(p=>oracle(p.time)!==null);
 assert.deepEqual(actual,expected,`valid total order trial ${trial}`);
 records.forEach((p,i)=>{if(oracle(p.time)===null)assert.deepEqual(merged[i],p,`invalid slot ${trial}/${i}`);});
 assert.deepEqual(mergeNativeTrack(merged,incoming),merged,`idempotence trial ${trial}`);
 cases++;points+=records.length;
}
console.log(`PASS: ${cases} deterministic mixed-source permutations; ${points} points checked; exact chronological order, stable equal-instant journal ties, malformed slots/data, unchanged inputs and replay idempotence.`);
console.log('Seed=0x15a5c0de; 5 offsets, 9 fractional spellings through 30 digits, 4 malformed forms; BigInt only in independent host oracle. No production/gate change.');
