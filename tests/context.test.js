import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanningContext } from '../src/planning/context.js';
import { resolvePreset } from '../src/planning/presets.js';

function agentMarkerSnapshot(trigger='normal') {
    const prompts=[{identifier:'main',role:'system',content:'规划规则'},
        ...['agentSystemPrompt','agentTask','agentResults'].map(identifier=>({identifier,marker:true,content:'Agent 专用内容'})),
        {identifier:'charDescription',marker:true},{identifier:'chatHistory',marker:true}];
    return {id:'s',chatId:'c',trigger,maxContext:2000,worldSettings:{},character:{description:'角色资料'},macroEnvironment:{user:'玩家',char:'角色'},currentPreset:'P',presets:{P:{prompts,prompt_order:[{character_id:100001,order:prompts.map(({identifier})=>({identifier,enabled:true}))}]}},bindings:{},books:{},history:[{role:'user',content:'本轮输入'}],injections:{}};
}

test('unclosed source text survives independent context assembly without losing later messages',async()=>{
    const snapshot=agentMarkerSnapshot();
    snapshot.presets.P.prompts[0].content='规划规则 {{user}}\n示例 {{\n保留预设末尾';
    snapshot.character.description='角色资料 {{char}\n保留角色末尾';
    snapshot.injections.sp_outline_step={value:'注入 {{\n保留注入末尾',position:1,depth:0,role:0};
    const before=structuredClone(snapshot);
    const result=await buildPlanningContext({snapshot,selection:{compatibilityIds:['seven-days']},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['规划规则 玩家\n示例 {{\n保留预设末尾','角色资料 {{char}\n保留角色末尾','本轮输入','注入 {{\n保留注入末尾']);
    assert.equal(result.diagnostics.some(d=>d.blocking),false);assert.deepEqual(snapshot,before);
});

for(const trigger of ['normal','regenerate','swipe'])test(`${trigger} planning excludes TauriTavern Agent-only markers without editing the preset`,async()=>{
    const snapshot=agentMarkerSnapshot(trigger),before=structuredClone(snapshot);
    const result=await buildPlanningContext({snapshot,selection:{},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['规划规则','角色资料','本轮输入']);
    assert.deepEqual(result.sourceManifest.entries,['main','charDescription','chatHistory']);
    const displayed=resolvePreset(snapshot).display.map(item=>item.entry);
    assert.equal(displayed.length,6);assert.ok(displayed.every(entry=>entry.enabled));
    assert.deepEqual(snapshot,before);
});

test('Agent marker compatibility does not hide other unsupported markers',async()=>{
    const snapshot=agentMarkerSnapshot();
    snapshot.presets.P.prompts.push({identifier:'agentUnknown',marker:true});
    snapshot.presets.P.prompt_order[0].order.push({identifier:'agentUnknown',enabled:true});
    await assert.rejects(buildPlanningContext({snapshot,selection:{},tokenize:async s=>s.length}),error=>{
        assert.equal(error.message,'尚未支持预设标记 agentUnknown。');return true;
    });
});

test('ordinary text entries sharing Agent identifiers remain binding',async()=>{
    const snapshot=agentMarkerSnapshot();
    snapshot.presets.P.prompts.find(p=>p.identifier==='agentTask').marker=false;
    const result=await buildPlanningContext({snapshot,selection:{},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['规划规则','Agent 专用内容','角色资料','本轮输入']);
    assert.ok(result.sourceManifest.entries.includes('agentTask'));
});
test('independent context follows selected preset and world switches with ordered history',async()=>{
    const snapshot={id:'s',chatId:'c',maxContext:2000,worldSettings:{},character:{description:'人设'},macroEnvironment:{user:'玩家',char:'角色'},variables:{local:{},global:{}},currentPreset:'P',presets:{P:{prompts:[{identifier:'main',role:'system',content:'规划用 <Think> 标签'},{identifier:'charDescription',marker:true},{identifier:'worldInfoBefore',marker:true},{identifier:'chatHistory',marker:true}],prompt_order:[{character_id:100001,order:['main','charDescription','worldInfoBefore','chatHistory'].map(identifier=>({identifier,enabled:true}))}]}},bindings:{global:['B']},books:{B:{entries:{1:{uid:1,constant:true,content:'常驻资料',position:0}}}},history:[{role:'user',content:'你好'}],injections:{sp_outline_step:{value:'大纲',position:1,depth:0,role:0}}};
    const before=structuredClone(snapshot);
    const result=await buildPlanningContext({snapshot,selection:{presetId:'P',compatibilityIds:['seven-days']},worldState:{},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['规划用 <Think> 标签','人设','常驻资料','你好','大纲']);
    assert.deepEqual(snapshot,before);
    const excluded=await buildPlanningContext({snapshot,selection:{presetId:'P',bookOverrides:{B:false},compatibilityIds:[]},worldState:{},tokenize:async s=>s.length});
    assert.deepEqual(excluded.messages.map(m=>m.content),['规划用 <Think> 标签','人设','你好']);
});
test('multiple depth injections stay relative to history and examples preserve speaker roles',async()=>{
    const snapshot={id:'s',chatId:'c',maxContext:2000,worldSettings:{},character:{mes_example:'<START>\n玩家: 示例问\n角色: 示例答'},macroEnvironment:{user:'玩家',char:'角色'},currentPreset:'P',presets:{P:{prompts:[{identifier:'main',role:'system',content:'M'},{identifier:'dialogueExamples',marker:true},{identifier:'chatHistory',marker:true},{identifier:'tail',role:'system',content:'T'}],prompt_order:[{character_id:100001,order:['main','dialogueExamples','chatHistory','tail'].map(identifier=>({identifier,enabled:true}))}]}},bindings:{},books:{},history:[{role:'user',content:'U'},{role:'assistant',content:'A'}],injections:{sp_outline_step:{value:'D0',position:1,depth:0,role:0},sp_lines_latent:{value:'D1',position:1,depth:1,role:0}}};
    const result=await buildPlanningContext({snapshot,selection:{compatibilityIds:['seven-days']},tokenize:async s=>s.length});
    assert.deepEqual(result.messages.map(m=>m.content),['M','示例问','示例答','U','D1','A','D0','T']);
    assert.equal(result.messages[1].name,'example_user');
});
