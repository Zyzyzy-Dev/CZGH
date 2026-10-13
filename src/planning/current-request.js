/* 当前连接请求副本：冻结活动密钥引用，清除正文工具和多候选设置，防止附加参数覆盖资料。 */
export function clonePlanningRequest(data) {
    const request = { ...data };
    // Host tools may contain display callbacks. Exclude them before cloning;
    // only the planning copy drops tools, never the original body request.
    for (const field of ['tools', 'tool_choice', 'functions', 'function_call']) delete request[field];
    return structuredClone(request);
}

export function freezeCurrentRequest(data, secrets, parseYaml) {
    const secretKeys={custom:'api_key_custom',openai:'api_key_openai',openrouter:'api_key_openrouter',groq:'api_key_groq',deepseek:'api_key_deepseek'};
    const key=secretKeys[data.chat_completion_source];
    if(!key)throw Error('当前连接返回格式尚未支持，请选择兼容 API 方案。');
    const request=clonePlanningRequest(data);
    const protectedFields=new Set(['messages','prompt','model','stream','max_tokens','max_completion_tokens','n','tools','tool_choice','functions','function_call','secret_id','chat_completion_source','custom_url','reverse_proxy','proxy_password']);
    for(const field of ['custom_include_body','custom_exclude_body'])if(request[field]?.trim()){
        const parsed=parseYaml(request[field]);
        if(!parsed||typeof parsed!=='object')throw Error('当前连接附加参数结构无效。');
        const keys=field==='custom_exclude_body'?(Array.isArray(parsed)?parsed:[]):Object.keys(parsed);
        if(field==='custom_exclude_body'&&!Array.isArray(parsed)||field==='custom_include_body'&&Array.isArray(parsed)||keys.some(k=>protectedFields.has(k)))throw Error('当前连接附加参数会覆盖规划资料或输出设置，请使用独立方案。');
    }
    request.secret_id=request.secret_id||secrets[key]?.find(item=>item.active)?.id||'czgh-no-active-secret';
    request.messages=[];request.stream=false;request.n=1;
    delete request.max_completion_tokens;
    return request;
}
