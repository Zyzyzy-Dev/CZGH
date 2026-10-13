import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner } from '../src/host/planner.js';
import { freezeCurrentRequest } from '../src/planning/current-request.js';

for(const current of [true,false])test(`host tools with display functions survive planning using ${current?'current':'independent'} connection`,async()=>{
    const listeners={},records=[];let stopped=0,sent;
    const context={chatId:'c',extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const tool={type:'function',function:{name:'lookup',description:'Lookup',parameters:{type:'object'}},toString:function(){return `<div><b>${this.function.name}</b></div><div><small>${this.function.description}</small></div>`;}};
    const data={type:'normal',chat_completion_source:'custom',custom_url:'https://example.com/v1',model:'body',stream:true,temperature:0.8,tools:[tool],tool_choice:'auto',messages:[{role:'user',content:[{type:'text',text:'hello'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}]};
    const originalMessages=structuredClone(data.messages),originalTools=data.tools,originalFetch=globalThis.fetch;
    globalThis.fetch=async(_,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:'<Think>计划</Think>'},finish_reason:'stop'}]})};};
    try{
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stopped++;},prepare:async({data:copy})=>{
            assert.equal(Object.hasOwn(copy,'tools'),false);assert.equal(Object.hasOwn(copy,'tool_choice'),false);
            assert.deepEqual(copy.messages,originalMessages);copy.messages[0].content[0].text='copy only';
            return {messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:current?freezeCurrentRequest(copy,{api_key_custom:[{id:'selected',active:true}]},JSON.parse):{model:'independent',custom_url:'https://example.com/v1'}};
        },onPlanReady:r=>records.push(r)});
        context.extensionSettings.czgh_external_planner.enabled=true;
        await listeners.request(data);
        assert.equal(stopped,0);assert.equal(records.length,1);assert.equal(sent.tools,undefined);assert.equal(sent.tool_choice,undefined);
        assert.equal(data.tools,originalTools);assert.equal(data.tools[0],tool);assert.equal(data.tool_choice,'auto');assert.equal(data.stream,true);assert.equal(data.temperature,0.8);
        assert.deepEqual(data.messages.slice(0,-1),originalMessages);assert.match(data.messages.at(-1).content,/计划/);
    }finally{globalThis.fetch=originalFetch;}
});
test('planner uses independent messages and preserves body request while publishing a validated result',async()=>{
    const listeners={}; const records=[];
    const context={chatId:'c',characterId:1,extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const originalFetch=globalThis.fetch; let sent;
    globalThis.fetch=async(_,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>({choices:[{message:{content:'<Think>独立规划</Think>'},finish_reason:'stop'}]})};};
    try {
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{chat_completion_source:'custom',custom_url:'https://example.com/v1',model:'p'}}),onPlanReady:r=>records.push(r)});
        context.extensionSettings.czgh_external_planner.enabled=true;
        const data={type:'normal',messages:[{role:'system',content:'正文专用资料'}]};
        await listeners.request(data);
        assert.equal(sent.messages[0].content,'规划使用 <Think> 标签');
        assert.equal(data.messages[0].content,'正文专用资料');
        assert.equal(records.length,1); assert.equal(records[0].text,'独立规划');
    }finally{globalThis.fetch=originalFetch;}
});

for (const stream of [true, false]) test(`planning stream=${stream} leaves main streaming enabled and publishes progress`, async()=>{
    const listeners={}, progress=[];
    const context={chatId:'c',chat:[{is_user:true,mes:'hello'}],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const originalFetch=globalThis.fetch; let sent;
    globalThis.fetch=async(_,options)=>{
        sent=JSON.parse(options.body);
        return new Response('data: '+JSON.stringify({choices:[{delta:{content:'<Think>计划</Think>'}}]})+'\n\ndata: '+JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    };
    try {
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'planning-model'}}),onProgress:r=>progress.push(structuredClone(r))});
        Object.assign(context.extensionSettings.czgh_external_planner,{enabled:true,stream});
        const data={type:'normal',stream:true,model:'body-model',temperature:0.7,messages:[{role:'user',content:'hello'}]};
        await listeners.request(data);
        assert.equal(sent.stream,stream);
        assert.equal(data.stream,true); assert.equal(data.model,'body-model'); assert.equal(data.temperature,0.7);
        assert.equal(progress[0].phase,'preparing'); assert.equal(progress[0].expectedMessageId,1);
        assert.equal(progress.at(-1).phase,'streaming'); assert.match(progress.at(-1).text,/计划/);
        assert.match(data.messages.at(-1).content,/计划/);
    } finally {globalThis.fetch=originalFetch;}
});

test('planning failure is published to the floor without injecting a plan',async()=>{
    const listeners={},progress=[];let stopped=0;
    const context={chatId:'c',chat:[{is_user:true,mes:'hello'}],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stopped++;},prepare:async()=>{throw new Error('测试资料读取失败');},onProgress:r=>progress.push(structuredClone(r))});
    context.extensionSettings.czgh_external_planner.enabled=true;
    const data={type:'normal',stream:false,messages:[{role:'user',content:'hello'}]};
    await listeners.request(data);
    assert.equal(stopped,1); assert.equal(data.messages.length,1); assert.equal(data.stream,false);
    assert.equal(progress.at(-1).phase,'error'); assert.equal(progress.at(-1).error,'测试资料读取失败');
});


