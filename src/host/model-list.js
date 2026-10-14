/* 模型列表：只使用所选方案或本次填写的凭据，提供有时限且不回显密钥的结果。 */
import { profileRequest, authorizeLocalRequest } from '../planning/profiles.js?v=0.5.7-dev.1';

export async function withModelListTimeout(action, timeoutMs = 20000) {
    const controller = new AbortController();
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => action(controller.signal)),
            new Promise((_, reject) => { timer = setTimeout(() => {
                const error = new Error('拉取模型超时，请检查连接后重试；也可手动输入模型名称。');
                controller.abort(error); reject(error);
            }, timeoutMs); }),
        ]);
    } finally { clearTimeout(timer); }
}

function responseError(status) {
    const reason = {
        400:'接口不接受本次请求，请检查基础地址和接口类型。',
        401:'密钥未通过验证，请检查当前方案的密钥。',
        403:'当前密钥没有访问权限，请检查密钥权限或服务限制。',
        404:'未找到模型列表接口，请检查基础地址；部分服务需要手动填写模型。',
        429:'请求过于频繁或额度不足，请稍后重试或检查账户额度。',
    }[status] || (status >= 500 ? '服务暂时不可用，请稍后重试。' : '请检查当前方案的地址、密钥和服务状态。');
    return new Error(`拉取模型失败（HTTP ${status}）：${reason}`);
}

function apiError(data) {
    // Providers sometimes return HTTP 200 for an API error. Classify known
    // causes without reflecting arbitrary provider text or echoed credentials.
    const value = data?.error;
    const status = Number(value?.status || value?.code || data?.status);
    if ([400,401,403,404,429].includes(status) || status >= 500 && status <= 599) return responseError(status);
    const category = [value?.type,value?.code,value?.message,typeof value === 'string' ? value : '',data?.message].filter(x => typeof x === 'string').join(' ');
    if (/unauthori[sz]ed|invalid[ _-]?(?:api[ _-]?)?key|authentication|incorrect[ _-]api[ _-]key/i.test(category)) return new Error('拉取模型失败：密钥未通过验证，请检查当前方案的密钥。');
    if (/rate.?limit|quota|insufficient.?balance/i.test(category)) return new Error('拉取模型失败：请求过于频繁或额度不足，请稍后重试或检查账户额度。');
    return new Error('拉取模型失败：服务返回了错误，请检查当前方案的地址、密钥和服务状态。');
}

export async function fetchModelList(config, { headers, vault, parseYaml, signal, key, tauriTavern = false, fetch:fetcher = globalThis.fetch }) {
    let url;
    try { url = new URL(config.connection?.custom_url); } catch { throw new Error('请填写有效的 HTTP(S) 基础地址后再拉取模型。'); }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写有效的 HTTP(S) 基础地址后再拉取模型。');
    if (key !== undefined && (typeof key !== 'string' || key && !key.trim())) throw new Error('请输入有效密钥。');
    const draftKey = typeof key === 'string' && key.trim() ? key : undefined;
    const profile = { ...config, model:config.model || 'models', ...(draftKey ? { keyRef:'model-list-draft' } : {}) };
    let request = profileRequest(profile, [], 1, parseYaml);
    if (draftKey || config.keyRef) request = authorizeLocalRequest(request, draftKey || await vault.get(config.keyRef), parseYaml, { tauriTavern });
    signal?.throwIfAborted();
    if (!draftKey && !config.keyRef) {
        let secrets;
        try {
            const response = await fetcher('/api/secrets/read', { method:'POST', headers:headers(), body:'{}', signal });
            if (!response.ok) throw Error('unavailable');
            secrets = (await response.json()).api_key_custom;
        } catch { signal?.throwIfAborted(); throw new Error('无法检查此方案的已保存密钥，请检查酒馆连接后重试。'); }
        if (!Array.isArray(secrets) || !secrets.some(item => item.id === config.secretId)) throw new Error('此方案引用的密钥已不存在，请重新输入密钥后保存方案；未使用其他密钥。');
    }
    let response;
    try { response = await fetcher('/api/backends/chat-completions/status', { method:'POST', headers:headers(), body:JSON.stringify(request), signal }); }
    catch { signal?.throwIfAborted(); throw new Error('拉取模型失败：无法连接到酒馆服务，请检查网络后重试。'); }
    if (!response.ok) throw responseError(response.status);
    let data;
    try { data = await response.json(); }
    catch { signal?.throwIfAborted(); throw new Error('模型接口返回了无法识别的内容，请检查基础地址；也可手动输入模型名称。'); }
    if (data?.error || data?.success === false) throw apiError(data);
    if (!Array.isArray(data?.data)) throw new Error('API 没有返回模型列表，请检查基础地址；部分服务需要手动填写模型。');
    const models = [...new Set(data.data.map(x => typeof x?.id === 'string' ? x.id.trim() : '').filter(Boolean))];
    if (!models.length) throw new Error('API 返回的模型列表为空，请检查密钥权限；也可手动输入模型名称。');
    return models;
}
