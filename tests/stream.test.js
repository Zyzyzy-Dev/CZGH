import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlanResponse } from '../src/host/stream.js';
import { extractPlan } from '../src/planning/core.js';

test('a partial usage trailer after terminal choice does not invalidate a finished response',async()=>{
    const response=new Response('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: {"usage":');
    const result=await readPlanResponse(response);assert.equal(result.message.content,'done');
});

test('terminal stream still rejects truncated output and missing closing tags',async()=>{
    for(const [content,reason,error] of [['<Think>完整标签</Think>','length',/截断/],['<Think>缺少闭合','stop',/完整的规划标签/]]){
        const data='data: '+JSON.stringify({choices:[{delta:{content},finish_reason:reason}]})+'\n\n';
        const result=await readPlanResponse(new Response(data));
        assert.throws(()=>extractPlan(result.message.content,{openTag:'<Think>',closeTag:'</Think>'},result.finish_reason),error);
    }
});

test('finish_reason completes the selected response even when the SSE connection stays open',async()=>{
    let controller,cancelled=false;
    const response=new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"<Think>完成</Think>"},"finish_reason":"stop"}]}\n\n'));},cancel(){cancelled=true;}}));
    const pending=readPlanResponse(response);let timer;
    try{
        const result=await Promise.race([pending,new Promise(resolve=>timer=setTimeout(()=>resolve(null),100))]);
        assert.ok(result,'must not wait for EOF or [DONE] after finish_reason');
        assert.equal(result.message.content,'<Think>完成</Think>');assert.equal(result.finish_reason,'stop');assert.equal(cancelled,true);
    }finally{clearTimeout(timer);if(!cancelled)controller.close();await pending;}
});

test('completed SSE cannot be held hostage by asynchronous stream cleanup',async()=>{
    let finishCancel;const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));},cancel(){return new Promise(resolve=>finishCancel=resolve);}}));
    const pending=readPlanResponse(response);let timer;
    try{assert.ok(await Promise.race([pending,new Promise(resolve=>timer=setTimeout(()=>resolve(null),100))]),'validated completion must not await transport cancellation');}
    finally{clearTimeout(timer);finishCancel?.();await pending;}
});

test('detects SSE from body when proxy labels it JSON or omits its content type',async()=>{
    const data=': heartbeat\r\n\r\ndata: {"choices":[{"delta":{"content":"<Think>规划</Think>"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    for (const type of ['application/json','text/plain','']) {
        const previews=[];
        const result=await readPlanResponse(new Response(data,{headers:type?{'content-type':type}:{}}),text=>previews.push(text));
        assert.equal(result.message.content,'<Think>规划</Think>');assert.equal(previews.length,1);
    }
    const json=JSON.stringify({choices:[{message:{content:'plain'},finish_reason:'stop'}]});
    assert.equal((await readPlanResponse(new Response(json,{headers:{'content-type':'text/event-stream'}}))).message.content,'plain');
});
test('SSE handles split UTF-8 and events, exposes previews and preserves finish reason',async()=>{
    const data=['<Think>','规划','</Think>'].map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\r\n\r\n').join('')+'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
    const bytes=new TextEncoder().encode(data);let offset=0;const previews=[];
    const response=new Response(new ReadableStream({pull(controller){if(offset===bytes.length)controller.close();else controller.enqueue(bytes.slice(offset,++offset));}}),{headers:{'content-type':'text/event-stream'}});
    const result=await readPlanResponse(response,text=>previews.push(text));
    assert.equal(result.message.content,'<Think>规划</Think>');assert.equal(result.finish_reason,'stop');assert.equal(previews.length,3);
});
test('truncated or error streams fail, JSON responses still work',async()=>{
    const s=text=>new Response(text,{headers:{'content-type':'text/event-stream'}});
    await assert.rejects(readPlanResponse(s('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')),/中断/);
    await assert.rejects(readPlanResponse(s('data: {"error":true}\n\n')),/错误/);
    const result=await readPlanResponse(new Response(JSON.stringify({choices:[{message:{content:'complete'},finish_reason:'stop'}]})));
    assert.equal(result.message.content,'complete');
});
