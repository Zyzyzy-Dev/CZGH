import assert from 'node:assert/strict';

// Called with the settings view open and external:p1 selected by browser-check.
export async function checkApiUi(page, frame) {
    const chooser=frame.getByLabel('API 方案',{exact:true});
    const modelButton=frame.getByRole('button',{name:'拉取模型',exact:true});
    const feedback=frame.locator('[data-model-feedback]');
    const saved=await page.evaluate(()=>JSON.stringify(context.extensionSettings.preset_compare_api_manager));
    const native=await page.evaluate(()=>JSON.stringify(context.chatCompletionSettings));
    assert.match(await frame.getByLabel('Key',{exact:true}).getAttribute('placeholder'),/已关联保存的密钥/);
    assert.match(await frame.locator('[data-key-status]').textContent(),/已关联保存的密钥/);

    const pattern='**/api/backends/chat-completions/status';
    let mode='deferred', release, request;
    const handler=async route=>{
        request=route.request().postDataJSON();
        if(mode==='deferred')await new Promise(resolve=>release=resolve);
        const status=mode==='401'?401:200;
        const body=mode==='401'?{error:'echo private-test-key'}:mode==='api-error'?{error:{code:'invalid_api_key',message:'echo private-test-key'}}:mode==='empty'?{data:[]}:{data:[{id:'api-ui-model-a'},{id:'api-ui-model-b'}]};
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    };
    await page.route(pattern,handler);
    try {
        await modelButton.click();
        await feedback.filter({hasText:'正在连接'}).waitFor();
        assert.equal(await modelButton.isDisabled(),true);
        for(let i=0;!release&&i<100;i++)await page.waitForTimeout(10);
        assert.ok(release,'model status request started');release();
        await feedback.filter({hasText:'已获取 2 个模型'}).waitFor();
        assert.equal(await modelButton.isDisabled(),false);
        assert.equal(request.secret_id,'s1');
        assert.deepEqual(await frame.locator('#model-list option').evaluateAll(options=>options.map(x=>x.value)),['api-ui-model-a','api-ui-model-b']);

        await chooser.selectOption('current');
        await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.apiSelection==='current');
        await frame.locator('[data-key-status]').filter({hasText:'密钥由酒馆当前连接提供'}).waitFor();
        assert.match(await frame.getByLabel('Key',{exact:true}).getAttribute('placeholder'),/酒馆当前连接/);
        assert.equal(await frame.locator('#model-list option').count(),0);
        await chooser.selectOption('external:p1');
        await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.apiSelection==='external:p1');
        await frame.locator('[data-key-status]').filter({hasText:'已关联保存的密钥'}).waitFor();

        for(const [next,expected] of [['401','HTTP 401'],['api-error','密钥未通过验证'],['empty','模型列表为空']]){
            mode=next;await modelButton.click();
            await feedback.filter({hasText:expected}).waitFor();
            assert.equal(await modelButton.isDisabled(),false);
            assert.ok(!(await feedback.textContent()).includes('private-test-key'));
            assert.equal(await frame.locator('#model-list option').count(),0);
        }
        // A separate state update may clear the footer status, but the API
        // error beside the model field must remain available.
        const stream=frame.getByLabel('流式输出规划',{exact:true});
        const checked=await stream.isChecked();await stream.setChecked(!checked);
        await page.waitForFunction(value=>context.extensionSettings.czgh_external_planner.stream===value,!checked);
        await feedback.filter({hasText:'模型列表为空'}).waitFor();
        await stream.setChecked(checked);
        await page.waitForFunction(value=>context.extensionSettings.czgh_external_planner.stream===value,checked);

        mode='success';
        await frame.getByLabel('URL',{exact:true}).fill('https://draft-models.example/v1');
        await frame.getByLabel('Key',{exact:true}).fill('draft-model-key');
        await frame.locator('[data-key-status]').filter({hasText:'尚未保存'}).waitFor();
        await modelButton.click();await feedback.filter({hasText:'已获取 2 个模型'}).waitFor();
        assert.equal(request.custom_url,'https://draft-models.example/v1');
        assert.equal(JSON.parse(request.custom_include_headers).Authorization,'Bearer draft-model-key');
        assert.equal(await page.evaluate(()=>JSON.stringify(context.extensionSettings.preset_compare_api_manager)),saved);
        assert.equal(await page.evaluate(()=>JSON.stringify(context.chatCompletionSettings)),native);
    } finally {
        release?.();await page.unroute(pattern,handler);
        await chooser.selectOption('current');
        await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.apiSelection==='current');
        await chooser.selectOption('external:p1');
        await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.apiSelection==='external:p1');
        await frame.locator('[data-key-status]').filter({hasText:'已关联保存的密钥'}).waitFor();
    }
}
