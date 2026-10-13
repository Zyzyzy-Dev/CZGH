/* 主页面规划控制器：调用独立 API、监听生成、维护取消状态；不操作 UI DOM。 */
import { readPlanResponse } from './stream.js?v=0.5.5';
import { createId } from '../bridge/id.js?v=0.5.5';
import { migrateSettings, resolvePlanningTags, validateSettings, planningMessages, writingMessages, extractPlan, eligibleRequest, unresolvedBaiBaiMacros } from '../planning/core.js?v=0.5.5';
import { resolveProfile, profileRequest } from '../planning/profiles.js?v=0.5.5';
import { clonePlanningRequest } from '../planning/current-request.js?v=0.5.5';
export function createPlanner({ getContext, getRequestHeaders, stopGeneration, getYaml = () => null, onState = () => {}, prepare, continueRequest = () => false, onPlanReady = () => {}, onDiscard = () => {}, onProgress = () => {}, onDiagnostics = () => {} }) {
const state = {status: '', preview: ''};
const ID = 'czgh_external_planner';
const ctx = getContext;
let apiKey = ''; // Session only; never written to extension settings or logs.
let pending = null;
let diagnostics = null;
const statusNode = { set textContent(value) { state.status = value; onState({ ...state }); } };
const previewNode = { set value(value) { state.preview = value; onState({ ...state }); } };

let skipOnce = false;
const processed = new WeakSet();

function settings() { return ctx().extensionSettings[ID]; }
function status(text) { if (statusNode) statusNode.textContent = text; }
function chatIdentity() {
    const c = ctx();
    return JSON.stringify([c.chatId, c.characterId, c.groupId]);
}
// Compare only message structure and selected content; unrelated plugin metadata is not an edit.
function chatContentSnapshot() {
    return JSON.stringify((ctx().chat || []).map(message => ({
        user: !!message.is_user, system: !!message.is_system, name: message.name ?? '',
        mes: message.mes ?? '', content: message.content ?? null,
        swipe: message.swipe_id ?? 0,
        selectedSwipe: message.swipes?.[message.swipe_id ?? 0] ?? null,
    })));
}
function abortPending() {
    const run=pending;if(!run)return;pending=null;run.controller.abort();
    onDiscard(run.requestId);
    if(run.identity===chatIdentity()){
        onProgress({...run.record,phase:'cancelled',error:'规划已停止，未注入正文。'});
        status('规划已停止；正文请求已取消。');
    }
}

async function requestPlan(messages, config, key, signal, progress, requestReady) {
    let body;
    if (config.request) {
        body = { ...clonePlanningRequest(config.request), messages, stream: false, max_tokens: Number(config.maxTokens) };
    } else if (config.profile) {
        const yaml = getYaml();
        body = profileRequest(config.profile, messages, config.maxTokens, text => {
            if (yaml?.parse) return yaml.parse(text);
            return JSON.parse(text);
        });
        const keysResponse = await fetch('/api/secrets/read', { method: 'POST', headers: getRequestHeaders(), body: '{}', signal });
        if (!keysResponse.ok) throw new Error('无法核对方案密钥引用，请检查酒馆密钥管理器。');
        const keys = (await keysResponse.json()).api_key_custom;
        if (!Array.isArray(keys) || !keys.some(item => item.id === config.profile.secretId)) throw new Error('方案引用的密钥已不存在；未使用其他密钥。');
    } else {
        body = {
            chat_completion_source: 'custom',
            custom_url: config.apiUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, ''),
            custom_include_headers: key ? `Authorization: ${JSON.stringify(`Bearer ${key}`)}` : '',
            model: config.model, messages, stream: false, max_tokens: Number(config.maxTokens),
        };
    }
    body.stream = !!config.stream;
    signal.throwIfAborted();
    requestReady?.(body);
    // Use ST's own backend proxy, without invoking Generate or emitting chat events.
    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST', headers: getRequestHeaders(), signal,
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`规划 API 请求失败（HTTP ${response.status}）。`);
    const choice = await readPlanResponse(response, text => { signal.throwIfAborted(); progress?.(text); }, signal);
    return extractPlan(choice.message?.content, config, choice.finish_reason);
}

