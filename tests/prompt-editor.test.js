import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSettings, planningMessages, writingMessages } from '../src/planning/core.js';
import { cleanSettings } from '../src/bridge/protocol.js';

test('released defaults upgrade both prompts while edited and empty prompts survive',async()=>{
    const {readFile}=await import('node:fs/promises');
    const {promptDefaults,defaults}=await import('../src/planning/core.js');
    for(const version of ['0.5.2','0.5.3-dev.1']){
        const old=JSON.parse(await readFile(new URL('../docs/prompt-backups/'+version+'.json',import.meta.url),'utf8'));
        for(const saved of [old,{...old,plannerPrompt:old.plannerPrompt.replace(/\n/g,'\r\n'),writerPrompt:old.writerPrompt.replace(/\n/g,'\r\n')},{plannerInstruction:old.plannerInstruction??old.plannerPrompt.split("\n")[0],writerInstruction:old.writerInstruction??old.writerPrompt.split("\n")[0]}]){
            const migrated=migrateSettings(saved);
            assert.equal(migrated.plannerPrompt,promptDefaults.plannerPrompt);
            assert.equal(migrated.writerPrompt,promptDefaults.writerPrompt);
            assert.equal(migrated.writerInstruction,defaults.writerInstruction);
            assert.deepEqual(migrateSettings(migrated),migrated);
        }
        for(const suffix of ['\n自定义保留',' ']){
            const edited={plannerPrompt:old.plannerPrompt+suffix,writerPrompt:old.writerPrompt+suffix};
            assert.equal(migrateSettings(edited).plannerPrompt,edited.plannerPrompt);
            assert.equal(migrateSettings(edited).writerPrompt,edited.writerPrompt);
        }
        const mixed=migrateSettings({...old,plannerPrompt:'',writerPrompt:'自定义正文'});
        assert.equal(mixed.plannerPrompt,'');assert.equal(mixed.writerPrompt,'自定义正文');
    }
});

test('dev7 full defaults and legacy openings upgrade together while edited and empty prompts survive',async()=>{
    const {readFile}=await import('node:fs/promises');
    const {promptDefaults,defaults}=await import('../src/planning/core.js');
    const old=JSON.parse(await readFile(new URL('../docs/prompt-backups/0.5.2-dev.7.json',import.meta.url),'utf8'));
    for(const saved of [old,{...old,plannerPrompt:old.plannerPrompt.replace(/\n/g,'\r\n'),writerPrompt:old.writerPrompt.replace(/\n/g,'\r\n')},{plannerInstruction:old.plannerInstruction,writerInstruction:old.writerInstruction}]){
        const migrated=migrateSettings(saved);
        assert.equal(migrated.plannerPrompt,promptDefaults.plannerPrompt);
        assert.equal(migrated.writerPrompt,promptDefaults.writerPrompt);
        assert.equal(migrated.plannerInstruction,defaults.plannerInstruction);
        assert.equal(migrated.writerInstruction,defaults.writerInstruction);
        assert.deepEqual(migrateSettings(migrated),migrated);
    }
    for(const suffix of ['\n我的自定义要求',' ']){
        const saved={plannerPrompt:old.plannerPrompt+suffix,writerPrompt:old.writerPrompt+suffix};
        const migrated=migrateSettings(saved);
        assert.equal(migrated.plannerPrompt,saved.plannerPrompt);assert.equal(migrated.writerPrompt,saved.writerPrompt);
    }
    const mixed=migrateSettings({...old,plannerPrompt:'',writerPrompt:'正文自定义'});
    assert.equal(mixed.plannerPrompt,'');assert.equal(mixed.writerPrompt,'正文自定义');
});

test('editable prompts include all instructions and replace them without hidden fixed rules',()=>{
    const initial=migrateSettings({});
    assert.match(initial.plannerPrompt,/5\. 交接内容/);
    assert.match(initial.writerPrompt,/规划未复述某项要求不代表该要求失效/);
    const custom=migrateSettings({...initial,...cleanSettings({plannerPrompt:'规划自定义',writerPrompt:'正文自定义'})});
    const config={...custom,openTag:'<Think>',closeTag:'</Think>'};
    assert.equal(planningMessages([],config).at(-1).content,'规划自定义\n请将完整规划放入当前预设指定的标签中：<Think>规划内容</Think>。');
    assert.equal(writingMessages([],'测试规划',config).at(-1).content,'正文自定义\n\n【本轮创作规划】\n<Think>\n测试规划\n</Think>');
    assert.equal(migrateSettings(custom).plannerPrompt,'规划自定义');
    const legacy=migrateSettings({plannerInstruction:'旧自定义开头',writerInstruction:'旧正文开头'});
    assert.ok(legacy.plannerPrompt.startsWith('旧自定义开头\n'));
    assert.ok(legacy.writerPrompt.startsWith('旧正文开头\n'));
});

test('empty editable prompts are preserved and RPC rejects non-string prompt fields',()=>{
    assert.deepEqual(cleanSettings({plannerPrompt:123,writerPrompt:[]}),{});
    const state=migrateSettings({...migrateSettings({}),plannerPrompt:'',writerPrompt:''});
    assert.equal(state.plannerPrompt,'');assert.equal(state.writerPrompt,'');
});

test('previous complete default upgrades while customized prompts remain intact',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {promptDefaults}=await import('../src/planning/core.js');
 const previous=JSON.parse(await readFile(new URL('../docs/prompt-backups/0.5.2-dev.7.json',import.meta.url),'utf8'));
 const backup=await readFile(new URL('../docs/prompt-backups/dev27-planner-guidance.txt',import.meta.url),'utf8');
 const old=previous.plannerInstruction+'\n'+backup.slice(backup.indexOf('`')+1,backup.lastIndexOf('`')).replace(/\r\n/g,'\n');
 assert.equal(migrateSettings({plannerPrompt:old}).plannerPrompt,promptDefaults.plannerPrompt);
 assert.equal(migrateSettings({plannerPrompt:old+' 自定义'}).plannerPrompt,old+' 自定义');
 assert.match(promptDefaults.plannerPrompt,/不因主题相近而合并、改名或相互替代/);
});
