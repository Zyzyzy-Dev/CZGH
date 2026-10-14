import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiSchemes } from '../src/host/api-schemes.js';
import { migrateSchemes } from '../src/planning/schemes.js';

test('API schemes are independent and unsuccessful persistence leaves selection intact',async()=>{
    let state=migrateSchemes({}); let fail=false;
    const external=[{id:'e',name:'外部',source:'custom',model:'m',secretId:'s',connection:{custom_url:'https://example.com/v1'}}];
    const host={read:()=>state,write:async value=>{if(fail)throw Error('save failed');state=value;},external:()=>external,current:()=>({source:'custom',model:'current',secretId:'active',connection:{custom_url:'https://example.com/v1'}})};
    const api=createApiSchemes(host);
    assert.equal((await api.resolve('external:e')).secretId,'s');
    assert.equal((await api.resolve('current')).secretId,'active');
    await assert.rejects(api.save({id:'external:e',name:'x',config:external[0]}));
    await assert.rejects(api.remove('external:e'));
    const saved=await api.save({name:'本地',config:external[0]});
    assert.equal((await api.resolve('local:'+saved.id)).secretId,'s');
    const before=structuredClone(state); fail=true;
    await assert.rejects(api.save({id:'local:'+saved.id,name:'失败',config:{...external[0],model:'changed'}}));
    assert.deepEqual(state,before);
    assert.equal(external[0].name,'外部');
    assert.ok(!(await api.list()).some(p=>Object.hasOwn(p,'key')));
});

test('local keys persist by reference, survive service recreation and are removed only after last scheme',async()=>{
    let state=migrateSchemes({});const keys=new Map();let fail=false;
    const host={read:()=>state,write:async s=>{if(fail)throw Error('save failed');state=s;},external:()=>[],
        vault:{put:async value=>{const id=crypto.randomUUID();keys.set(id,value);return id;},remove:async id=>keys.delete(id)}};
    let api=createApiSchemes(host);
    const config={source:'custom',model:'m',connection:{custom_url:'https://example.org/v1'}};
    const first=await api.save({name:'持久方案',config,key:'test-local-key'});
    assert.equal(keys.get(first.payload.keyRef),'test-local-key');
    assert.ok(!JSON.stringify(state).includes('test-local-key'));
    const selection=state.apiSelection;api=createApiSchemes(host);
    assert.equal(state.apiSelection,selection);assert.equal((await api.resolve(selection)).keyRef,first.payload.keyRef);
    const copy=await api.save({name:'副本',config:await api.resolve(selection)});
    await api.remove(selection);assert.equal(keys.size,1);
    const before=structuredClone(state);fail=true;
    await assert.rejects(api.save({id:'local:'+copy.id,name:'失败',config,key:'replacement'}));
    assert.deepEqual(state,before);assert.equal(keys.size,1);fail=false;
    await api.remove('local:'+copy.id);assert.equal(keys.size,0);
});

test('API metadata identifies saved external credentials without exposing key values or references',async()=>{
    const external=[{id:'e',name:'外部',source:'custom',model:'external-model',secretId:'secret-ref',key:'must-not-leak',connection:{custom_url:'https://example.com/v1'}},{id:'empty',name:'未保存'}];
    const api=createApiSchemes({read:()=>migrateSchemes({}),external:()=>external,currentSummary:()=>({model:'current-model',connection:{custom_url:'https://current.example/v1'}})});
    const profiles=await api.list();
    assert.equal(profiles.find(p=>p.id==='external:e').hasKey,true);
    assert.equal(profiles.find(p=>p.id==='external:empty').hasKey,false);
    assert.equal(profiles[0].keyState,'current');
    assert.equal(profiles[0].model,'current-model');
    assert.equal(profiles[0].apiUrl,'https://current.example/v1');
    assert.ok(!JSON.stringify(profiles).includes('must-not-leak'));
    assert.ok(!JSON.stringify(profiles).includes('secret-ref'));
});
