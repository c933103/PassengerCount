const vm=require('vm'), assert=require('assert/strict'), {execFileSync}=require('child_process'), path=require('path');
const repo=path.resolve(__dirname,'../..');
const source=execFileSync('git',['show','b9fe113aed0a1c6786b7aa5aeb5e9ce1389ae0d5:app.js'],{cwd:repo,encoding:'utf8'});
const start=source.indexOf('async function download()'), end=source.indexOf('\nfunction downloadGpx()',start);
assert.ok(start>=0 && end>start);
const handler=source.slice(start,end);
async function run({drainFails,mutate}) {
 const survey={id:'A',route:{route:'A1'},rows:[{boarding:1}]};const calls=[];let release;
 const e={csv:{disabled:false},exportStatus:{textContent:''},chart:{id:'chart-A'}};
 const ctx=vm.createContext({cur:()=>survey, $:id=>e[id], data:{}, t:x=>x,
   syncNativeTrack:()=>!drainFails,chartPng:()=>new Promise(r=>release=()=>r('chart-A')),
   makeExportBundle:(s,d,p)=>({folder:s.id,base:s.id,csv:JSON.stringify(s.rows),json:JSON.stringify(s),gpx:'gpx',pngBase64:p}),
   window:{PassengerCountAndroid:{saveBundle:(...x)=>calls.push(x)}},exportResult:result=>calls.push(result),
 });
 vm.runInContext(handler,ctx);const done=vm.runInContext('download()',ctx);
 if(mutate){survey.id='B';survey.rows[0].boarding=99;}
 release();await done;return {calls,csvDisabled:e.csv.disabled};
}
(async()=>{
 const failed=await run({drainFails:true});assert.equal(failed.calls.length,1);assert.equal(failed.calls[0][0],'A');
 console.log('REPRODUCED: failed acknowledged journal drain still calls native saveBundle.');
 const changed=await run({mutate:true});assert.equal(changed.calls[0][0],'B');assert.equal(changed.calls[0][5],'chart-A');
 console.log('REPRODUCED: mutating selected survey while chart decoder waits produces B JSON/name with A chart.');
 assert.equal(changed.csvDisabled,false);console.log('REPRODUCED: CSV control re-enabled immediately after native enqueue, before a native result.');
})();
