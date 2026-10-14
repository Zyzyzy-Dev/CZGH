import assert from 'node:assert/strict';

// Uses the real plugin host/UI and planning HTTP fixture. Only the native body
// generator is simulated, including its different success/error event order.
export async function checkReplyUi(page, frame, getPlannerCalls) {
    await page.evaluate(async () => {
        document.querySelector('#czgh-planner-container')?.close();
        for (const fn of listeners.stop || []) await fn();
        delete window.__TAURITAVERN__;
        context.streamingProcessor = null;
        Object.assign(context.extensionSettings.czgh_external_planner, {
            enabled: true, displayPlan: true, autoReply: false, stream: false,
            apiSelection: 'external:p1',
        });
        const previousSave = context.saveChat;
        const fixture = window.replyUi = { saved: {}, attempts: [], outcomes: [], settled: 0 };
        fixture.emit = async (name, ...args) => {
            for (const fn of listeners[name] || []) await fn(...args);
        };
        fixture.render = () => {
            document.querySelectorAll('.mes').forEach(node => node.remove());
            context.chat.forEach((message, index) => {
                const node = document.createElement('div');
                node.className = 'mes'; node.setAttribute('mesid', index);
                node.innerHTML = '<div class="mes_block"></div>';
                document.body.append(node);
            });
        };
        fixture.switchChat = async (id, messages) => {
            context.chatId = id;
            context.chat = structuredClone(messages);
            context.streamingProcessor = null;
            fixture.render();
            await fixture.emit('chat', id);
        };
        context.saveChat = async () => {
            fixture.saved[context.chatId] = structuredClone(context.chat);
            await previousSave();
        };
        context.generate = async (type, options = {}) => {
            const attempt = { type, options, chatId: context.chatId, outcome: fixture.outcomes.shift() || 'success' };
            fixture.attempts.push(attempt);
            try {
                await fixture.emit('started', type, options, false);
                // Like native regenerate, replace a failed assistant tail but
                // never consume the unsent input or add another user floor.
                if (type === 'regenerate' && !context.chat.at(-1)?.is_user) {
                    context.chat.pop(); fixture.render();
                }
                const request = { type, stream: true, messages: [
                    { role: 'system', content: '正文系统要求保持不变' },
                    ...context.chat.map(message => ({ role: message.is_user ? 'user' : 'assistant', content: message.mes })),
                ] };
                await fixture.emit('request', request);
                attempt.request = structuredClone(request);
                if (attempt.chatId !== context.chatId) { attempt.cancelledByChat = true; return; }
                if (attempt.outcome === 'http-failure') {
                    await fixture.emit('ended');
                    throw new Error('Simulated body HTTP 503');
                }
                const id = context.chat.length;
                context.chat.push({ mes: attempt.outcome === 'partial-failure' ? '只收到部分正文' : '正文重试成功', swipe_id: 0, swipes: [], swipe_info: [{ extra: {} }], extra: {} });
                context.chat[id].swipes[0] = context.chat[id].mes;
                fixture.render();
                if (attempt.outcome === 'partial-failure') {
                    const controller = new AbortController(); controller.abort();
                    context.streamingProcessor = { abortController: controller };
                    // Native streaming error emits ENDED and MESSAGE_RECEIVED
                    // even though its processor has been aborted.
                    await fixture.emit('ended');
                    await fixture.emit('received', id, type);
                    context.streamingProcessor = null;
                    throw new Error('Simulated interrupted body stream');
                }
                context.streamingProcessor = { abortController: new AbortController() };
                await fixture.emit('ended');
                await fixture.emit('received', id, type);
                await fixture.emit('render', id, type);
                context.streamingProcessor = null;
                await context.saveChat();
                return context.chat[id].mes;
            } finally { fixture.settled++; }
        };
        fixture.launch = (type, outcome) => {
            fixture.outcomes.push(outcome);
            // Retain the native promise without letting expected failures become
            // browser unhandled-rejection noise.
            fixture.running = context.generate(type).then(value => ({ value }), error => ({ error: error.message }));
        };
        await fixture.switchChat('reply-ui-manual', [{ is_user: true, mes: '先规划，稍后再生成正文' }]);
    });

    const floor = () => page.frameLocator('.mes[mesid="0"] iframe[title="本楼创作规划"]');
    const openFloor = async () => {
        await floor().locator('summary').waitFor();
        if (!await floor().locator('details').evaluate(node => node.open)) await floor().locator('summary').click();
    };
    const button = () => floor().getByRole('button', { name: '生成正文回复', exact: true });
    const retry = async outcome => {
        const settled = await page.evaluate(value => { window.replyUi.outcomes.push(value); return window.replyUi.settled; }, outcome);
        await button().click();
        await page.waitForFunction(previous => window.replyUi.settled > previous, settled);
        // The native promise settling precedes recovery.finally and UI delivery.
        if (outcome !== 'success') await page.waitForFunction(() => !!document.querySelector('.mes[mesid="0"] iframe')?.contentDocument?.querySelector('#resume') && !document.querySelector('.mes[mesid="0"] iframe').contentDocument.querySelector('#resume').disabled);
    };

    const beforeManual = getPlannerCalls();
    await page.evaluate(() => window.replyUi.launch('normal', 'http-failure'));
    await floor().getByText('· 等待生成正文', { exact: true }).waitFor();
    await openFloor();
    assert.equal(getPlannerCalls(), beforeManual + 1);
    const persisted = await page.evaluate(() => window.replyUi.saved['reply-ui-manual']);
    assert.equal(persisted[0].extra.czghCreativePlanningDraft.text, '本轮测试规划');
    assert.equal(await page.evaluate(() => context.chat.length), 1, 'manual completion must not start a body');
    assert.equal(await button().isEnabled(), true);

    await page.evaluate(async () => {
        await window.replyUi.switchChat('reply-ui-other', [{ is_user: true, mes: '另一个聊天' }]);
        await window.replyUi.running;
    });
    assert.equal(await page.locator('iframe[title="本楼创作规划"]').count(), 0, 'the other chat must not display this plan');
    await page.evaluate(async () => window.replyUi.switchChat('reply-ui-manual', window.replyUi.saved['reply-ui-manual']));
    await floor().getByText('· 规划已完成', { exact: true }).waitFor();
    await openFloor();
    assert.match(await floor().locator('pre').textContent(), /本轮测试规划/);

    await retry('http-failure');
    await retry('http-failure');
    assert.equal(getPlannerCalls(), beforeManual + 1, 'body failures must reuse the completed plan');
    assert.equal(await page.evaluate(() => context.chat.length), 1);
    await retry('success');
    await page.waitForFunction(() => !!context.chat[1]?.extra?.czghCreativePlanning?.[0]);
    const manual = await page.evaluate(() => ({ chat: context.chat, attempts: window.replyUi.attempts }));
    assert.equal(getPlannerCalls(), beforeManual + 1);
    assert.equal(manual.chat[1].extra.czghCreativePlanning[0].text, '本轮测试规划');
    assert.equal(manual.chat[0].extra.czghCreativePlanningDraft, undefined);
    assert.deepEqual(manual.attempts.slice(1).map(attempt => attempt.type), ['regenerate', 'regenerate', 'regenerate']);
    for (const attempt of manual.attempts.slice(1)) {
        assert.equal(attempt.request.messages[0].content, '正文系统要求保持不变');
        assert.match(attempt.request.messages.at(-1).content, /本轮测试规划/);
        assert.equal(attempt.request.messages.filter(message => message.content.includes('本轮测试规划')).length, 1);
    }

    // In automatic mode a native retry remains a full planning + body retry;
    // only the plugin button can opt into reuse.
    await page.evaluate(async () => {
        context.extensionSettings.czgh_external_planner.autoReply = true;
        await window.replyUi.switchChat('reply-ui-auto', [{ is_user: true, mes: '自动规划正文失败重试' }]);
        window.replyUi.launch('normal', 'http-failure');
        await window.replyUi.running;
    });
    await openFloor();
    assert.equal(getPlannerCalls(), beforeManual + 2);
    await retry('http-failure');
    assert.equal(getPlannerCalls(), beforeManual + 2, 'plugin retry must not call the planner');
    await page.evaluate(async () => { window.replyUi.launch('regenerate', 'http-failure'); await window.replyUi.running; });
    await openFloor();
    assert.equal(getPlannerCalls(), beforeManual + 3, 'native regenerate must call the planner again');
    await retry('success');
    await page.waitForFunction(() => !!context.chat[1]?.extra?.czghCreativePlanning?.[0]);
    assert.equal(getPlannerCalls(), beforeManual + 3);

    // Partial streamed text is an unsuccessful body, despite MESSAGE_RECEIVED.
    const beforePartial = getPlannerCalls();
    await page.evaluate(async () => {
        await window.replyUi.switchChat('reply-ui-partial', [{ is_user: true, mes: '正文流式中断' }]);
        window.replyUi.launch('normal', 'partial-failure'); await window.replyUi.running;
    });
    await openFloor();
    const partial = await page.evaluate(() => context.chat);
    assert.equal(partial[1].mes, '只收到部分正文');
    assert.equal(partial[1].extra.czghCreativePlanning, undefined, 'an aborted partial body must not consume the plan');
    assert.equal(partial[0].extra.czghCreativePlanningDraft.text, '本轮测试规划');
    assert.equal(getPlannerCalls(), beforePartial + 1);
    await retry('success');
    await page.waitForFunction(() => !!context.chat[1]?.extra?.czghCreativePlanning?.[0]);
    assert.equal(await page.evaluate(() => context.chat.length), 2, 'retry must replace the failed tail, not duplicate it');
    assert.equal(await page.evaluate(() => context.chat[1].mes), '正文重试成功');
    assert.equal(getPlannerCalls(), beforePartial + 1);
    // Verify the main panel receives the same final non-retry state.
    await page.locator('#czgh-planner-menu').click();
    await page.waitForFunction(() => document.querySelector('iframe[title="创作规划"]')?.contentDocument?.querySelector('#resume')?.disabled === true);
    assert.equal(await frame.locator('#resume').isDisabled(), true);
    await frame.getByRole('button', { name: '关闭', exact: true }).click();
}
