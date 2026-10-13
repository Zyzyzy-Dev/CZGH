import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeCurrentRequest } from '../src/planning/current-request.js';

test('current connection excludes executable tool metadata before cloning without changing the body request',()=>{
    const tool={type:'function',function:{name:'lookup',description:'Lookup',parameters:{type:'object'}},toString(){throw Error('Display function must not run');}};
    const data={chat_completion_source:'custom',model:'m',messages:[{role:'user',content:'hello'}],tools:[tool],tool_choice:{render(){throw Error('must not run');}},functions:[{callback(){}}],function_call:{render(){}},temperature:0.7,stop:['END']};
    const request=freezeCurrentRequest(data,{api_key_custom:[{id:'chosen',active:true}]},JSON.parse);
    for(const field of ['tools','tool_choice','functions','function_call'])assert.equal(Object.hasOwn(request,field),false);
    assert.equal(request.secret_id,'chosen');assert.equal(request.temperature,0.7);
    request.stop.push('OTHER');assert.deepEqual(data.stop,['END']);
    assert.equal(data.tools[0],tool);assert.equal(typeof tool.toString,'function');assert.equal(data.messages.length,1);
});
test('current connection freezes key identity and cannot override independent messages through extra body',()=>{
    const data={chat_completion_source:'custom',model:'m',custom_url:'https://example.com/v1',messages:[{role:'system',content:'body'}],max_tokens:500,max_completion_tokens:10000,n:3,tools:[{}],stream:true};
    const before=structuredClone(data);
    const request=freezeCurrentRequest(data,{api_key_custom:[{id:'chosen',active:true}]},JSON.parse);
    assert.equal(request.secret_id,'chosen');assert.equal(request.n,1);assert.equal(request.max_completion_tokens,undefined);assert.equal(request.tools,undefined);assert.deepEqual(request.messages,[]);assert.deepEqual(data,before);
    assert.throws(()=>freezeCurrentRequest({...data,custom_include_body:'{"messages":[]}'},{},JSON.parse));
});
