import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createPlanner } from '../src/host/planner.js';
import { createReplyRecovery } from '../src/host/reply-recovery.js';

function setup() {
    const chats={a:[{is_user:true,mes:'用户输入'}],b:[{is_user:true,mes:'其他输入'}]};
    let id='a',busy=false,saves=0,ready=[],stops=0,status='';
    const host={identity:()=>id,messages:()=>chats[id],busy:()=>busy,save:async()=>saves++,
        ready:(r,m)=>ready.push([r,m]),stop:()=>stops++,status:s=>status=s};
    const recovery=createReplyRecovery(host);
    const record={version:1,requestId:'plan',chatId:'a',text:'完整规划',openTag:'<Think>',closeTag:'</Think>',expectedMessageId:1,generationType:'normal'};
    return {host,recovery,record,chats,switchTo:value=>id=value,busy:value=>busy=value,
        saved:()=>saves,ready:()=>ready,stops:()=>stops,status:()=>status};
}
const handoff={role:'system',content:'写作要求\n<Think>完整规划</Think>'};

test('multiple planning blocks survive completion, chat restoration and failed body retries after mode changes',async t=>{
    const listeners={},chats={a:[{is_user:true,mes:'本轮输入'}],b:[{is_user:true,mes:'另一聊天'}]};
    const context={chatId:'a',chat:chats.a,extensionSettings:{czgh_external_planner:{enabled:true,multiChain:true,autoReply:true}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
    let calls=0,saves=0,ready=[];
    const identity=()=>JSON.stringify([context.chatId,undefined,undefined]);
    const host={identity,messages:()=>context.chat,busy:()=>false,save:async()=>saves++,stop(){},status(){},ready:(r,m)=>ready.push([r,m])};
    const recovery=createReplyRecovery(host);
    const text='<战斗思考>战斗安排</战斗思考>\n\n<thinking>人物安排</thinking>';
    t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:text+'\n<content>不应注入的正文</content>'},finish_reason:'stop'}]}));});
    const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'<thinking>剧情规划</thinking>\n<战斗思考>战斗规划</战斗思考>'}],request:{model:'test'}}),continueRequest:data=>recovery.consume(data),onPlanCompleted:(r,m)=>recovery.completed(r,m)});
    const data={type:'normal',messages:[{role:'user',content:'本轮输入'}]};await listeners.request(data);
    assert.equal(calls,1);assert.equal(saves,1);assert.equal(recovery.view().multiChain,true);assert.equal(recovery.view().text,text);
    assert.equal(planner.getState().preview,text);
    const frozen=structuredClone(data.messages.at(-1));assert.ok(frozen.content.endsWith(text));assert.doesNotMatch(frozen.content,/不应注入/);
    context.chatId='b';context.chat=chats.b;listeners.chat();recovery.switched();assert.equal(recovery.view(),null);
    context.chatId='a';context.chat=chats.a;listeners.chat();recovery.switched();
    context.extensionSettings.czgh_external_planner.multiChain=false;
    planner.restore(recovery.view());assert.equal(planner.getState().preview,text);
    host.generate=async type=>{recovery.started(type,{},false);const retry={type,messages:[{role:'system',content:'正文原始要求'}]};await listeners.request(retry);assert.deepEqual(retry.messages.at(-1),frozen);throw Error('body 503');};
    assert.equal(await recovery.resume(),false);assert.equal(await recovery.resume(),false);
    assert.equal(calls,1);assert.equal(ready.length,2);assert.ok(ready.every(([r])=>r.multiChain&&r.text===text));
});

test('completed plan is saved before manual waiting, and timeout never discards it',async t=>{
    const listeners={},context={chatId:'a',chat:[{is_user:true,mes:'用户输入'}],extensionSettings:{czgh_external_planner:{enabled:true,autoReply:false,timeoutSeconds:10,maxTokens:6000}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
    const completed=[];let injected=0;
    t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({choices:[{message:{content:'<Think>完整规划</Think>'},finish_reason:'stop'}]})));
    const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'<Think>规划</Think>'}],request:{model:'test'}}),onPlanCompleted:async(r,m)=>completed.push([r,m]),onPlanReady:()=>injected++});
    const data={type:'normal',messages:[{role:'user',content:'用户输入'}]};
    const running=listeners.request(data);await tick();
    try {
        assert.equal(completed.length,1);
        assert.equal(completed[0][0].text,'完整规划');
        assert.match(completed[0][1].content,/完整规划/);
        assert.equal(injected,0);
        assert.equal(planner.getState().awaitingReply,true);
    } finally {planner.stop();await running;}
});

