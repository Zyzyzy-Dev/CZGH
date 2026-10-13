/* 工具楼层仅作为历史资料；规划本身不执行工具。 */
export const isToolCall = message => Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
export const isToolResult = message => message?.role === 'tool';

// Only a complete, ordered chain of assistant calls and matching result floors
// may move a staged plan's destination. Never skip arbitrary chat messages.
export function completeToolSpan(messages) {
    if (!messages.length) return false;
    const pending = new Set(), seen = new Set();
    for (const message of messages) {
        if (message?.is_user) return false;
        if (isToolResult(message)) {
            if (!pending.delete(message.tool_call_id)) return false;
        } else if (isToolCall(message) && !message.is_system) {
            if (pending.size) return false;
            for (const call of message.tool_calls) {
                if (typeof call.id !== 'string' || !call.id || seen.has(call.id)) return false;
                pending.add(call.id); seen.add(call.id);
            }
        } else return false;
    }
    return seen.size > 0 && pending.size === 0;
}

export function projectHistory(messages) {
    return messages.filter(m => !m.is_system || isToolResult(m)).map(m => {
        const content = structuredClone(m.content ?? m.mes ?? '');
        if (isToolResult(m)) return { role:'assistant', content:`【历史工具结果：${m.name || m.tool_call_id || '工具'}】\n${typeof content === 'string' ? content : JSON.stringify(content)}`, toolReference:true };
        if (isToolCall(m)) {
            const calls = m.tool_calls.map(call => ({ id:call.id, name:call.name ?? call.function?.name, arguments:call.parameters ?? call.function?.arguments }));
            const record = `【历史工具调用记录，仅供参考】\n${JSON.stringify(calls)}`;
            return { role:'assistant', content:typeof content === 'string' ? `${content}\n${record}` : [...(Array.isArray(content) ? content : [{type:'text',text:JSON.stringify(content)}]),{type:'text',text:record}], toolReference:true };
        }
        return { role:m.is_user ? 'user' : 'assistant', content, name:m.name, extra:structuredClone(m.extra || {}) };
    });
}

export const chatPrefix = messages => JSON.stringify(messages.map(m => ({
    user:!!m.is_user, system:!!m.is_system, role:m.role, name:m.name,
    mes:m.mes, content:m.content, swipe:m.swipe_id ?? 0, tools:m.tool_calls, call:m.tool_call_id,
})));
