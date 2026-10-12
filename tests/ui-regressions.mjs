import assert from 'node:assert/strict';

export async function checkUiRegressions(page, frame) {
    const failures=[];
    for (const base of ['预设','世界书']) {
        await frame.getByRole('tab',{name:base,exact:true}).click();
        for(let i=0;i<3;i++) {
            await frame.locator('#show-preview').click();
            await frame.locator('#settings').click();
        }
        await frame.locator('#settings').click();
        try { assert.equal(await frame.getByRole('tab',{name:base,exact:true}).isVisible(),true,`${base}: repeated preview/settings must return to source page`); }
        catch(error){failures.push(error.message);}
        await page.reload();await page.locator('#czgh-planner-menu').click();
        await frame.getByLabel('选择预设',{exact:true}).waitFor();
    }
    await frame.locator('#settings').click();
    const syntax=frame.locator('details').filter({has:frame.locator('summary').filter({hasText:/^提示词语法$/})});
    await syntax.locator('summary').click();
    await frame.locator('summary').filter({hasText:/^高级设置$/}).click();
    const control=frame.getByLabel('规划完成后自动生成正文',{exact:true});
    await control.scrollIntoViewIfNeeded();
    const checkboxBox=await control.locator('..').boundingBox();
    const tagsBox=await frame.getByLabel('规划标签',{exact:true}).boundingBox();
    assert.ok(tagsBox.y-(checkboxBox.y+checkboxBox.height)>=10,'advanced select must leave room for focus outline above');
    const before=await frame.locator('#app').evaluate(el=>el.scrollTop);
    assert.ok(before>0,'fixture must be scrolled');
    const previousSettings=await frame.locator('#app > :first-child').elementHandle();
    await control.uncheck();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.autoReply===false);
    // Wait for the RPC response render, not just the host-side write.
    await previousSettings.waitForElementState('hidden');
    try {
        assert.equal(await syntax.evaluate(el=>el.open),true,'saving must preserve expanded sections');
        assert.ok(Math.abs(await frame.locator('#app').evaluate(el=>el.scrollTop)-before)<3,'saving must preserve scroll position');
        assert.equal(await control.evaluate(el=>el===document.activeElement),true,'saving must preserve keyboard focus');
    } catch(error){failures.push(error.message);}
    await page.reload();await page.locator('#czgh-planner-menu').click();
    await frame.getByLabel('选择预设',{exact:true}).waitFor();
    const reads=await page.evaluate(()=>window.sourceReads||0);
    const previousPreset=await frame.locator('#app > :first-child').elementHandle();
    await frame.getByRole('switch',{name:'写作规则',exact:true}).click();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.selection.promptOverrides.main===false);
    assert.equal(await previousPreset.evaluate(el=>el.isConnected),true,'preset toggle must retain the list DOM');
    try {assert.equal(await page.evaluate(()=>window.sourceReads||0),reads,'entry toggle must not reread world books');}
    catch(error){failures.push(error.message);}
    await frame.getByRole('switch',{name:'写作规则',exact:true}).click();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.selection.promptOverrides.main===true);
    await page.reload();await page.locator('#czgh-planner-menu').click();
    await frame.getByLabel('选择预设',{exact:true}).waitFor();
    assert.deepEqual(failures,[]);
    // Long preset and world-book lists must keep the edited entry in view.
    await page.evaluate(()=>{
        window.worldEntryCount=80;
        for(let i=0;i<80;i++){
            const identifier='long'+i;
            preset.prompts.push({identifier,name:'长列表 '+i,role:'system',content:'测试条目'});
            preset.prompt_order[0].order.push({identifier,enabled:true});
        }
    });
    await frame.locator('#close').click();await page.locator('#czgh-planner-menu').click();
    await frame.getByRole('switch',{name:'长列表 79',exact:true}).waitFor();
    // Slow mobile CPU + blocked persistence: feedback must precede the save response.
    await page.setViewportSize({width:390,height:844});
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    await page.evaluate(()=>{
        window.toggleSaveGate=new Promise(resolve=>window.releaseToggleSave=resolve);
        window.compactReplies=[];
        window.addEventListener('message',event=>{
            if(event.data?.type==='request'&&event.data.payload?.compact)window.compactReplies.push(event.data.requestId);
        });
    });
    const rapid=frame.getByRole('switch',{name:'长列表 79',exact:true});
    const retained=await rapid.elementHandle();
    await rapid.evaluate(node=>{node.click();node.click();node.click();});
    assert.equal(await rapid.getAttribute('aria-checked'),'false','switch must update before persistence completes');
    assert.equal(await retained.evaluate(node=>node.isConnected),true);
    await page.evaluate(()=>{window.releaseToggleSave();window.toggleSaveGate=null;});
    await page.waitForFunction(()=>window.compactReplies.length===3&&context.extensionSettings.czgh_external_planner.selection.promptOverrides.long79===false);
    await rapid.click();
    await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.selection.promptOverrides.long79===true);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});await cdp.detach();
    await page.setViewportSize({width:1100,height:900});
    for(const [tab,label] of [['预设','长列表 79'],['世界书','世界条目 79']]){
        await frame.getByRole('tab',{name:tab,exact:true}).click();
        if(tab==='世界书'){
            const summaries=await frame.locator('#app > details > summary').allTextContents();
            assert.equal(summaries.at(-2),'聊天附加世界书');assert.equal(summaries.at(-1),'插件开启的世界书');
            await frame.locator('.book-heading').first().click();
        }
        const item=frame.getByRole('switch',{name:label,exact:true});
        await item.scrollIntoViewIfNeeded();
        const scroll=await frame.locator('#app').evaluate(el=>el.scrollTop);
        const sourceReads=await page.evaluate(()=>window.sourceReads);
        const old=await frame.locator('#app > :first-child').elementHandle();
        await item.click();
        if(tab==='世界书')await old.waitForElementState('hidden');
        else {
            await page.waitForFunction(()=>context.extensionSettings.czgh_external_planner.selection.promptOverrides.long79===false);
            assert.equal(await old.evaluate(el=>el.isConnected),true,'long preset toggle must not rebuild list');
        }
        assert.equal(await item.getAttribute('aria-checked'),'false');
        assert.ok(scroll>500);
        assert.ok(Math.abs(await frame.locator('#app').evaluate(el=>el.scrollTop)-scroll)<3,`${tab} scroll must stay at edited entry`);
        assert.equal(await item.evaluate(el=>el===document.activeElement),true);
        assert.equal(await page.evaluate(()=>window.sourceReads),sourceReads);
    }
    await page.reload();await page.locator('#czgh-planner-menu').click();
    await frame.getByLabel('选择预设',{exact:true}).waitFor();
}