test('an edit while the planner API is running cannot be saved as a reusable plan for the edited input',async t=>{
    const listeners={},context={chatId:'a',chat:[{is_user:true,mes:'原输入'}],extensionSettings:{czgh_external_planner:{enabled:true,maxTokens:6000}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
    let finish,saved=0,stops=0;
    t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>finish=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:'<Think>旧输入的规划</Think>'},finish_reason:'stop'}]})))));
    createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration:()=>stops++,prepare:async()=>({messages:[{role:'system',content:'<Think>规划</Think>'}],request:{model:'test'}}),onPlanCompleted:()=>saved++});
    const data={type:'normal',messages:[{role:'user',content:'原输入'}]},running=listeners.request(data);await tick();
    context.chat[0].mes='新输入';finish();await running;
    assert.equal(saved,0);assert.equal(data.messages.length,1);assert.equal(stops,1);
});

test('saved plans survive reconstruction and chat switching without saving credentials or request context',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);
    assert.equal(x.saved(),1);assert.equal(x.chats.a[0].mes,'用户输入');
    x.switchTo('b');x.recovery.switched();assert.equal(x.recovery.view(),null);
    x.switchTo('a');
    const restored=createReplyRecovery(x.host);
    assert.equal(restored.view().text,'完整规划');assert.equal(restored.available(),true);
    const json=JSON.stringify(x.chats.a[0].extra);assert.ok(!json.includes('messages'));assert.ok(!json.includes('apiKey'));
});

test('plugin retry reuses handoff exactly once, retains failure for another retry, native retry has no bypass',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);
    let generated=0;
    x.host.generate=async type=>{
        generated++;x.recovery.started(type,{},false);
        if(x.chats.a.length>1)x.chats.a.pop();
        const data={type,model:'body',messages:[{role:'system',content:'当前正文原始资料'}]};
        assert.equal(x.recovery.consume(data),true);
        assert.deepEqual(data.messages,[{role:'system',content:'当前正文原始资料'},handoff]);
        assert.equal(x.recovery.consume({type,messages:[]}),false);
        x.chats.a.push({mes:'未完成正文'});
        throw Error('HTTP 503');
    };
    assert.equal(await x.recovery.resume(),false);assert.equal(x.recovery.available(),true);
    assert.equal(await x.recovery.resume(),false);assert.equal(generated,2);
    assert.equal(x.recovery.consume({type:'regenerate',messages:[{role:'user',content:'输入'}]}),false);
    assert.notEqual(x.ready()[0][0].requestId,x.ready()[1][0].requestId);
});

test('edits, swipe changes, other chat, new input and metadata are distinguished',async()=>{
    for(const change of ['edit','swipe','new','other','metadata']) {
        const x=setup();await x.recovery.completed(x.record,handoff);
        if(change==='edit')x.chats.a[0].mes='改动';
        if(change==='swipe')x.chats.a[0].swipe_id=1;
        if(change==='new')x.chats.a.push({is_user:true,mes:'新输入'});
        if(change==='other')x.switchTo('b');
        if(change==='metadata')x.chats.a[0].extra.otherPlugin='change';
        assert.equal(x.recovery.available(),change==='metadata',change);
    }
});

test('retry rechecks source after host preflight and never injects into changed chat',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);
    x.host.generate=async type=>{
        x.chats.a[0].mes='preflight edit';
        const data={type,messages:[{role:'user',content:'preflight edit'}]};
        assert.equal(x.recovery.consume(data),true);
        assert.equal(data.messages.length,1);
    };
    await x.recovery.resume();assert.equal(x.stops(),1);assert.equal(x.ready().length,0);
});

test('successful body removes only its matching pending plan; new planning cannot bind an old draft',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);
    await x.recovery.bound({...x.record,requestId:'old'});assert.equal(x.recovery.available(),true);
    await x.recovery.bound(x.record);assert.equal(x.recovery.view(),null);
    await x.recovery.completed(x.record,handoff);await x.recovery.fresh();assert.equal(x.recovery.view(),null);
});

