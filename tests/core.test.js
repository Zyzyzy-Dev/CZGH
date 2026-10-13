import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaults, resolvePlanningTags, migrateSettings, extractPlan, planningMessages, writingMessages, eligibleRequest, unresolvedBaiBaiMacros, validateSettings } from '../src/planning/core.js';

const config = { ...defaults, openTag: '<Abstract>', closeTag: '</Abstract>', apiUrl: 'https://example.org/v1', model: 'planner' };

test('collaborative defaults migrate both previous instructions without overriding custom text',()=>{
    const backup=JSON.parse(readFileSync(new URL('../docs/prompt-backups/0.4.0-dev.20.json',import.meta.url),'utf8'));
    assert.ok(backup.planningMessage.includes(backup.plannerInstruction));
    assert.ok(backup.writingMessage.includes(backup.writerInstruction));
    const updated=migrateSettings({plannerInstruction:backup.plannerInstruction,writerInstruction:backup.writerInstruction});
    assert.equal(updated.plannerInstruction,defaults.plannerInstruction);
    assert.equal(updated.writerInstruction,defaults.writerInstruction);
    assert.match(updated.plannerInstruction,/分阶段的协作写作/);
    assert.match(updated.writerInstruction,/你的同事/);
    const custom=migrateSettings({plannerInstruction:'我的规划',writerInstruction:'我的正文'});
    assert.equal(custom.plannerInstruction,'我的规划');assert.equal(custom.writerInstruction,'我的正文');
    const message=planningMessages([],{...config,...updated}).at(-1).content;
    assert.doesNotMatch(message,/结果必须仅包含一个完整区块|闭合标签后立即结束/);
    assert.match(message,/本轮安排：/);
});