async function onRequest(data) {
    if (!settings().enabled || processed.has(data)) return;
    if (continueRequest(data)) { processed.add(data); return; }
    if (!eligibleRequest(data)) return;
    processed.add(data);
    if (skipOnce) { skipOnce = false; status('本次已跳过外置规划，使用原始预设。'); return; }
    if (pending) {
        abortPending();
        stopGeneration();
        status('检测到重叠请求，已停止；请重新发送。');
        return;
    }
    const config = structuredClone(settings());
    const original = structuredClone(data.messages);
    const run = { controller: new AbortController(), identity: chatIdentity(), requestId: createId() };
    pending = run;
    const record = { requestId: run.requestId, chatId: run.identity, expectedMessageId: data.type === 'swipe' ? (ctx().chat?.length || 1)-1 : (ctx().chat?.length || 0), text: '', phase: 'preparing', mainStream: data.stream };
    run.record=record;
    diagnostics=null;onDiagnostics(null);
    onProgress(record);
    const timer = setTimeout(() => run.controller.abort(), Number(config.timeoutSeconds) * 1000);
    previewNode.value = '';
    try {
        let contextMessages = original;
        let prepared;
        if (prepare) {
            prepared = await prepare({ data: clonePlanningRequest(data), config, signal: run.controller.signal });
            contextMessages = prepared.messages;
            config.request = prepared.request;
            config.profile = prepared.profile;
            config.apiUrl = prepared.apiUrl || prepared.request?.custom_url || prepared.profile?.connection?.custom_url || 'https://api.openai.com/v1';
            config.model = prepared.request?.model || prepared.profile?.model || prepared.model || config.model;
        } else if (config.profileId) {
            config.profile = resolveProfile(ctx().extensionSettings, config.profileId);
            config.apiUrl = config.profile.connection.custom_url;
            config.model = config.profile.model;
        }
        run.controller.signal.throwIfAborted();
        if(pending!==run||run.identity!==chatIdentity())throw new Error('本轮已失效。');
        Object.assign(config, resolvePlanningTags(contextMessages, config));
        validateSettings(config);
        if (unresolvedBaiBaiMacros(contextMessages)) throw new Error('发现尚未展开的柏宝书宏，请检查宏设置后重试。');
        status(`正在按 ${config.openTag}…${config.closeTag} 生成本轮规划；完成后自动继续正文…`);
        const plan = await requestPlan(planningMessages(contextMessages, config), config, apiKey, run.controller.signal, text => { if(pending!==run||run.identity!==chatIdentity())return;previewNode.value=text;record.text = text; record.phase = 'streaming'; onProgress(record); }, body=>{
            diagnostics={requestId:run.requestId,createdAt:new Date().toISOString(),model:body.model,stream:body.stream,maxTokens:body.max_tokens,sourceManifest:prepared?.sourceManifest||null,messages:structuredClone(body.messages)};
            onDiagnostics(diagnostics);
        });
        if (run.controller.signal.aborted || run.identity !== chatIdentity()) throw new Error('本轮已取消或聊天已切换。');
        clearTimeout(timer);
        if(config.autoReply===false){
            previewNode.value=`${config.openTag}\n${plan}\n${config.closeTag}`;
            record.text=plan;record.phase='awaiting';
            const chatSnapshot=chatContentSnapshot();
            await new Promise((resolve,reject)=>{
                const abort=()=>reject(new Error('本轮已取消。'));
                run.resume=()=>{run.controller.signal.removeEventListener('abort',abort);resolve();};
                run.controller.signal.addEventListener('abort',abort,{once:true});
                status('规划已完成，等待点击“生成正文回复”。');onProgress(record);
            });
            run.controller.signal.throwIfAborted();
            if(pending!==run||run.identity!==chatIdentity()||chatContentSnapshot()!==chatSnapshot)throw Error('聊天内容已变化，请重新生成规划。');
        }
        // Independent mode may not rewrite any original instruction via legacy replacement rules.
        data.messages = writingMessages(original, plan, prepare ? { ...config, rules: '[]' } : config);
        onPlanReady({ version: 1, requestId: run.requestId, chatId: run.identity, text: plan, openTag: config.openTag, closeTag: config.closeTag, createdAt: Date.now(), generationType: data.type || 'normal', expectedMessageId: data.type === 'swipe' ? (ctx().chat?.length || 1) - 1 : (ctx().chat?.length || 0), nextWorldState: prepared?.nextWorldState }, data.messages.at(-1));
        previewNode.value = `${config.openTag}\n${plan}\n${config.closeTag}`;
        status(`规划已注入（${plan.length} 字符），正在生成正文。正文请求流式：${data.stream === true ? '开启' : data.stream === false ? '关闭' : '未提供'}。`);
    } catch (error) {
        if(pending!==run||run.identity!==chatIdentity())return;
        // ST's event emitter swallows thrown errors. Explicitly abort main generation.
        const wasAborted = run.controller.signal.aborted;
        onDiscard(run.requestId);
        stopGeneration();
        record.phase = wasAborted ? 'cancelled' : 'error'; record.error = wasAborted ? '规划已停止或超时，未注入正文。' : error.message; onProgress(record);
        status(wasAborted
            ? '规划已停止或超时；未注入。可重新发送，或选择下次跳过。'
            : `${error.message} 正文已停止；可重新发送或选择下次跳过。`);
    } finally {
        clearTimeout(timer);
        if (pending === run) { pending = null; onState({...state}); }
    }
}


const c = ctx();
c.extensionSettings[ID] = migrateSettings(c.extensionSettings[ID]);
const event = c.eventTypes.CHAT_COMPLETION_SETTINGS_READY;
// Keep planning downstream of ST's awaited send/worldbook events. Database
// naiv1.2.9 completes recall and user-input writeback in those earlier stages.
// Starting from USER_MESSAGE_RENDERED itself would race its post-emit wait gate.
if (event) c.eventSource.on(event, onRequest);
else { settings().enabled = false; status('当前酒馆缺少请求事件，插件未启用。'); }
c.eventSource.on(c.eventTypes.GENERATION_STOPPED, abortPending);
c.eventSource.on(c.eventTypes.CHAT_CHANGED, () => {
 if (pending) { abortPending(); stopGeneration(); }
 diagnostics=null;onDiagnostics(null);
 skipOnce = false; previewNode.value = ''; status('已切换聊天，规划已清空。');
});
return {
 getState: () => ({...state,awaitingReply:!!pending?.resume}),
 resume: () => {const run=pending;if(!run?.resume||run.identity!==chatIdentity())return false;const resume=run.resume;run.resume=null;resume();onState({...state,awaitingReply:false});return true;},
 getDiagnostics: () => diagnostics ? structuredClone(diagnostics) : null,
 isPlanning: () => !!pending && !pending.resume,
 setKey: value => { apiKey = value.trim(); },
 stop: () => { if(pending){abortPending();stopGeneration();} },
 settingsChanged: () => { if (!settings().enabled && pending) { abortPending(); stopGeneration(); } },
 skip: () => { skipOnce = !skipOnce; status(skipOnce ? '下次正文请求将跳过规划。' : '已撤销跳过。'); },
};
}
