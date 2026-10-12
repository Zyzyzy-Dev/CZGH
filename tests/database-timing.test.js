import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../src/host/planner.js';
import { captureSources } from '../src/host/sources.js';
import { buildPlanningContext } from '../src/planning/context.js';

// Model ST's awaited send stages and database naiv1.2.9's post-emit wait gates.
// This verifies our hook placement and fresh capture, not a live database API.
function setup(){
    const listeners=new Map(),events=['GENERATION_AFTER_COMMANDS','USER_MESSAGE_RENDERED','WORLDINFO_ENTRIES_LOADED','CHAT_COMPLETION_SETTINGS_READY','GENERATION_STOPPED','CHAT_CHANGED'];
    const eventSource={on:(name,fn)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),async emit(name,...args){for(const fn of listeners.get(name)||[])await fn(...args);}};
    const context={chatId:'c',chat:[{is_user:true,mes:'去港口找船长'}],chatMetadata:{world_info:['记忆']},extensionSettings:{},eventTypes:Object.fromEntries(events.map(x=>[x,x])),eventSource};
    const preset={prompts:[{identifier:'main',role:'system',content:'规划使用 <Think> 标签'},{identifier:'worldInfoBefore',marker:true},{identifier:'chatHistory',marker:true}],prompt_order:[{character_id:100001,order:['main','worldInfoBefore','chatHistory'].map(identifier=>({identifier,enabled:true}))}]};
    const counts={reads:0,prepares:0,stops:0},requests=[];
    const host={context:()=>context,openai:{},powerUser:{},manager:{getPresetList:()=>({presets:[preset],preset_names:{P:0}}),getSelectedPresetName:()=>'P'},world:{loadWorldInfo:async()=>{
        counts.reads++;return {entries:{
            1:{uid:1,comment:'TavernDB-ACU-CustomExport-纪要-1',constant:false,key:['AM0001'],content:'船长在港口等候，知道密道入口。'},
            2:{uid:2,comment:'TavernDB-ACU-CustomExport-纪要-2',constant:false,key:['AM0002'],content:'昔日在雪山看见冰雕。'},
        }};
    }}};
    const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration:()=>counts.stops++,prepare:async({config,signal,data})=>{
        counts.prepares++;
        const snapshot=await captureSources(host,{signal,databaseBook:config.selection.databaseBook,generationType:data.type});
        const built=await buildPlanningContext({snapshot,selection:config.selection,tokenize:async text=>text.length});
        return {...built,request:{model:'planning',custom_url:'https://example.com/v1'}};
    }});
    Object.assign(context.extensionSettings.czgh_external_planner,{enabled:true,selection:{compatibilityIds:['database'],databaseBook:'记忆',databaseLimit:1}});
    const fetch=async(_,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({choices:[{message:{content:'<Think>前往港口</Think>'},finish_reason:'stop'}]})};};
    const generate=async()=>{
        for(const name of events.slice(0,3))await eventSource.emit(name);
        const data={type:'normal',messages:[{role:'user',content:context.chat[0].mes}]};
        await eventSource.emit('CHAT_COMPLETION_SETTINGS_READY',data);return data;
    };
    return {context,eventSource,counts,requests,planner,fetch,generate};
}

for(const stage of ['GENERATION_AFTER_COMMANDS','USER_MESSAGE_RENDERED','WORLDINFO_ENTRIES_LOADED'])test(`database recall at ${stage} completes before any planning capture or API call`,async()=>{
    const h=setup(),savedFetch=globalThis.fetch;globalThis.fetch=h.fetch;
    let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
    const emit=h.eventSource.emit;
    h.eventSource.emit=async function(name,...args){
        await emit.call(this,name,...args);
        if(name===stage){entered();await gate;h.context.chat[0].mes+='\n<recall>AM0001</recall>';}
    };
    try{
        const run=h.generate();await started;
        assert.equal(h.counts.prepares,0);assert.equal(h.counts.reads,0);assert.equal(h.requests.length,0);
        release();await run;
        assert.equal(h.requests.length,1);assert.equal(h.counts.stops,0);
        const prompt=h.requests[0].messages.map(x=>x.content).join('\n');
        assert.match(prompt,/<recall>AM0001<\/recall>/);assert.match(prompt,/知道密道入口/);assert.doesNotMatch(prompt,/冰雕/);
        assert.equal(h.planner.getDiagnostics().sourceManifest.databaseMode,'keywords');
        assert.deepEqual(h.planner.getDiagnostics().sourceManifest.database,[['记忆',1]]);
    }finally{release();globalThis.fetch=savedFetch;}
});

test('without database recall, planning immediately selects relevant exported memories',async()=>{
    const h=setup(),savedFetch=globalThis.fetch;globalThis.fetch=h.fetch;
    try{
        await h.generate();assert.equal(h.requests.length,1);assert.equal(h.counts.stops,0);
        const prompt=h.requests[0].messages.map(x=>x.content).join('\n');
        assert.match(prompt,/知道密道入口/);assert.doesNotMatch(prompt,/冰雕/);
        assert.equal(h.planner.getDiagnostics().sourceManifest.databaseMode,'ranked');
    }finally{globalThis.fetch=savedFetch;}
});

test('database wait gate failure prevents planning instead of falling back before completion',async()=>{
    const h=setup(),savedFetch=globalThis.fetch;globalThis.fetch=h.fetch;
    const emit=h.eventSource.emit;
    h.eventSource.emit=async function(name,...args){await emit.call(this,name,...args);if(name==='USER_MESSAGE_RENDERED')throw new DOMException('数据库召回已取消','AbortError');};
    try{
        await assert.rejects(h.generate(),{name:'AbortError'});
        assert.equal(h.counts.prepares,0);assert.equal(h.counts.reads,0);assert.equal(h.requests.length,0);
    }finally{globalThis.fetch=savedFetch;}
});
