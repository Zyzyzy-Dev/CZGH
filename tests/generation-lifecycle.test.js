import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationBinding } from '../src/host/generation-binding.js';
import { completeToolSpan } from '../src/planning/tool-history.js';

test('tool spans require every call result exactly once, and cannot cross ordinary messages',()=>{
    const owner={tool_calls:[{id:'a'},{id:'b'}]},a={role:'tool',tool_call_id:'a'},b={role:'tool',tool_call_id:'b'};
    assert.equal(completeToolSpan([owner,b,a]),true);
    for(const span of [[],[owner,a],[owner,a,a],[owner,a,b,{mes:'unrelated'}],[owner,a,b,owner,a,b],[a,b],[owner,{is_user:true,role:'tool',tool_call_id:'a'},b]])assert.equal(completeToolSpan(span),false);
});

const toolTurn=id=>[{mes:'查询中',tool_calls:[{id,name:'lookup',parameters:{}}]},{role:'tool',tool_call_id:id,is_system:true,mes:'结果'}];
function ttBinding(type='normal'){
    const chat=[{is_user:true,mes:'输入'}],calls=[];
    const host={identity:()=> 'c',messages:()=>chat,tauriTavern:()=>true,bind:async(r,id)=>calls.push([r.requestId,id]),discard:id=>calls.push(['discard',id])};
    const binding=createGenerationBinding(host);
    if(type==='swipe')chat.push({mes:'原正文',swipe_id:0});
    binding.stage({requestId:'plan',chatId:'c',expectedMessageId:1,generationType:type},{role:'system',content:'本轮规划'});
    return {chat,calls,binding,host};
}
test('TT multi-round tools reuse the plan and bind only the final assistant after matching tool floors',async()=>{
    for(const type of ['normal','regenerate','swipe']){
        const {chat,calls,binding}=ttBinding(type);
        if(type==='swipe')chat.pop();
        for(const id of ['t1','t2']){
            chat.push(...toolTurn(id));binding.started('normal',{},false);
            const data={type:'normal',messages:[{role:'tool',content:'result'}]};
            assert.equal(binding.continueRequest(data),true);
            assert.equal(data.messages.at(-1).content,'本轮规划');
            await binding.received(chat.length-2,'normal');assert.deepEqual(calls,[]);
        }
        chat.push({mes:'最终正文'});binding.ended();await binding.received(5,'normal');
        await binding.received(5,'normal');assert.deepEqual(calls,[['plan',5]]);
    }
});
test('TT cannot carry plans across stops, edits, new user turns, broken tool chains or explicit retries',async()=>{
    for(const change of ['stop','edit','user','bad-id','plain-assistant','retry','end','chat','abort']){
        const {chat,calls,binding,host}=ttBinding();chat.push(...toolTurn('t1'));
        if(change==='stop')binding.stopped();
        if(change==='edit')chat[0].mes='edited';
        if(change==='user')chat.push({is_user:true,mes:'new input'});
        if(change==='bad-id')chat[2].tool_call_id='unknown';
        if(change==='plain-assistant')chat[1]={mes:'unrelated'};
        if(change==='end')binding.ended();
        if(change==='chat')host.identity=()=> 'other';
        if(change==='abort')host.isAborted=()=>true;
        binding.started(change==='retry'?'regenerate':'normal',{},false);
        assert.equal(binding.continueRequest({type:'normal',messages:[]}),false,change);
        chat.push({mes:'another answer'});await binding.received(chat.length-1,'normal');
        assert.deepEqual(calls,[['discard','plan']],change);
    }
});

test('TT visible intermediary events arrive before tool_calls is saved; binding waits for generation end',async()=>{
    const {chat,calls,binding}=ttBinding();
    chat.push({mes:'先查一下'});
    await binding.received(1,'normal');assert.deepEqual(calls,[]);
    chat[1].tool_calls=[{id:'t1',name:'lookup'}];chat.push({role:'tool',is_system:true,tool_call_id:'t1',mes:'结果'});
    binding.started('normal',{},false);
    assert.equal(binding.continueRequest({type:'normal',messages:[]}),true);
    chat.push({mes:'最终正文'});
    await binding.received(3,'normal');assert.deepEqual(calls,[]);
    await binding.ended();assert.deepEqual(calls,[['plan',3]]);
});

test('ordinary ST does not infer tool recursion from TT-style floors',()=>{
    const {chat,calls,binding,host}=ttBinding();host.tauriTavern=()=>false;
    chat.push(...toolTurn('t1'));binding.started('normal',{},false);
    assert.equal(binding.continueRequest({type:'normal',messages:[]}),false);
    assert.deepEqual(calls,[['discard','plan']]);
});
test('streaming end before message received retains plan; next generation and stop invalidate it',async()=>{
    const calls=[];let identity='c',aborted=false;
    const binding=createGenerationBinding({identity:()=>identity,isAborted:()=>aborted,bind:async(record,id)=>calls.push([record.requestId,id]),discard:id=>calls.push(['discard',id])});
    binding.stage({requestId:'a',chatId:'c',generationType:'normal',expectedMessageId:2});
    binding.ended();await binding.received(2,'normal');assert.deepEqual(calls,[['a',2]]);
    binding.stage({requestId:'b',chatId:'c',generationType:'normal',expectedMessageId:2});binding.started();await binding.received(2,'normal');assert.deepEqual(calls.at(-1),['discard','b']);
    binding.stage({requestId:'d',chatId:'c',generationType:'swipe',expectedMessageId:2});await binding.received(2,'quiet');assert.notEqual(calls.at(-1)[0],'d');
    identity='other';await binding.received(2,'swipe');assert.equal(calls.at(-1)[0],'discard');
    identity='c';aborted=true;binding.stage({requestId:'error',chatId:'c',expectedMessageId:2});binding.ended();await binding.received(2,'normal');assert.deepEqual(calls.at(-1),['discard','error']);
});
