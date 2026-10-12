import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseRecallQuery, recallProse } from '../src/planning/database-recall.js';
import { buildPlanningContext } from '../src/planning/context.js';

function fixture(){
    const entry=(uid,comment,content,options={})=>({uid,comment,content,constant:true,position:0,order:100,...options});
    return {id:'s',chatId:'chat',maxContext:10000,worldSettings:{},character:{},macroEnvironment:{user:'玩家',char:'角色'},
        currentPreset:'P',presets:{P:{prompts:[{identifier:'main',role:'system',content:'规则'},{identifier:'worldInfoBefore',marker:true},{identifier:'chatHistory',marker:true}],prompt_order:[{character_id:100001,order:['main','worldInfoBefore','chatHistory'].map(identifier=>({identifier,enabled:true}))}]}},
        bindings:{character:['记忆'],global:['记忆']},books:{记忆:{entries:{
            1:entry(1,'ACU-[当前卡]-TavernDB-ACU-ReadableDataTable','地点：港口'),
            2:entry(2,'ACU-[当前卡]-重要人物条目1','船长认识玩家',{constant:false,key:['船长']}),
            3:entry(3,'ACU-[当前卡]-总结条目1','昨晚约定会面',{disable:true}),
            4:entry(4,'普通设定','港口正在下雨'),
        }}},history:[{role:'user',content:'去找船长'}],injections:{}};
}
const build=(snapshot,selection={})=>buildPlanningContext({snapshot,selection,tokenize:async text=>text.length});

test('explicit database source reads inactive memos once, respects private overrides and never mutates source',async()=>{
    const snapshot=fixture();snapshot.databaseTarget='记忆';
    snapshot.books.记忆.entries[3].comment='ACU-[当前卡]-TavernDB-ACU-CustomExport-纪要-3';
    const before=structuredClone(snapshot);
    const result=await build(snapshot,{compatibilityIds:['database']});
    const text=result.messages.map(m=>m.content).join('\n');
    assert.equal(text.split('昨晚约定会面').length-1,1);
    assert.ok(result.sourceManifest.plugins.includes('database_memory'));
    assert.ok(result.sourceManifest.database.some(([,uid])=>uid===3));
    assert.deepEqual(snapshot,before);
    const off=await build(snapshot,{compatibilityIds:['database'],entryOverrides:{'["记忆",3]':false}});
    assert.ok(!off.messages.some(m=>m.content.includes('昨晚约定会面')));
});

test('database source keeps recent book entries within limit and refuses a missing explicit target',async()=>{
    const snapshot=fixture();snapshot.databaseTarget='记忆';
    snapshot.books.记忆.entries[7]={uid:7,comment:'总结条目7',content:'较新纪要',constant:true,position:0};
    const result=await build(snapshot,{compatibilityIds:['database'],databaseLimit:1});
    const text=result.messages.map(m=>m.content).join('\n');
    assert.ok(text.includes('较新纪要'));assert.ok(!text.includes('昨晚约定会面'));
    snapshot.databaseTarget='不存在';
    await assert.rejects(build(snapshot,{compatibilityIds:['database']}),/数据库.*世界书/);
});

test('independent database memory is included in input budget and rejects selected query templates',async()=>{
    const snapshot=fixture();snapshot.databaseTarget='记忆';snapshot.inputBudget=5;
    await assert.rejects(build(snapshot,{compatibilityIds:['database']}),/预算/);
    delete snapshot.inputBudget;snapshot.books.记忆.entries[3].content='{[sql "SELECT secret"]}';
    await assert.rejects(build(snapshot,{compatibilityIds:['database']}),/数据库.*模板/);
    await assert.doesNotReject(build(snapshot,{compatibilityIds:['database'],bookOverrides:{记忆:false}}));
});

test('database exported memories follow world-book selection and appear once with source attribution',async()=>{
    const snapshot=fixture(),before=structuredClone(snapshot);
    const result=await build(snapshot,{extraBooks:['记忆']});
    const text=result.messages.map(m=>m.content).join('\n');
    assert.equal(text.split('地点：港口').length-1,1);
    assert.ok(text.includes('船长认识玩家'));
    assert.ok(text.includes('港口正在下雨'));
    assert.ok(!text.includes('昨晚约定会面'));
    assert.deepEqual(result.sourceManifest.database,[['记忆',1],['记忆',2]]);
    assert.deepEqual(snapshot,before);
    const excluded=await build(snapshot,{bookOverrides:{记忆:false}});
    assert.deepEqual(excluded.sourceManifest.database,[]);
    assert.ok(!excluded.messages.some(m=>m.content.includes('地点：港口')));
});

test('database keyword entries and individual switches retain native scan behavior',async()=>{
    const snapshot=fixture();snapshot.history[0].content='休息';
    const result=await build(snapshot,{entryOverrides:{'["记忆",1]':false}});
    assert.deepEqual(result.sourceManifest.database,[]);
    assert.ok(result.messages.some(m=>m.content.includes('港口正在下雨')));
});

test('unresolved database queries block only activated database exports, without executing them',async()=>{
    for(const text of ['{[db.global_state.select()]}','{[sql "SELECT * FROM global_state"]}','<if cell="0,0">旧港口</if>']){
        const snapshot=fixture();snapshot.books.记忆.entries[1].content=text;
        await assert.rejects(build(snapshot),/数据库.*模板/);
        await assert.doesNotReject(build(snapshot,{entryOverrides:{'["记忆",1]':false}}));
        snapshot.books.记忆.entries[1].constant=false;snapshot.books.记忆.entries[1].key=['不会命中'];
        await assert.doesNotReject(build(snapshot));
    }
    const snapshot=fixture();snapshot.books.记忆.entries[4].content='<if cell="demo">普通文本</if>';
    await assert.doesNotReject(build(snapshot));
});