test('auto tags follow each request, preserve case and ignore unrelated content/history', () => {
    for (const tag of ['Abstract', 'Think', 'think', '写作规划', 'ScenePlan']) {
        const messages = [{ role: 'system', content: `生成顺序：<${tag}>→写作准备→</${tag}>→<content>正文</content>→<status>状态栏</status>` },
            { role: 'assistant', content: '<Old>思维链</Old>' }, { role: 'user', content: '规划使用<Fake>标签' }];
        assert.deepEqual(resolvePlanningTags(messages, defaults), { openTag: `<${tag}>`, closeTag: `</${tag}>` });
    }
});
test('explicit start on next line and split closing directives are recognized', () => {
    assert.deepEqual(resolvePlanningTags([{ role: 'system', content: '现在开始思考，写出思考标签：\n<Think>\n内容' }], defaults), { openTag: '<Think>', closeTag: '</Think>' });
    assert.equal(resolvePlanningTags([{ role: 'system', content: '格式确认回答完毕后关闭当前的 </Abstract>，紧接着输出 <content> 正文。' }, { role: 'system', content: '<Abstract>写作准备</Abstract>' }], defaults).openTag, '<Abstract>');
});
test('ambiguous, missing and forbidden tags stop; manual override is explicit', () => {
    for (const content of ['<Think>规划</Think>\n<Abstract>写作准备</Abstract>', '正文使用<content>规划</content>', '禁止使用思维链标签<Old>。', '没有规划标签']) {
        assert.throws(() => resolvePlanningTags([{ role: 'system', content }], defaults));
    }
    assert.deepEqual(resolvePlanningTags([], { ...defaults, tagMode: 'manual', openTag: '[P]', closeTag: '[/P]' }), { openTag: '[P]', closeTag: '[/P]' });
});
test('upgrade migrates old default to auto and preserves user custom tags', () => {
    assert.equal(migrateSettings({ openTag: '<Abstract>', closeTag: '</Abstract>' }).tagMode, 'auto');
    assert.equal(migrateSettings({ openTag: '<Custom>', closeTag: '</Custom>' }).tagMode, 'manual');
    assert.equal(migrateSettings({ tagMode: 'manual', openTag: '<Abstract>', closeTag: '</Abstract>' }).tagMode, 'manual');
});
test('both stages preserve expanded memory, worldbook, history and multimodal input without mutation', () => {
    const original = [{ role: 'system', content: '世界书\n柏宝书记忆：已展开' }, { role: 'user', content: [{ type: 'text', text: '用户本轮输入' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }];
    const snapshot = structuredClone(original);
    const planner = planningMessages(original, config);
    const writer = writingMessages(original, '本轮安排', config);
    assert.deepEqual(planner.slice(0, -1), snapshot);
    assert.deepEqual(writer.slice(0, -1), snapshot);
    planner[0].content = 'changed';
    assert.deepEqual(original, snapshot);
    assert.match(writer.at(-1).content, /正文和要求的其他成品/);
    assert.match(writer.at(-1).content, /原始上下文要求生成的成品照常生成/);
});
test('exact adapter edits instructions but never history/user input', () => {
    const messages = ['system', 'developer', 'user', 'assistant'].map(role => ({ role, content: '先输出规划；再生成状态栏' }));
    const out = writingMessages(messages, '计划', { ...config, rules: JSON.stringify([{ find: '先输出规划', replace: '规划已完成' }]) });
    assert.match(out[0].content, /规划已完成；再生成状态栏/);
    assert.match(out[1].content, /规划已完成/);
    assert.equal(out[2].content, messages[2].content);
    assert.equal(out[3].content, messages[3].content);
});
test('custom delimiters work without regex assumptions', () => {
    assert.equal(extractPlan(' [plan+]内容[/plan+] ', { ...config, openTag: '[plan+]', closeTag: '[/plan+]' }, 'stop'), '内容');
});
test('incomplete, nested, empty or truncated plans cannot be injected', () => {
    for (const text of ['', '<Abstract>x', '<Abstract></Abstract>', '<Abstract>x<Abstract>y</Abstract>']) {
        assert.throws(() => extractPlan(text, config, 'stop'));
    }
    assert.throws(() => extractPlan('<Abstract>完整外观</Abstract>', config, 'length'));
});
test('quiet, impersonation, continuation and tool rounds never invoke planner', () => {
    const messages = [{ role: 'user', content: 'test' }];
    for (const type of ['quiet', 'impersonate', 'continue']) assert.equal(eligibleRequest({ type, messages }), false);
    for (const type of [undefined, 'normal', 'regenerate', 'swipe']) assert.equal(eligibleRequest({ type, messages }), true);
    assert.equal(eligibleRequest({ messages: [{ role: 'tool', content: 'x' }] }), false);
});
test('detect unresolved BaiBai macros including parameterized form', () => {
    for (const content of ['{{bbsVars}}', '{{bbsSnapshot::42::after}}']) assert.equal(unresolvedBaiBaiMacros([{ content }]), true);
    assert.equal(unresolvedBaiBaiMacros([{ content: '柏宝书记忆已展开' }]), false);
});
test('invalid settings fail before a request', () => {
    validateSettings(config);
    for (const change of [{ apiUrl: 'file:///tmp/a' }, { apiUrl: 'https://key:secret@example.org' }, { maxTokens: -1 }, { rules: '[{"find":"","replace":""}]' }, { openTag: '</Abstract>' }]) {
        assert.throws(() => validateSettings({ ...config, ...change }));
    }
});


test('preset planning contract migrates previous defaults but preserves custom instructions',()=>{
    const old='按当前预设已启用的写作准备问题逐项完成本轮公开创作规划。保留主题、编号、具体依据和创作要求；区分已发生事实与本轮拟写安排。只输出规划，不生成正文、状态栏、时间戳或其他附加成品。';
    assert.notEqual(migrateSettings({plannerInstruction:old}).plannerInstruction,old);
    assert.equal(migrateSettings({plannerInstruction:'我的补充要求'}).plannerInstruction,'我的补充要求');
    const message=planningMessages([],{...config,plannerInstruction:'我的补充要求'}).at(-1).content;
    assert.match(message,/不增加未要求/);
    assert.match(message,/每个召回、读取、检查和核算任务/);
    assert.doesNotMatch(message,/不输出规划区块之外的正文、顶栏、状态栏/);
    assert.match(message,/在所属步骤下写出具体结果/);
    assert.match(message,/输入中的各个规划步骤与输出中的步骤须逐一对应/);
    assert.match(message,/<Abstract>/);
});

test('declarative planning requirements migrate and remain binding on the writer',()=>{
    const previous='按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号与子问题，区分已发生事实与本轮拟写安排。';
    const migrated=migrateSettings({plannerInstruction:previous});
    assert.match(migrated.plannerInstruction,/分阶段的协作写作/);
    const source=[{role:'system',content:'## 写作指导\n保持有限视角\n## 推进速度\n1. 缓慢推进\n2. 短段落\n3. 对话占三成\n4. 避免哪些重复？'}];
    const original=structuredClone(source);
    const plan=planningMessages(source,{...config,...migrated}).at(-1).content;
    assert.match(plan,/原有标题、层级及编号/);

    assert.doesNotMatch(plan,/变量宏|宏占位符|是否使用宏|展开后的/);
    assert.doesNotMatch(plan,/不输出状态栏/);

    assert.match(plan,/本轮安排：/);
    assert.match(plan,/作用对象、单位、范围、强度、条件及否定关系/);
    assert.doesNotMatch(plan,/不自行补充实施方案/);
    const writer=writingMessages(source,'本轮安排',{...config,writerInstruction:'自定义正文要求'});
    assert.match(writer.at(-1).content,/规划未复述某项要求不代表该要求失效/);
    assert.match(writer.at(-1).content,/自定义正文要求/);
    assert.deepEqual(source,original);
});


test('quoted delimiter references inside a plan do not close its outer block',()=>{
    const settings={...config,openTag:'<Think>',closeTag:'</Think>'};
    const content='格式引用：`<Think>` 和 `</Think>`。\n后续内容';
    assert.equal(extractPlan('<Think>\n'+content+'\n</Think>',settings,'stop'),content);
    for(const text of ['`<Think>`x`</Think>`','<Think>x<Think>y</Think>'])assert.throws(()=>extractPlan(text,settings,'stop'));
    const custom={...config,openTag:'[plan+]',closeTag:'[/plan+]'};
    assert.equal(extractPlan('[plan+]引用 `[/plan+]`[/plan+]',custom,'stop'),'引用 `[/plan+]`');
    assert.match(planningMessages([],settings).at(-1).content,/不用本插件的规划外层标签/);
});


test('extract first complete planning block and exclude all surrounding output from writer context',()=>{
    const settings={...config,openTag:'<Think>',closeTag:'</Think>'};
    const raw='前言\n<Think>\n原文要求\n引用 `</Think>`\n本轮安排\n</Think>\n英文自检 output_reply\n<Think>另一段</Think>';
    const plan=extractPlan(raw,settings,'stop');
    assert.equal(plan,'原文要求\n引用 `</Think>`\n本轮安排');
    const injected=writingMessages([{role:'user',content:'本轮输入'}],plan,settings).at(-1).content;
    assert.ok(injected.endsWith('<Think>\n'+plan+'\n</Think>'));
    assert.doesNotMatch(injected,/前言|英文自检|output_reply|另一段/);
    assert.equal(extractPlan('前言[plan+]内容[/plan+]尾文',{...settings,openTag:'[plan+]',closeTag:'[/plan+]'},'stop'),'内容');
    assert.throws(()=>extractPlan('<Think>内容</Think>尾文',settings,'length'));
});


test('dev22 planning default upgrades to the approved handoff',()=>{
    const backup=JSON.parse(readFileSync(new URL('../docs/prompt-backups/0.4.0-dev.22.json',import.meta.url),'utf8'));
    const updated=migrateSettings({plannerInstruction:backup.plannerInstruction});
    assert.match(updated.plannerInstruction,/写作准备和创作规划/);
    assert.equal(updated.plannerInstruction,defaults.plannerInstruction);
    const message=planningMessages([],{...updated,openTag:'<ScenePlan>',closeTag:'</ScenePlan>'}).at(-1).content;
    assert.match(message,/5\. 交接内容/);
    assert.ok(message.endsWith('<ScenePlan>规划内容</ScenePlan>。'));
});
