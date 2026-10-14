import test from 'node:test';
import assert from 'node:assert/strict';
import { scanWorldInfo } from '../src/planning/world-info.js';
const entry=(uid,content,extra={})=>({uid,content,key:[],keysecondary:[],constant:false,selective:false,order:100,position:0,probability:100,useProbability:true,...extra});
const make=(entries,text='森林',settings={})=>({history:[{role:'user',content:text}],character:{},bindings:{global:['B'],character:['B'],chat:[],persona:[]},books:{B:{entries:Object.fromEntries(entries.map(e=>[e.uid,e]))}},worldSettings:{world_info_recursive:true,...settings},maxContext:1000,macroEnvironment:{}});
const scan=(snapshot,selection={},previousState={})=>scanWorldInfo({snapshot,selection,previousState,tokenize:async s=>s.length,random:()=>0.5,now:0});

test('unclosed world-book keywords and content stay literal through activation and budgeting',async()=>{
    const content='资料 {{user}}\n例子 {{\n后续完整内容';
    const snapshot=make([entry(1,content,{key:['{{示例']})],'命中 {{示例');
    snapshot.macroEnvironment.user='玩家';const before=structuredClone(snapshot);
    const result=await scan(snapshot);
    assert.equal(result.entries.length,1);
    assert.equal(result.entries[0].content,'资料 玩家\n例子 {{\n后续完整内容');
    assert.match(result.native.worldInfoBefore,/后续完整内容/);
    assert.equal(result.diagnostics.some(d=>d.blocking),false);assert.deepEqual(snapshot,before);
});
test('native world scan keeps constants, keyword logic, recursion and disabled overrides independent',async()=>{
    const s=make([entry(1,'城堡',{constant:true}),entry(2,'精灵',{key:['森林'],keysecondary:['城堡'],selective:true,selectiveLogic:0}),entry(3,'未触发',{key:['海洋']}),entry(4,'排除',{constant:true})]);
    const before=structuredClone(s);
    const result=await scan(s,{entryOverrides:{'["B",4]':false}});
    assert.deepEqual(result.entries.map(e=>e.uid).sort(),[1,2]);
    assert.deepEqual(s,before);
});
test('probability and budget limits work; private timed state cannot mutate native state',async()=>{
    const s=make([entry(1,'常驻',{constant:true,sticky:2}),entry(2,'概率零',{constant:true,probability:0}),entry(3,'过长'.repeat(30),{constant:true})],'', {world_info_budget_cap:10});
    const prior={}; const result=await scan(s,{},prior);
    assert.deepEqual(result.entries.map(e=>e.uid),[1]);
    assert.deepEqual(prior,{});
    assert.ok(result.nextState.timedWorldInfo);
});
test('whole-word special characters are escaped and private sticky state survives advancing chat',async()=>{
    const s=make([entry(1,'state',{key:['c++'],matchWholeWords:true,sticky:2}),entry(2,'wrong',{key:['x.y'],matchWholeWords:true})],'c++ xay');
    const first=await scan(s);
    assert.deepEqual(first.entries.map(e=>e.uid),[1]);
    s.history.push({role:'assistant',content:'unrelated'});
    s.worldSettings.world_info_depth=1;
    const second=await scan(s,{},first.nextState);
    assert.deepEqual(second.entries.map(e=>e.uid),[1]);
});
test('secondary logic, depth and recursion exclusions follow the native scanner',async()=>{
    for(const [logic,secondary,want] of [[0,['red','blue'],true],[1,['red','blue'],true],[2,['red','blue'],false],[3,['red','blue'],false],[3,['red'],true]]){
        const result=await scan(make([entry(1,'hit',{key:['forest'],keysecondary:secondary,selective:true,selectiveLogic:logic})],'forest red'));
        assert.equal(result.entries.length>0,want,`logic ${logic}`);
    }
    const s=make([entry(1,'beacon',{constant:true}),entry(2,'yes',{key:['beacon']}),entry(3,'no',{key:['beacon'],excludeRecursion:true}),entry(4,'deep',{key:['old'],scanDepth:1})],'old');
    s.history.push({role:'user',content:'new'});
    assert.deepEqual((await scan(s)).entries.map(e=>e.uid).sort(),[1,2]);
});
