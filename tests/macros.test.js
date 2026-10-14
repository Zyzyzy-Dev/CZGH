import test from 'node:test';
import assert from 'node:assert/strict';
import { expandMacros } from '../src/planning/macros.js';
import { selectInjections } from '../src/planning/compatibility.js';

test('unclosed macros and literal opening braces keep their entire tail without blocking',()=>{
    for(const text of ['{{','{{user}','正文前缀\n示例使用 {{ 表示开始\n末尾要求必须保留。','{{// 示例里有 {{ 的写法 }}\n后续规则','{{setvar::a::未闭合 {{user}}\n完整保留末尾']){
        const result=expandMacros(text,{snapshot:{macroEnvironment:{user:'玩家'}}});
        assert.equal(result.text,text);
        assert.equal(result.diagnostics.some(d=>d.blocking),false);
    }
});

test('valid prefix macros still run but an unclosed span cannot execute nested variable writes',()=>{
    const tail='{{setvar::a::未闭合\n{{setvar::b::不应执行}}\n后续文字 {{char}}';
    const variables={local:{a:'旧值',b:'旧值'},global:{}};
    const result=expandMacros('{{setvar::a::有效值}}{{getvar::a}} {{user}}\n'+tail,{snapshot:{macroEnvironment:{user:'玩家',char:'角色'}},variables});
    assert.equal(result.text,'有效值 玩家\n'+tail);
    assert.equal(result.variables.local.a,'有效值');assert.equal(result.variables.local.b,'旧值');
    assert.equal(variables.local.a,'旧值');assert.equal(result.diagnostics.some(d=>d.blocking),false);
});

test('literal recovery does not bypass valid-macro dependencies, variable validation or nesting limits',()=>{
    for(const text of ['{{setvar::__proto__::x}}','{{get_message_variable::hp}}','{{'.repeat(42)+'user'+'}}'.repeat(42)]){
        assert.ok(expandMacros(text,{snapshot:{macroEnvironment:{}}}).diagnostics.some(d=>d.blocking));
    }
});
test('isolated variables expand without writing back and unchecked memory macros are excluded',()=>{
    const snapshot={macroEnvironment:{user:'玩家',char:'角色',bbs:{vars:{好感:5},state:{time:'早晨'}}},injections:{baibai_book_memory_history:{value:'旧事',position:1,depth:2},sp_outline_step:{value:'大纲',position:1,depth:3},foreign:{value:'其他'}}};
    const variables={local:{a:'原值'},global:{}};
    const result=expandMacros('{{setvar::a::新值}}{{getvar::a}} {{user}} {{bbsVars}}',{snapshot,compatibilityIds:[],variables});
    assert.equal(result.text,'新值 玩家 ');
    assert.equal(variables.local.a,'原值');
    assert.equal(result.variables.local.a,'新值');
    assert.ok(result.diagnostics.some(d=>d.code==='excluded-macro'));
    assert.equal(expandMacros('{{bbsVar::好感}}',{snapshot,compatibilityIds:['baibai'],variables}).text,'5');
    assert.deepEqual(selectInjections(snapshot,['seven-days']).items.map(x=>x.key),['sp_outline_step']);
    assert.equal(selectInjections(snapshot,['baibai']).items[0].depth,2);
    assert.equal(expandMacros('{{unknown::x}}',{snapshot,compatibilityIds:[],variables}).text,'{{unknown::x}}');
});
test('variable values may contain literal single braces and nested macros',()=>{
    const result=expandMacros('{{setvar::panel::<date>{YYYY/MM/DD}</date> {{user}}}}{{getvar::panel}}',{snapshot:{macroEnvironment:{user:'玩家'}},variables:{local:{},global:{}}});
    assert.equal(result.text,'<date>{YYYY/MM/DD}</date> 玩家');
    assert.equal(result.diagnostics.filter(d=>d.blocking).length,0);
});

test('template placeholders in the reported message remain literal without blocking',()=>{
 const text='{{图片/视频/分享内容简述}} {{宏}} {{宏}} {{无}}';
 const result=expandMacros(text,{snapshot:{macroEnvironment:{}}});
 assert.equal(result.text,text);assert.equal(result.diagnostics.some(d=>d.blocking),false);
});
