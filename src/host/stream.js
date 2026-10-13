/* 规划 SSE 响应读取：跨网络分块累积文本，完整结束后交给规划校验，不注入半成品。 */
export async function readPlanResponse(response, onText = () => {}, signal) {
    const jsonChoice = result => {
        if (result.error || !result.choices?.[0]) throw new Error('规划 API 返回错误或不支持的格式。');
        return result.choices[0];
    };
    if (!response.body?.getReader) return jsonChoice(await response.json());
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', text = '', finish = null, mode = null, complete = false;
    let claude = false, claudeStopReason = null;
    const textBlocks = new Set();
    const append = value => { if (typeof value === 'string' && value) { text += value; onText(text); } };
    const consume = event => {
        const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
        if (!payload) return;
        if (payload === '[DONE]') { complete = true; return; }
        let result;
        try { result = JSON.parse(payload); } catch { throw new Error('规划流式响应格式错误。'); }
        if (result.error) throw new Error('规划流式 API 返回错误。');
        // TT forwards native Claude SSE; reasoning/tool blocks are not prose.
        if (result.type === 'message_start') {
            if (claude || text || finish) throw new Error('规划流式响应包含重复或混合消息。');
            claude = true; return;
        }
        if (claude) {
            if (result.choices) throw new Error('规划流式响应混用了不同接口格式。');
            if (result.type === 'content_block_start') {
                if (result.content_block?.type === 'tool_use') throw new Error('规划接口返回了工具调用，未生成完整规划。');
                if (result.content_block?.type === 'text') { textBlocks.add(result.index); append(result.content_block.text); }
            } else if (result.type === 'content_block_delta' && result.delta?.type === 'text_delta' && textBlocks.has(result.index)) append(result.delta.text);
            else if (result.type === 'content_block_stop') textBlocks.delete(result.index);
            else if (result.type === 'message_delta' && result.delta?.stop_reason) claudeStopReason = result.delta.stop_reason;
            else if (result.type === 'message_stop') {
                if (['end_turn','stop_sequence'].includes(claudeStopReason)) finish = 'stop';
                else if (['max_tokens','model_context_window_exceeded'].includes(claudeStopReason)) finish = 'length';
                else throw new Error('规划接口未正常完成文本生成，未注入正文。');
            }
            return;
        }
        const choice = result.choices?.[0];
        append(choice?.delta?.content);
        if (choice?.finish_reason) finish = choice.finish_reason;
    };
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            // ST proxies and providers can forward SSE under application/json/text/plain.
            // Inspect a buffered prefix without losing bytes or waiting for the full response.
            if (!mode) {
                buffer = buffer.trimStart();
                if (/^[{[]/.test(buffer)) mode = 'json';
                else if (/^(?:data:|event:|id:|retry:|:)/.test(buffer)) mode = 'sse';
                else if (done || buffer.length > 512) throw new Error('规划 API 响应不是可识别的 JSON 或 SSE。');
            }
            if (mode !== 'sse') { if (done) break; else continue; }
            buffer = buffer.replace(/\r\n/g, '\n');
            let end;
            while (!finish && !complete && (end = buffer.indexOf('\n\n')) >= 0) { consume(buffer.slice(0,end)); buffer = buffer.slice(end+2); }
            // A terminal choice is sufficient: some proxies keep the transport
            // open after finish_reason instead of sending [DONE] or EOF.
            if (done || complete || finish) break;
        }
        if (mode === 'json') {
            signal?.throwIfAborted();
            let result;
            try { result = JSON.parse(buffer); } catch { throw new Error('规划 API 返回了不完整或无效的 JSON。'); }
            return jsonChoice(result);
        }
        if (!finish && !complete && buffer.trim()) consume(buffer);
        signal?.throwIfAborted();
        if (!finish) throw new Error('规划流式响应意外中断，未注入正文。');
        return { message: { content: text }, finish_reason: finish };
    } finally {
        // Network cleanup must not delay validated completion or error delivery.
        void reader.cancel().catch(()=>{});
        reader.releaseLock();
    }
}
