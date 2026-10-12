import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanner} from '../src/host/planner.js';
import {setImmediate as nextTurn} from 'node:timers/promises';

test('manual mode releases completed SSE and clears planning timeout while awaiting the user',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const listeners={};let stops=0,cancelled=0,finishCleanup,calls=0;const oldFetch=globalThis.fetch;
 const context={chatId:'manual',chat:[{is_user:true,mes:'继续'}],extensionSettings:{czgh_external_planner:{enabled:true,autoReply:false,timeoutSeconds:10,maxTokens:6000}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
 globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"<Think>交接完成</Think>"},"finish_reason":"stop"}]}\n\n'));},cancel(){cancelled++;return new Promise(r=>finishCleanup=r);}}));};
 const records=[],progress=[];
 const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stops++;listeners.stop();},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'test'}}),onProgress:r=>progress.push({...r}),onPlanReady:r=>records.push(r)});
 const data={type:'normal',messages:[{role:'user',content:'继续'}]},before=structuredClone(data);let task;
 try{
  task=listeners.request(data);await nextTurn();
  assert.equal(planner.getState().awaitingReply,true);assert.equal(planner.isPlanning(),false);assert.equal(cancelled,1);
  assert.equal(progress.at(-1).phase,'awaiting');assert.deepEqual(data,before);
  t.mock.timers.tick(60000);await nextTurn();
  assert.equal(stops,0);assert.equal(planner.getState().awaitingReply,true);
  assert.equal(planner.resume(),true);await task;
  assert.equal(calls,1);assert.equal(records.length,1);assert.match(data.messages.at(-1).content,/交接完成/);
 }finally{planner.stop();finishCleanup?.();await task;globalThis.fetch=oldFetch;t.mock.timers.reset();}
});
for(const action of ['resume','cancel','chat','edited','metadata','body','swipe','deleted','reordered','role','name','content','selected-swipe'])test(`manual planning waits, then ${action} is isolated`,async()=>{
 const listeners={},records=[];let stops=0,fetches=0;const originalFetch=globalThis.fetch;
 const context={chatId:'a',chat:[{is_user:true,mes:'hello',name:'User'},{is_user:false,mes:'previous',swipe_id:0,swipes:['previous','alternative']}],extensionSettings:{czgh_external_planner:{enabled:true,autoReply:false,timeoutSeconds:60,maxTokens:6000}},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'request',GENERATION_STOPPED:'stop',CHAT_CHANGED:'chat'},eventSource:{on:(e,f)=>listeners[e]=f}};
 globalThis.fetch=async()=>{fetches++;return new Response(JSON.stringify({choices:[{message:{content:'<Think>plan</Think>'},finish_reason:'stop'}]}));};
 try{
 const planner=createPlanner({getContext:()=>context,getRequestHeaders:()=>({}),stopGeneration(){stops++;listeners.stop();},prepare:async()=>({messages:[{role:'system',content:'规划使用 <Think> 标签'}],request:{model:'test'}}),onPlanReady:r=>records.push(r)});
 const data={type:'normal',messages:[{role:'user',content:'hello'}]},original=structuredClone(data);let done=false;
 const task=listeners.request(data).then(()=>done=true);
 for(let n=0;n<10;n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(done,false);assert.deepEqual(data,original);assert.equal(planner.getState().awaitingReply,true);
 if(action==='resume'){assert.equal(planner.resume(),true);assert.equal(planner.resume(),false);}else if(action==='edited'){context.chat.push({is_user:true,mes:'changed'});planner.resume();}else if(action==='cancel')planner.stop();else if(action==='chat'){context.chatId='b';listeners.chat();}else{
 if(action==='metadata'){context.chat[1].extra={display_state:{expanded:true},czghCreativePlanning:{}};context.chat[1].swipe_info=[{extra:{updated:true}}];context.chat[1].gen_finished='later';context.chat[1].swipes.push('unused alternative');}
 if(action==='body')context.chat[0].mes='changed body';
 if(action==='content')context.chat[0].content='changed content';
 if(action==='selected-swipe')context.chat[1].swipes[0]='changed selected text';
 if(action==='swipe')context.chat[1].swipe_id=1;
 if(action==='deleted')context.chat.pop();
 if(action==='reordered')context.chat.reverse();
 if(action==='role')context.chat[0].is_system=true;
 if(action==='name')context.chat[0].name='Other';
 planner.resume();
 }
 await task;assert.equal(fetches,1);assert.equal(records.length,['resume','metadata'].includes(action)?1:0);assert.equal(stops,['resume','metadata'].includes(action)?0:1);
 }finally{globalThis.fetch=originalFetch;}
});