test('a fast chat switch during the host save queue still restores this session completed plan',async()=>{
    const x=setup();let finish;x.host.save=()=>new Promise(resolve=>finish=resolve);
    const pending=x.recovery.completed(x.record,handoff);
    x.switchTo('b');x.recovery.switched();finish();await pending;
    x.chats.a=[{is_user:true,mes:'用户输入'}]; // Host reloaded an older on-disk snapshot.
    x.switchTo('a');x.recovery.switched();
    assert.equal(x.recovery.view()?.text,'完整规划');
    assert.equal(x.recovery.available(),true);
});

test('failed swipe retries through native swipe entry without deleting earlier alternatives',async()=>{
    const x=setup();x.record.generationType='swipe';
    const body={mes:'旧正文',swipe_id:1,swipes:['第一份','旧正文']};x.chats.a.push(body);
    await x.recovery.completed(x.record,handoff);
    let invoked=0;
    x.host.generate=()=>assert.fail('must use native swipe entry');
    x.host.swipe=async(id,target)=>{
        invoked++;assert.equal(id,1);assert.equal(target,2);body.swipe_id=target;
        x.recovery.started('swipe',{},false);
        const data={type:'swipe',messages:[{role:'user',content:'用户输入'}]};
        assert.equal(x.recovery.consume(data),true);assert.deepEqual(data.messages.at(-1),handoff);
        assert.deepEqual(body.swipes,['第一份','旧正文']);
    };
    await x.recovery.resume();assert.equal(invoked,1);assert.equal(x.stops(),0);
    assert.equal(x.ready()[0][0].expectedMessageId,1);
});

test('completed TT tool chain can retry final prose without rerunning planning or consuming user draft',async()=>{
    const x=setup();x.host.tauriTavern=()=>true;await x.recovery.completed(x.record,handoff);x.recovery.active(x.record);
    x.chats.a.push({mes:'查询',tool_calls:[{id:'t',name:'lookup'}]},{role:'tool',is_system:true,tool_call_id:'t',mes:'结果'});
    await x.recovery.settled();
    x.host.generate=async(type,options)=>{
        assert.equal(type,'normal');assert.equal(options.depth,1);assert.equal(options.automatic_trigger,true);
        const data={type,messages:[{role:'tool',content:'结果'}]};
        assert.equal(x.recovery.consume(data),true);assert.deepEqual(data.messages.at(-1),handoff);
    };
    assert.equal(await x.recovery.resume(),true);assert.equal(x.ready()[0][0].expectedMessageId,3);
});

test('host refusing to start a retry leaves a clear message and no armed bypass',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);x.host.generate=async()=>{};
    assert.equal(await x.recovery.resume(),false);assert.match(x.status(),/未开始/);
    assert.equal(x.recovery.consume({type:'regenerate',messages:[]}),false);
});

test('native failed swipe can roll back its provisional slot after GENERATION_ENDED',async()=>{
    const x=setup();x.record.generationType='swipe';
    const body={mes:'旧正文',swipe_id:2,swipes:['第一份','旧正文']};x.chats.a.push(body);
    await x.recovery.completed(x.record,handoff);x.recovery.active(x.record);await x.recovery.settled();
    body.swipe_id=1;body.mes='旧正文';
    assert.equal(x.recovery.available(),true);
    body.mes='用户改过的正文';assert.equal(x.recovery.available(),false);
});

test('switching away from an unresolved body retry does not block another chat or clear its retry',async()=>{
    const x=setup();await x.recovery.completed(x.record,handoff);let release;
    x.host.generate=()=>new Promise(resolve=>release=resolve);
    const first=x.recovery.resume();
    x.switchTo('b');x.recovery.switched();
    await x.recovery.completed({...x.record,chatId:'b',requestId:'plan-b'},handoff);
    assert.equal(x.recovery.available(),true);
    let releaseSecond;x.host.generate=()=>new Promise(resolve=>releaseSecond=resolve);
    const second=x.recovery.resume();release();await first;
    assert.equal(x.recovery.available(),false);
    const data={type:'regenerate',messages:[{role:'user',content:'其他输入'}]};
    assert.equal(x.recovery.consume(data),true);
    releaseSecond();await second;
});
