import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, migrateSettings, resolvePlanningTags, extractPlan, planningMessages, writingMessages, formatPlan, promptDefaults } from '../src/planning/core.js';
import { buildPlanningContext } from '../src/planning/context.js';

const source = [{role:'system',content:`EXPLICIT REASONING INSTRUCTION: after <Interleaving>, use every required <thinking> section exactly as specified.
<Interleaving>
<thinking>
情景回顾、人物安排。
</thinking>
</Interleaving>
块形态：同一对一推演块的强制输出格式，唯一的战斗块是 <战斗思考>。
<战斗思考>战斗规划</战斗思考>
旧版 <战力推演> 已废止，不得使用。
规划后输出 <content>正文</content><status>状态</status>`}];
const config = () => ({...defaults, multiChain:true, ...resolvePlanningTags(source,{...defaults,multiChain:true})});

test('multi-chain is opt-in and single-chain detection/extraction stays unchanged',()=>{
    assert.equal(migrateSettings({}).multiChain,false);
    assert.equal(migrateSettings({multiChain:true}).multiChain,true);
    const single=resolvePlanningTags(source,defaults);
    assert.deepEqual(single,{openTag:'<战斗思考>',closeTag:'</战斗思考>'});
    assert.equal(extractPlan('<战斗思考>战斗安排</战斗思考><thinking>人物安排</thinking>',single,'stop'),'战斗安排');
});

test('multi-chain recognizes bare thinking and combat instructions but not body or retired tags',()=>{
    assert.deepEqual(config().planningTags,[{openTag:'<thinking>',closeTag:'</thinking>'},{openTag:'<战斗思考>',closeTag:'</战斗思考>'}]);
    const messages=[{role:'user',content:'<SecretPlan>规划</SecretPlan>'},{role:'assistant',content:'<OldPlan>规划</OldPlan>'},...source];
    assert.deepEqual(resolvePlanningTags(messages,{multiChain:true}),resolvePlanningTags(source,{multiChain:true}));
});

test('preset entries and variable expansion retain ordinary planning beside combat rules',async()=>{
    const prompts=[{identifier:'combat',role:'system',content:'{{setvar::rules::推演的输出格式使用 <战斗思考>，条件成立才写。\n<战斗思考>战斗规划</战斗思考>}}'},
        {identifier:'cot',role:'system',content:'<Interleaving>\n<thinking>\n情景回顾，人物安排。\n{{getvar::rules}}\n</thinking>\n</Interleaving>'},
        {identifier:'chatHistory',marker:true}];
    const snapshot={id:'s',chatId:'c',maxContext:10000,worldSettings:{},character:{},macroEnvironment:{},currentPreset:'P',presets:{P:{prompts,prompt_order:[{character_id:100001,order:prompts.map(p=>({identifier:p.identifier,enabled:true}))}]}},bindings:{},books:{},history:[{role:'user',content:'继续日常对话'}],injections:{}};
    const before=structuredClone(snapshot);
    const built=await buildPlanningContext({snapshot,selection:{},tokenize:async text=>text.length});
    const settings={...defaults,multiChain:true,...resolvePlanningTags(built.messages,{multiChain:true})};
    assert.deepEqual(settings.planningTags.map(p=>p.openTag),['<thinking>','<战斗思考>']);
    assert.ok(built.messages.some(m=>m.content.includes('情景回顾，人物安排。')));
    assert.deepEqual(snapshot,before);
});

test('multi-chain also accepts explicit custom labels and tilde labels without collecting format wrappers',()=>{
    const messages=[{role:'system',content:'<thinking_format>\n规划使用 <StageOne> 标签。\n<StageOne>安排</StageOne>\n<StageTwo>写作准备</StageTwo>\n<Incomplete>格式未明\n<analysis>资料核对</analysis>\n<think_nya~>安排</think_nya~>\n</thinking_format>'}];
    assert.deepEqual(resolvePlanningTags(messages,{multiChain:true}).planningTags.map(p=>p.openTag),['<StageOne>','<StageTwo>','<analysis>','<think_nya~>']);
    assert.throws(()=>resolvePlanningTags([{role:'system',content:'禁止输出 <thinking>安排</thinking>。\n<body>正文</body>'}],{multiChain:true}),/未能识别/);
});

test('instructions for products after planning do not turn product tags into planning blocks',()=>{
    const messages=[{role:'system',content:'<thinking>剧情规划</thinking>\n思考结束后，输出 <UpdateVariable>状态更新</UpdateVariable>。\n规划后输出 <SUOT>选项</SUOT>。\n完成规划后，输出 <time>时间</time>。\n规划中确认正文使用 <product> 成品标签。\n规划输出 <StageTwo> 标签。'}];
    assert.deepEqual(resolvePlanningTags(messages,{multiChain:true}).planningTags.map(p=>p.openTag),['<thinking>','<StageTwo>']);
});

test('multi-chain request changes only the generated format instruction, not editable prompts or sources',()=>{
    const settings={...config(),plannerPrompt:'用户保存的规划提示词'},before=structuredClone(settings);
    const messages=planningMessages(source,settings),last=messages.at(-1).content;
    assert.ok(last.startsWith('用户保存的规划提示词\n'));
    assert.match(last,/<thinking>…<\/thinking>、<战斗思考>…<\/战斗思考>/);
    assert.match(last,/条件性区块按原条件执行/);
    assert.doesNotMatch(last,/请将完整规划放入/);
    assert.deepEqual(messages.slice(0,-1),source);assert.deepEqual(settings,before);
    assert.equal(migrateSettings({multiChain:true}).plannerPrompt,promptDefaults.plannerPrompt);
});

test('all complete sibling blocks survive in response order, excluding prose outside them',()=>{
    const raw='前言<战斗思考>战斗安排</战斗思考>\n<Interleaving><thinking>人物安排</thinking></Interleaving>\n<content>正文</content>';
    const plan=extractPlan(raw,config(),'stop');
    assert.equal(plan,'<战斗思考>战斗安排</战斗思考>\n\n<thinking>人物安排</thinking>');
    const written=writingMessages([{role:'user',content:'输入'}],plan,{...config(),writerPrompt:'正文说明'});
    assert.equal(written.at(-1).content,'正文说明\n\n【本轮创作规划】\n'+plan);
    assert.equal(formatPlan(plan,config()),plan);
});

test('conditional absent blocks, repeated siblings and nested different blocks are preserved without duplication',()=>{
    for(const raw of ['<thinking>日常安排</thinking>', '<thinking>第一段</thinking>\n\n<thinking>第二段</thinking>', '<thinking>人物安排<战斗思考>战斗安排</战斗思考>后续安排</thinking>']) {
        assert.equal(extractPlan(raw,config(),'stop'),raw);
    }
});

test('quoted delimiters remain literal but malformed or truncated blocks never silently produce a partial plan',()=>{
    const raw='<thinking>格式引用 `<战斗思考>` 与 `</战斗思考>`</thinking>';
    assert.equal(extractPlan(raw,config(),'stop'),raw);
    for(const text of ['<thinking>完整</thinking><战斗思考>未闭合', '<thinking>不匹配</战斗思考>', '</thinking><战斗思考>内容</战斗思考>', '<thinking>外层<thinking>同名内层</thinking></thinking>', '<thinking> </thinking>', '<thinking>完整</thinking><战斗思考></战斗思考>', '<body>只有正文</body>']) assert.throws(()=>extractPlan(text,config(),'stop'));
    assert.throws(()=>extractPlan('<thinking>完整</thinking>',config(),'length'),/截断/);
    assert.throws(()=>extractPlan(null,config(),'stop'),/未返回文本/);
});
