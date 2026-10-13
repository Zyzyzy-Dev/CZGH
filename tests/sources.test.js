import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSources } from '../src/host/sources.js';

test('tool history is read as labelled reference text without executable calls or native reasoning',async()=>{
    const ctx={chatId:'c',chat:[{is_user:true,mes:'查天气'},{mes:'正在查询',tool_calls:[{id:'t1',name:'weather',parameters:{city:'北京'}}],extra:{tool_reasoning_content:'内部思考'}},{role:'tool',tool_call_id:'t1',is_system:true,name:'weather',mes:'晴天'},{mes:'天气晴朗'},{is_system:true,mes:'不要读取的系统楼层'},{is_user:true,mes:'现在出门吗'}],chatMetadata:{}};
    const before=structuredClone(ctx);
    const host={context:()=>ctx,manager:{getPresetList:()=>({})},world:{loadWorldInfo:async()=>({entries:{}})},openai:{},powerUser:{}};
    const snapshot=await captureSources(host);
    assert.equal(snapshot.history.length,5);
    assert.match(snapshot.history[1].content,/weather/);assert.match(snapshot.history[1].content,/北京/);
    assert.match(snapshot.history[2].content,/历史工具结果/);assert.match(snapshot.history[2].content,/晴天/);
    assert.equal(snapshot.history[2].role,'assistant');assert.equal(snapshot.userInput,'现在出门吗');
    assert.ok(!snapshot.history.some(m=>m.tool_calls||m.role==='tool'));
    assert.ok(!snapshot.history.map(m=>m.content).join('').includes('内部思考'));
    assert.equal(snapshot.macroEnvironment.lastcharmessage,'天气晴朗');
    assert.deepEqual(ctx,before);
});

test('database books are loaded through regular bindings and extra books only',async()=>{
    const reads=[];
    const ctx={chatId:'c',characterId:0,characters:[{data:{extensions:{world:'主书'}}}],chat:[],chatMetadata:{world_info:'聊天书'}};
    const host={context:()=>ctx,manager:{getPresetList:()=>({}),getSelectedPresetName:()=>''},world:{loadWorldInfo:async name=>{reads.push(name);return{entries:{}};}},openai:{},powerUser:{}};
    const snapshot=await captureSources(host,{extraBooks:['纪要书','聊天书'],databaseBook:'旧来源'});
    assert.deepEqual(reads,['主书','聊天书','纪要书']);
    assert.equal(snapshot.databaseTarget,undefined);
    assert.deepEqual(snapshot.bindings.chat,['聊天书']);
});

test('source capture clones inputs, includes auxiliary/chat books and rejects a switched chat',async()=>{
    const ctx={chatId:'chat',characterId:0,characters:[{avatar:'c.png',name:'角色',data:{extensions:{world:'primary'}}}],chat:[{is_user:true,mes:'hello'}],chatMetadata:{world_info:'chatbook'},extensionPrompts:{foreign:{value:'secret',filter:()=>true}},name1:'玩家',name2:'角色'};
    const world={world_names:['primary','aux','global','chatbook'],selected_world_info:['global'],world_info:{charLore:[{name:'c',extraBooks:['aux']}]},getWorldInfoSettings:()=>({}),loadWorldInfo:async()=>({entries:{}})};
    const manager={getPresetList:()=>({presets:[{prompts:[],prompt_order:[]}],preset_names:{P:0}}),getSelectedPresetName:()=> 'P'};
    const host={context:()=>ctx,world,manager,openai:{oai_settings:{prompts:[],prompt_order:[],active:true}},powerUser:{}};
    const s=await captureSources(host,{});
    assert.deepEqual(s.bindings,{global:['global'],character:['primary','aux'],chat:['chatbook'],persona:[]});
    assert.equal(s.history[0].content,'hello');
    assert.ok(Object.isFrozen(s));
    assert.equal(s.presets.P.active,true);
    assert.equal(s.macroEnvironment.lastusermessage,'hello');
    ctx.maxContext=2048;ctx.chatCompletionSettings={openai_max_context:32000};
    assert.equal((await captureSources(host,{})).maxContext,32000);
    ctx.chat[0].mes='changed'; assert.equal(s.history[0].content,'hello');
    world.loadWorldInfo=async()=>{ctx.chatId='another';return{entries:{}};};
    await assert.rejects(captureSources(host,{}),/聊天/);
});


test('swipe excludes replaced response before history macros, regenerate uses already-trimmed host history',async()=>{
    const ctx={chatId:'c',chat:[{mes:'之前回复'},{is_user:true,mes:'本轮输入'},{mes:'旧备选回复',extra:{image:'old'}}],chatMetadata:{}};
    const host={context:()=>ctx,manager:{getPresetList:()=>({}),getSelectedPresetName:()=>''},world:{loadWorldInfo:async()=>({entries:{}})},openai:{},powerUser:{}};
    const swipe=await captureSources(host,{generationType:'swipe'});
    assert.deepEqual(swipe.history.map(m=>m.content),['之前回复','本轮输入']);
    assert.equal(swipe.userInput,'本轮输入');assert.equal(swipe.macroEnvironment.lastmessage,'本轮输入');
    assert.equal(swipe.macroEnvironment.lastcharmessage,'之前回复');assert.equal(swipe.capabilities.media,false);
    assert.equal(ctx.chat.length,3);
    ctx.chat[1].extra={files:[{name:'附件.txt'}]};
    assert.equal((await captureSources(host,{generationType:'swipe'})).capabilities.media,true);
    delete ctx.chat[1].extra;
    ctx.chat.pop();
    assert.deepEqual((await captureSources(host,{generationType:'regenerate'})).history,swipe.history);
    // ST already removes the replaced reply, even if the preceding message is another assistant.
    ctx.chat=[{mes:'保留的上一条回复'}];
    assert.equal((await captureSources(host,{generationType:'regenerate'})).history.length,1);
});

test('chat attachments accept multiple world books and normalize names before loading',async()=>{
 const reads=[];const ctx={chatId:'c',chat:[],chatMetadata:{world_info:[' A ','B','A','']}};
 const host={context:()=>ctx,manager:{getPresetList:()=>({})},world:{loadWorldInfo:async name=>{reads.push(name);return {entries:{}};}},openai:{},powerUser:{}};
 const snapshot=await captureSources(host);
 assert.deepEqual(snapshot.bindings.chat,['A','B']);assert.deepEqual(reads,['A','B']);
});