test('normal, regenerate and new swipe request fresh plans and bind independently',async()=>{
    const {createMessagePlans}=await import('../src/host/message-plans.js');
    const {createGenerationBinding}=await import('../src/host/generation-binding.js');
    const listeners={},records=[];let calls=0,view;
    const context={chatId:'c',chat:[{is_user:true,mes:'本轮输入'}],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const identity=()=>JSON.stringify([context.chatId,context.characterId,context.groupId]);
    const plans=createMessagePlans({chatId:identity,messages:()=>context.chat,display:()=>true,save:async()=>{},render:r=>view=r});
    const binding=createGenerationBinding({identity,discard:id=>plans.discard(id),bind:(r,id)=>plans.bind({requestId:r.requestId,messageId:id,swipeId:context.chat[id].swipe_id})});
    const originalFetch=globalThis.fetch;
    globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:`<Think>新规划${++calls}</Think>`},finish_reason:'stop'}]})});
    try {
        createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'p'}}),onProgress:r=>plans.updateLive(r),onPlanReady:r=>{records.push(r);binding.stage(r);plans.stage(r);}});
        context.extensionSettings.czgh_external_planner.enabled=true;
        for(const type of ['normal','regenerate','swipe']) {
            binding.started();
            if(type==='regenerate')context.chat.pop(); // Native ST removes the replaced response first.
            const data={type,stream:true,messages:[{role:'user',content:'本轮输入'}]};
            await listeners.request(data);
            assert.equal(calls,records.length);assert.match(data.messages.at(-1).content,new RegExp('新规划'+calls));
            if(type==='swipe') {context.chat[1].swipe_id=1;context.chat[1].mes='备选正文';}
            else context.chat.push({mes:'正文'+calls,swipe_id:0,extra:{},swipe_info:[{extra:{}},{extra:{}}]});
            binding.ended();await binding.received(1,type);
            assert.equal(view[0].text,'新规划'+calls);
        }
        assert.equal(calls,3);assert.equal(new Set(records.map(r=>r.requestId)).size,3);
        assert.equal(context.chat[1].extra.czghCreativePlanning[0].text,'新规划2');
        assert.equal(context.chat[1].extra.czghCreativePlanning[1].text,'新规划3');
        context.chat[1].swipe_id=0;context.chat[1].mes='正文2';plans.render();
        assert.equal(view[0].text,'新规划2');assert.equal(calls,3); // Browsing an existing alternative is not generation.
    } finally {globalThis.fetch=originalFetch;}
});


for(const action of ['stop','chat'])test(`${action}: delayed old request cannot cancel or overwrite immediate retry`,async()=>{
    const listeners={},records=[],progress=[];let stops=0,releases=[],calls=0;
    const context={chatId:'a',chat:[],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const savedFetch=globalThis.fetch;let diagnostic;
    globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({choices:[{message:{content:'<Think>新轮规划</Think>'},finish_reason:'stop'}]})};};
    const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stops++;listeners.stop();},prepare:async()=>{
        await new Promise(resolve=>releases.push(resolve));return {messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'m',custom_include_headers:'secret',secret_id:'secret'}};
    },onPlanReady:r=>records.push(r),onProgress:r=>progress.push({...r}),onDiagnostics:d=>diagnostic=d});
    context.extensionSettings.czgh_external_planner.enabled=true;
    try{
        const old={messages:[{role:'user',content:'旧输入'}]};const first=listeners.request(old);
        if(action==='stop'){planner.stop();planner.stop();}else{context.chatId='b';listeners.chat();}
        const stopCount=stops;
        const fresh={messages:[{role:'user',content:'新输入'}]};const second=listeners.request(fresh);
        assert.equal(releases.length,2);
        releases[0]();await first;
        assert.equal(stops,stopCount);assert.equal(calls,0);assert.equal(planner.isPlanning(),true);
        releases[1]();await second;
        assert.equal(calls,1);assert.equal(records.length,1);assert.equal(old.messages.length,1);
        assert.match(fresh.messages.at(-1).content,/新轮规划/);assert.equal(planner.isPlanning(),false);
        assert.ok(!JSON.stringify(diagnostic).includes('secret'));assert.equal(diagnostic.messages.at(-1).role,'system');
        planner.stop();assert.equal(stops,stopCount); // Planning stop cannot cancel body generation after success.
    }finally{globalThis.fetch=savedFetch;}
});


test('late network completion after cancellation cannot replace successful retry diagnostics or plan',async()=>{
    const listeners={},records=[];let stops=0,release,entered;
    const gate=new Promise(r=>entered=r),context={chatId:'a',chat:[],extensionSettings:{},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(n,f)=>listeners[n]=f}};
    const originalFetch=globalThis.fetch;let count=0;
    globalThis.fetch=async()=>{const n=++count;if(n===1){entered();await new Promise(r=>release=r);}return {ok:true,json:async()=>({choices:[{message:{content:`<Think>规划${n}</Think>`},finish_reason:'stop'}]})};};
    const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stops++;listeners.stop();},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'m'}}),onPlanReady:r=>records.push(r)});
    context.extensionSettings.czgh_external_planner.enabled=true;
    try{
        const old={messages:[{role:'user',content:'first'}]};const first=listeners.request(old);await gate;planner.stop();
        await listeners.request({messages:[{role:'user',content:'second'}]});
        const before=planner.getState(),diagnostic=planner.getDiagnostics();release();await first;
        assert.deepEqual(planner.getState(),before);assert.deepEqual(planner.getDiagnostics(),diagnostic);
        assert.equal(records.length,1);assert.equal(records[0].text,'规划2');assert.equal(stops,1);assert.equal(old.messages.length,1);
    }finally{globalThis.fetch=originalFetch;release?.();}
});