test('database identification does not claim unrelated similarly named rows or disabled raw storage',async()=>{
    const snapshot=fixture();
    snapshot.books.记忆.entries[5]={uid:5,comment:'ACU-[其他卡]-总结条目1',constant:true,content:'普通同名行',position:0};
    snapshot.books.记忆.entries[6]={uid:6,comment:'外部导入-TavernDB-ACU-ImportedJsonData-Selected',disable:true,content:'{"private":"not for prompt"}',position:0};
    const result=await build(snapshot);
    assert.deepEqual(result.sourceManifest.database,[['记忆',1],['记忆',2]]);
    assert.ok(!result.messages.some(m=>m.content.includes('not for prompt')));
});

test('database recall selects relevant old memos using names and keyword tags, then restores book order',async()=>{
    const snapshot=fixture();snapshot.databaseTarget='记忆';
    snapshot.books.记忆.entries={
        1:{uid:1,comment:'总结条目99',content:'旧约定的具体内容',key:['灯塔钥匙'],disable:true},
        2:{uid:2,comment:'总结条目2',content:'刚刚吃了午饭',disable:true},
        3:{uid:3,comment:'总结条目1',content:'灯塔钥匙放在抽屉里',disable:true},
    };
    snapshot.userInput='寻找灯塔钥匙';
    const result=await build(snapshot,{compatibilityIds:['database'],databaseLimit:2});
    assert.deepEqual(result.sourceManifest.database,[['记忆',1],['记忆',3]]);
    snapshot.userInput='zzzz';snapshot.history=[];
    const fallback=await build(snapshot,{compatibilityIds:['database'],databaseLimit:1});
    assert.deepEqual(fallback.sourceManifest.database,[['记忆',3]],'ties prefer later book position, not numeric suffix');
});

test('database recall query uses six AI replies, strips non-content blocks and caps each tail',()=>{
    assert.equal(recallProse('<think>噪音</think><content>正文</content>'),'正文');
    assert.equal(recallProse('<outer>噪音<content>保留</content></outer>'),'保留');
    const query=databaseRecallQuery({userInput:'当前问题',databaseRecent:['不要这个',...Array.from({length:6},(_,i)=>'<think>秘密</think><content>'+String(i).repeat(800)+'</content>')]});
    assert.ok(query.startsWith('当前问题'));assert.ok(!query.includes('秘密'));assert.ok(!query.includes('不要这个'));
    assert.equal(query.split('\n').at(-1).length,700);
});

test('auto database mode routes current recall codes through chat world keyword scan without ranking limit',async()=>{
 const snapshot=fixture();snapshot.bindings={chat:['记忆']};snapshot.databaseTarget='记忆';
 snapshot.books.记忆.entries={1:{uid:1,comment:'总结条目1',content:'编码命中详细纪要',key:['AM0001'],constant:false},2:{uid:2,comment:'总结条目2',content:'不相关纪要',key:['AM0002'],constant:false}};
 snapshot.userInput='继续 <recall>AM0001</recall>';snapshot.history=[{role:'user',content:snapshot.userInput}];
 const result=await build(snapshot,{compatibilityIds:['database'],databaseLimit:1});
 assert.equal(result.sourceManifest.databaseMode,'keywords');
 assert.ok(result.messages.some(m=>m.content.includes('编码命中详细纪要')));
 assert.ok(!result.messages.some(m=>m.content.includes('不相关纪要')));
 assert.ok(!result.sourceManifest.plugins.includes('database_memory'));
 const missing=structuredClone(snapshot);missing.userInput='继续 <recall>AM9999</recall>';missing.history[0].content=missing.userInput;
 const empty=await build(missing,{compatibilityIds:['database']});assert.deepEqual(empty.sourceManifest.database,[]);
 const off=await build(snapshot,{compatibilityIds:['database'],entryOverrides:{'["记忆",1]':false}});assert.deepEqual(off.sourceManifest.database,[]);
 const fallback=structuredClone(snapshot);fallback.userInput='普通输入';fallback.history=[{role:'user',content:'普通输入'}];
 assert.equal((await build(fallback,{compatibilityIds:['database']})).sourceManifest.databaseMode,'ranked');
});

test('database auto selection ignores old recall blocks and refuses incomplete current results',async()=>{
 const snapshot=fixture();snapshot.databaseTarget='记忆';snapshot.userInput='当前普通输入';
 snapshot.history.unshift({role:'user',content:'<recall>AM0001</recall>'});
 assert.equal((await build(snapshot,{compatibilityIds:['database']})).sourceManifest.databaseMode,'ranked');
 snapshot.userInput='<recall>AM0001';await assert.rejects(build(snapshot,{compatibilityIds:['database']}),/尚未完整/);
 snapshot.userInput='<recall></recall>';assert.equal((await build(snapshot,{compatibilityIds:['database']})).sourceManifest.databaseMode,'keywords');
 snapshot.userInput='自定义编码格式';assert.equal((await build(snapshot,{compatibilityIds:['database'],databaseMode:'keywords'})).sourceManifest.databaseMode,'keywords');
});
