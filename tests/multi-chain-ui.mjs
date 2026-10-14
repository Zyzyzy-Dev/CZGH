import assert from 'node:assert/strict';

// Called with the settings view and its advanced section open.
export async function checkMultiChainUi(page, frame) {
    const checkbox=frame.getByLabel('多思维链',{exact:true});
    const mode=frame.getByLabel('规划标签',{exact:true});
    const saveTag=async(label,key,value)=>{
        const input=frame.getByLabel(label,{exact:true});
        await input.fill(value);await input.dispatchEvent('change');
        await page.waitForFunction(({key,value})=>context.extensionSettings.czgh_external_planner[key]===value,{key,value});
    };
    const settings=await page.evaluate(()=>{
        const {multiChain,tagMode,openTag,closeTag}=context.extensionSettings.czgh_external_planner;
        return {multiChain,tagMode,openTag,closeTag};
    });
    assert.equal(await checkbox.isChecked(),false,'existing users keep the single-chain mode');
    assert.equal(await mode.isVisible(),true);
    await mode.selectOption('manual');
    await saveTag('开始标签','openTag','<saved-plan>');
    await saveTag('结束标签','closeTag','</saved-plan>');
    await checkbox.check();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.multiChain===true);
    for(const label of ['规划标签','开始标签','结束标签'])assert.equal(await frame.getByLabel(label,{exact:true}).count(),0);
    await frame.getByText('适用于分别输出多种规划的预设；按原顺序保留各规划区块。',{exact:true}).waitFor();
    await checkbox.uncheck();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.multiChain===false);
    assert.equal(await mode.inputValue(),'manual');
    assert.equal(await frame.getByLabel('开始标签',{exact:true}).inputValue(),'<saved-plan>');
    assert.equal(await frame.getByLabel('结束标签',{exact:true}).inputValue(),'</saved-plan>');
    await saveTag('开始标签','openTag',settings.openTag);
    await saveTag('结束标签','closeTag',settings.closeTag);
    await mode.selectOption(settings.tagMode);
    await page.waitForFunction(expected=>{
        const s=context.extensionSettings.czgh_external_planner;
        return s.tagMode===expected.tagMode&&s.openTag===expected.openTag&&s.closeTag===expected.closeTag&&!s.multiChain;
    },settings);
}

// Reuses the native body lifecycle fixture installed by checkReplyUi.
export async function checkMultiChainFlow(page) {
    let calls=0,sent;
    const plan='<战斗思考>战斗安排</战斗思考>\n\n<thinking>人物与情景安排</thinking>';
    const url='**/api/backends/chat-completions/generate';
    await page.route(url,async route=>{
        calls++;sent=route.request().postDataJSON();
        await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:plan+'\n<content>正文不应在规划中</content>'},finish_reason:'stop'}]})});
    });
    try {
        await page.evaluate(async()=>{
            Object.assign(context.extensionSettings.czgh_external_planner,{multiChain:true,autoReply:false,stream:false});
            context.getPresetManager().getPresetList().presets[0].prompts.find(p=>p.identifier==='main').content='<thinking>人物与情景规划</thinking>\n<战斗思考>战斗规划</战斗思考>';
            await window.replyUi.switchChat('multi-chain',[{is_user:true,mes:'多区块生成与恢复'}]);
            window.replyUi.launch('normal','http-failure');
        });
        const floor=page.frameLocator('.mes[mesid="0"] iframe[title="本楼创作规划"]');
        await floor.getByText('· 等待生成正文',{exact:true}).waitFor();
        assert.equal(calls,1);assert.match(sent.messages.at(-1).content,/分别输出各规划区块/);
        const saved=await page.evaluate(()=>window.replyUi.saved['multi-chain'][0].extra.czghCreativePlanningDraft);
        assert.equal(saved.multiChain,true);assert.equal(saved.text,plan);
        await page.evaluate(async()=>{
            await window.replyUi.switchChat('multi-chain-other',[{is_user:true,mes:'其他聊天'}]);
            await window.replyUi.running;
            context.extensionSettings.czgh_external_planner.multiChain=false;
            await window.replyUi.switchChat('multi-chain',window.replyUi.saved['multi-chain']);
        });
        await floor.getByText('· 规划已完成',{exact:true}).waitFor();
        await floor.locator('summary').click();
        assert.equal(await floor.locator('pre').textContent(),plan);
        for (const outcome of ['http-failure','success']) {
            const before=await page.evaluate(value=>{window.replyUi.outcomes.push(value);return window.replyUi.settled;},outcome);
            await floor.getByRole('button',{name:'生成正文回复',exact:true}).click();
            await page.waitForFunction(previous=>window.replyUi.settled>previous,before);
            if(outcome==='http-failure')await page.waitForFunction(()=>!document.querySelector('.mes[mesid="0"] iframe')?.contentDocument?.querySelector('#resume')?.disabled);
        }
        await page.waitForFunction(()=>!!context.chat[1]?.extra?.czghCreativePlanning?.[0]);
        const bound=await page.evaluate(()=>context.chat[1].extra.czghCreativePlanning[0]);
        assert.equal(bound.multiChain,true);assert.equal(bound.text,plan);assert.equal(calls,1);
        // The bound floor has no phase; it must still render the original blocks once.
        await page.waitForFunction(expected=>document.querySelector('.mes[mesid="0"] iframe')?.contentDocument?.querySelector('pre')?.textContent===expected,plan);
        const handoffs=await page.evaluate(()=>window.replyUi.attempts.slice(-2).map(a=>a.request.messages.at(-1).content));
        for(const message of handoffs){assert.ok(message.endsWith(plan));assert.doesNotMatch(message,/正文不应在规划中/);}
    } finally {await page.unroute(url);}
}
