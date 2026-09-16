import test from'node:test';import assert from'node:assert/strict';import{hkClock,serviceStatus,variants,emptyRow,onboardValues,nearestStops,makeCSV}from'../core.js';
const data={serviceDayMap:{wd:['0','1','1','1','1','1','0'],sun:['1','0','0','0','0','0','0'],all:['1','1','1','1','1','1','1']},holidays:['20260916']};
test('Hong Kong clock',()=>assert.deepEqual(hkClock(new Date('2026-09-15T17:00Z')).date,'2026-09-16'));
test('running and upcoming services',()=>{const r={freq:{wd:{'0800':null}},jt:'60'};assert.equal(serviceStatus(r,data,new Date('2026-09-15T00:45Z')).kind,'active');assert.equal(serviceStatus(r,data,new Date('2026-09-14T23:40Z')).kind,'upcoming')});
test('overnight and holidays',()=>{assert.equal(serviceStatus({freq:{wd:{'2410':null}},jt:'30'},data,new Date('2026-09-18T16:20Z')).kind,'active');assert.equal(serviceStatus({freq:{sun:{'0800':null}},jt:'30'},data,new Date('2026-09-16T00:10Z')).kind,'active')});
test('operator variants',()=>{const d={routeList:{a:{route:'1',stops:{kmb:['a'],ctb:['b']},bound:{kmb:'O',ctb:'I'}}}};assert.equal(variants(d,'1').length,2);assert.deepEqual(variants(d,'1','ctb')[0].stopIds,['b'])});
test('backward counts survive reload',()=>{const r=Array.from({length:4},emptyRow);r[1].boarding='3';r[2].onboard='10';r[2].alighting='2';assert.deepEqual(onboardValues(JSON.parse(JSON.stringify(r))),[9,12,10,null]);r[1].boarding='5';assert.deepEqual(onboardValues(r),[7,12,10,null])});
test('GPS keeps repeated stops',()=>{const s=[{lat:22.3,lng:114.1},{lat:22.31,lng:114.1},{lat:22.3,lng:114.1}];assert.deepEqual(nearestStops(s,{lat:22.3,lng:114.1}).map(x=>x.index),[0,2,1])});
test('CSV preserves zeros and prevents formulas',()=>{const s={surveyor:'x',date:'2026-09-15',vehicle:'v',notes:'=x',startIndex:0,route:{route:'1',operator:'kmb',direction:'O',key:'a'},stops:[{id:'a',sequence:1,name:{zh:'甲',en:'A'}}],rows:[{time:'',boarding:'0',alighting:'0',onboard:'0',notes:''}]};const c=makeCSV(s);assert.match(c,/0,0,0,0,entered/);assert.match(c,/'=x/)});
test('legacy schedules also retain the ten-minute grace period at the exact boundary',()=>{
 const route={freq:{wd:{'1200':null}},jt:'120'};
 assert.equal(serviceStatus(route,data,new Date('2026-09-15T06:10:00Z')).kind,'active');
 assert.equal(serviceStatus(route,data,new Date('2026-09-15T06:10:01Z')).kind,'inactive');
});
