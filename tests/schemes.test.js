import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSchemes, applySchemeOperation, schemeSelectionState, rememberScheme } from '../src/planning/schemes.js';

test('obsolete database modes migrate to automatic routing and sources migrate into worldbook settings',()=>{
    for(const databaseMode of ['keywords','ranked','auto']){
        const saved=migrateSchemes({});Object.assign(saved.selection,{databaseMode,databaseBook:'记忆',databaseLimit:12,compatibilityIds:['database'],extraBooks:['已有书']});
        const migrated=migrateSchemes(saved);
        assert.equal(migrated.selection.databaseMode,undefined);
        assert.equal(migrated.selection.databaseBook,undefined);assert.equal(migrated.selection.databaseLimit,undefined);
        assert.deepEqual(migrated.selection.extraBooks,['已有书','记忆']);assert.deepEqual(migrateSchemes(migrated),migrated);
        assert.equal(saved.selection.databaseMode,databaseMode);
    }
});

test('local schemes preserve external settings and reject missing overwrite targets', () => {
    const original = { apiUrl: 'https://example.com/v1', model: 'm', profileId: '', other: { value: 1 } };
    const before = structuredClone(original);
    const state = migrateSchemes(original);
    assert.deepEqual(original, before);
    assert.equal(state.schemes.api[0].payload.apiUrl, original.apiUrl);
    const saved = applySchemeOperation(state, { kind: 'preset', operation: 'create', name: '剧情', payload: { presetId: 'P', promptOverrides: { a: false } } });
    assert.equal(state.schemes.preset.length, 0);
    const id = saved.schemes.preset[0].id;
    const changed = applySchemeOperation(saved, {kind:'preset',operation:'overwrite',id,name:'修改',payload:{presetId:'Q'}});
    assert.equal(changed.schemes.preset[0].payload.presetId, 'Q');
    assert.equal(saved.schemes.preset[0].payload.presetId, 'P');
    assert.equal(applySchemeOperation(changed,{kind:'preset',operation:'delete',id}).schemes.preset.length,0);
    assert.throws(()=>applySchemeOperation(state,{kind:'api',operation:'overwrite',id:'external:p',name:'x',payload:{}}));
});
test('scheme storage rejects secrets, hostile object keys and invalid kinds', () => {
    const state=migrateSchemes({});
    for (const payload of [{key:'secret'},{connection:{Authorization:'secret'}},JSON.parse('{"__proto__":{"x":1}}')]) {
        assert.throws(()=>applySchemeOperation(state,{kind:'api',operation:'create',name:'x',payload}));
    }
    assert.throws(()=>applySchemeOperation(state,{kind:'constructor',operation:'create',name:'x',payload:{}}));
    assert.deepEqual(migrateSchemes(state),state);
});


test('preset and world selections persist independently and dirty state follows saved payload',()=>{
    let s=migrateSchemes({});
    assert.equal(s.schemeSelection.preset,'');
    s=applySchemeOperation(s,{kind:'preset',operation:'create',name:'P',payload:{presetId:'P',promptOverrides:{},groupOverrides:{}}});
    const id=s.schemes.preset[0].id;
    s.selection.presetId='P';rememberScheme(s,'preset',id);
    assert.equal(schemeSelectionState(s,'preset').dirty,false);
    s.selection.promptOverrides.a=false;
    assert.equal(schemeSelectionState(s,'preset').dirty,true);
    assert.equal(migrateSchemes(s).schemeSelection.preset,id);
    rememberScheme(s,'world','@current');s.selection.extraBooks.push('new');
    assert.equal(schemeSelectionState(s,'world').dirty,true);
    assert.equal(schemeSelectionState(s,'preset').id,id);
    const removed=applySchemeOperation(s,{kind:'preset',operation:'delete',id});
    assert.equal(removed.schemeSelection.preset,'');
});
