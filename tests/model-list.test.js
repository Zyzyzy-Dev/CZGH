import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchModelList, withModelListTimeout } from '../src/host/model-list.js';
import { createWorkbench } from '../src/host/workbench.js';

const profile={source:'custom',secretId:'saved-ref',connection:{custom_url:'https://saved.example/v1'}};
const options={headers:()=>({'Content-Type':'application/json'}),parseYaml:JSON.parse};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const withSavedSecret=fetch=>async(url,init)=>url==='/api/secrets/read'?json({api_key_custom:[{id:'saved-ref'}]}):fetch(url,init);

test('a missing saved secret cannot fall back to the host active key',async()=>{
    let statusCalls=0;
    await assert.rejects(fetchModelList(profile,{...options,fetch:async url=>{
        if(url==='/api/secrets/read')return json({api_key_custom:[{id:'unrelated-active-ref',active:true}]});
        statusCalls++;return json({data:[{id:'m'}]});
    }}),/密钥.*不存在/);
    assert.equal(statusCalls,0);
});

test('missing local storage credentials fail before requesting any model endpoint',async()=>{
    let calls=0;
    await assert.rejects(fetchModelList({...profile,keyRef:'missing'},{...options,vault:{get:async()=>{throw Error('此浏览器未保存该方案密钥，请重新输入并覆盖方案；未使用酒馆活动密钥。');}},fetch:async()=>{calls++;return json({data:[{id:'m'}]});}}),/未保存该方案密钥/);
    assert.equal(calls,0);
});

test('model list uses the selected credential and normalizes a usable list',async()=>{
    let body;
    const result=await fetchModelList(profile,{...options,fetch:withSavedSecret(async(url,init)=>{body=JSON.parse(init.body);return json({data:[{id:' model-a '},{id:'model-a'},{id:'model-b'},{id:''},{}]});})});
    assert.deepEqual(result,['model-a','model-b']);
    assert.equal(body.secret_id,'saved-ref');assert.equal(body.custom_url,'https://saved.example/v1');
    assert.equal(body.model,'models');
});

test('temporary key overrides only this model request and does not access stored credentials',async()=>{
    for(const tauriTavern of [false,true]){
        let request;let vaultReads=0;
        await fetchModelList({...profile,keyRef:'stored-local-ref'},{...options,key:'new-draft-key',tauriTavern,vault:{get:async()=>{vaultReads++;throw Error('must not read');}},fetch:async(url,init)=>{request=JSON.parse(init.body);return json({data:[{id:'m'}]});}});
        assert.equal(vaultReads,0);
        if(tauriTavern){assert.equal(request.proxy_password,'new-draft-key');assert.equal(request.secret_id,undefined);assert.equal(request.reverse_proxy,profile.connection.custom_url);}
        else assert.equal(JSON.parse(request.custom_include_headers).Authorization,'Bearer new-draft-key');
    }
    assert.equal(profile.secretId,'saved-ref');
});

test('model failures explain HTTP status, provider errors, invalid responses and empty lists without echoing secrets',async()=>{
    const cases=[
        [()=>json({error:'echo secret-value'},401),/401.*密钥/],
        [()=>json({error:'echo secret-value'},403),/403.*权限/],
        [()=>json({error:'echo secret-value'},404),/404.*基础地址/],
        [()=>json({error:'echo secret-value'},429),/429.*额度/],
        [()=>json({error:'echo secret-value'},503),/503.*服务/],
        [()=>json({error:{code:'invalid_api_key',message:'secret-value'}}),/密钥未通过/],
        [()=>json({error:{code:'insufficient_quota',message:'secret-value'}}),/额度/],
        [()=>json({error:{message:'secret-value'}}),/服务返回了错误/],
        [()=>json({data:[]}),/模型列表为空/],
        [()=>json({data:[{id:null}]}),/模型列表为空/],
        [()=>json({message:'secret-value'}),/没有返回模型列表/],
        [()=>new Response('secret-value'),/无法识别/],
        [()=>Promise.reject(Error('secret-value')),/无法连接/],
    ];
    for(const [fetch,error] of cases)await assert.rejects(fetchModelList(profile,{...options,fetch:withSavedSecret(fetch)}),value=>{assert.match(value.message,error);assert.ok(!value.message.includes('secret-value'));return true;});
});

test('model request timeout releases even when the upstream operation ignores abort',async()=>{
    let signal;
    await assert.rejects(withModelListTimeout(value=>{signal=value;return new Promise(()=>{});},5),/拉取模型超时/);
    assert.equal(signal.aborted,true);
    assert.deepEqual(await withModelListTimeout(async()=>['m'],100),['m']);
});

test('workbench uses the clicked scheme and current URL/key drafts without changing saved connections',async t=>{
    const profiles=[{...profile,id:'one',name:'一',model:'old'},{...profile,id:'two',name:'二',secretId:'second-ref',connection:{custom_url:'https://second.example/v1'}}];
    const context={extensionSettings:{preset_compare_api_manager:{version:1,profiles},czgh_external_planner:{apiSelection:'external:one'}},chatCompletionSettings:{custom_url:'https://native.example/v1',custom_model:'native'}};
    const before=structuredClone(context);let request;
    t.mock.method(globalThis,'fetch',async(url,init)=>{if(url==='/api/secrets/read')return json({api_key_custom:[{id:'saved-ref'},{id:'second-ref'}]});request=JSON.parse(init.body);return json({data:[{id:'working-model'}]});});
    const workbench=createWorkbench({context:()=>context,headers:options.headers,saveSettings:()=>{throw Error('must not save');}});
    assert.deepEqual(await workbench.execute('api.models',{sourceId:'external:two',apiUrl:'https://draft.example/v1',key:'draft-key'}),['working-model']);
    assert.equal(request.custom_url,'https://draft.example/v1');
    assert.equal(JSON.parse(request.custom_include_headers).Authorization,'Bearer draft-key');
    await workbench.execute('api.models',{sourceId:'external:two'});
    assert.equal(request.secret_id,'second-ref');assert.equal(request.custom_url,'https://second.example/v1');
    assert.deepEqual(context,before);
});
