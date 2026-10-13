/* 读取 API 方案并构建独立请求；不修改酒馆活动连接。 */
const STORE = 'preset_compare_api_manager';
function profiles(settings) {
    const store = settings[STORE];
    if (!store) return [];
    if (store.version !== 1 || !Array.isArray(store.profiles)) throw new Error('预设更新编辑器的 API 方案格式不支持，请刷新或更新插件。');
    return store.profiles;
}
export function listProfiles(settings) {
    return profiles(settings).map(p => ({ id: p.id, name: p.name, apiUrl: p.connection?.custom_url || '', model: p.model }));
}
export function resolveProfile(settings, id) {
    const matches = profiles(settings).filter(p => p.id === id);
    if (matches.length !== 1) throw new Error('所选 API 方案已删除或标识重复，请重新选择。');
    const p = structuredClone(matches[0]);
    if (p.source !== 'custom' || !p.model || !p.secretId || !p.connection?.custom_url) throw new Error('方案缺少有效的兼容 API 地址、模型或密钥引用。');
    return p;
}
export function profileRequest(profile, messages, maxTokens, parseYaml) {
    if (profile.source !== 'custom' || !(profile.secretId || profile.keyRef) || !profile.model) throw new Error('API 方案缺少模型或密钥引用。');
    if(profile.additional!=null&&(typeof profile.additional!=='object'||Array.isArray(profile.additional)))throw new Error('附加参数结构无效。');
    const body = { chat_completion_source: 'custom', custom_url: profile.connection.custom_url,
        secret_id: profile.keyRef ? `czgh-local:${profile.keyRef}` : profile.secretId, model: profile.model, messages: structuredClone(messages), stream: false, max_tokens: Number(maxTokens) };
    const format = profile.connection.custom_api_format;
    if (format) {
        if (!['openai_compat','openai_responses','claude_messages','gemini_interactions','gemini_generate_content'].includes(format)) throw new Error('API 方案接口格式尚未支持。');
        body.custom_api_format = format;
    }
    const protectedFields = new Set(['messages', 'model', 'stream', 'max_tokens', 'max_completion_tokens', 'prompt', 'tools', 'tool_choice', 'functions', 'function_call', 'n', 'secret_id', 'chat_completion_source', 'custom_url', 'custom_api_format', 'reverse_proxy', 'proxy_password', '__proto__', 'constructor', 'prototype']);
    for (const field of ['custom_include_body', 'custom_exclude_body', 'custom_include_headers']) {
        const raw = profile.additional?.[field];
        if(raw!==undefined&&typeof raw!=='string')throw new Error('附加参数必须为 YAML 文本。');
        if (!raw?.trim()) continue;
        let parsed;
        try { parsed = parseYaml(raw); } catch { throw new Error('API 方案附加参数无法解析，请在附加参数中检查。'); }
        const excluded = field === 'custom_exclude_body';
        if (!parsed || typeof parsed !== 'object' || (excluded ? !Array.isArray(parsed) : Array.isArray(parsed))) throw new Error('API 方案附加参数结构无效。');
        const keys = excluded ? parsed : Object.keys(parsed);
        if (keys.some(k => typeof k !== 'string' || protectedFields.has(k) || field === 'custom_include_headers' && /authorization|api[-_]key|cookie|host/i.test(k))) {
            throw new Error('方案附加参数覆盖了规划消息、模型、输出额度或认证，请调整后重试。');
        }
        body[field] = raw;
    }
    return body;
}

export function authorizeLocalRequest(body, key, parseYaml, { tauriTavern = false } = {}) {
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new Error('本地密钥不可用。');
    if (tauriTavern) {
        // TT explicitly supports Custom + reverse_proxy/proxy_password. Leaving
        // custom_url empty selects this branch and bypasses its secret store.
        const request = { ...body, custom_url:'', reverse_proxy:body.custom_url, proxy_password:key.trim() };
        delete request.secret_id;
        return request;
    }
    const headers = body.custom_include_headers ? parseYaml(body.custom_include_headers) : {};
    return { ...body, custom_include_headers: JSON.stringify({ ...headers, Authorization: `Bearer ${key.trim()}` }) };
}
