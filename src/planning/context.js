/* 独立规划消息组装：预设标记、私有宏、世界书扫描和指定插件的注入位置。 */
import { resolvePreset } from './presets.js?v=0.5.7';
import { scanWorldInfo } from './world-info.js?v=0.5.7';
import { expandMacros } from './macros.js?v=0.5.7';
import { selectInjections } from './compatibility.js?v=0.5.7';
import { prepareDatabaseMemory } from './database-memory.js?v=0.5.7';
const roles = ['system', 'user', 'assistant'];
export async function buildPlanningContext({ snapshot, selection, worldState = {}, tokenize, random = Math.random, renderTemplate, serializeYaml }) {
    const database=prepareDatabaseMemory(snapshot,selection);snapshot=database.snapshot;
    if (snapshot.capabilities?.groupChat) throw new Error('当前独立上下文暂未验证群聊角色轮换，请在单角色聊天中使用。');
    if (snapshot.capabilities?.media) throw new Error('当前聊天包含附件，尚未实现附件的独立来源组装；正文已停止以避免丢失附件。');
    const preset = resolvePreset(snapshot, selection);
    const scan = await scanWorldInfo({ snapshot, selection, previousState: worldState, tokenize, random, serializeYaml });
    const injected = selectInjections(snapshot, selection.compatibilityIds);
    const diagnostics = [...preset.diagnostics, ...scan.diagnostics, ...injected.diagnostics];
    let variables = scan.variables;
    const expand = text => { const r = expandMacros(text, { snapshot, compatibilityIds: selection.compatibilityIds, variables, serializeYaml }); variables = r.variables; diagnostics.push(...r.diagnostics); return r.text; };
    const c = snapshot.character || {};
    const fields = { charDescription: c.description || c.data?.description || '', charPersonality: c.personality || c.data?.personality || '', scenario: c.scenario || c.data?.scenario || '', personaDescription: snapshot.macroEnvironment.persona || '', worldInfoBefore: scan.native.worldInfoBefore, worldInfoAfter: scan.native.worldInfoAfter };
    const history = snapshot.history.map(m => ({ role: m.role, content: structuredClone(m.content) }));
    const depthItems = [], start = [], end = [], messages = [];
    for (const item of injected.items) {
        const message = { role: roles[item.role ?? 0] || 'system', content: expand(item.value) };
        if (item.position === 1) depthItems.push({ depth: Number(item.depth) || 0, message });
        else if (item.position === 2) start.push(message);
        else if (item.position === 0) end.push(message);
    }
    for (const item of scan.native.WIDepthEntries) depthItems.push({ depth: item.depth ?? 4, message: { role: roles[item.role ?? 0] || 'system', content: item.entries.join('\n') } });
    if (Object.keys(scan.native.outletEntries).length) throw new Error('选中世界书使用尚未支持的 outlet 位置。');
    const note = snapshot.authorNote;
    if (note?.enabled && note.position !== -1) {
        const content = [ ...scan.native.ANBeforeEntries, expand(note.value), ...scan.native.ANAfterEntries ].filter(Boolean).join('\n');
        const message = { role: roles[note.role] || 'system', content };
        if (content && note.position === 1) depthItems.push({ depth: Number(note.depth) || 0, message });
        else if (content && note.position === 2) start.push(message);
        else if (content && note.position === 0) end.push(message);
    }
    let usedHistory = false;
    for (const entry of preset.execution) {
        if (entry.identifier === 'chatHistory') { messages.push(...history); usedHistory = true; continue; }
        let content;
        if (entry.marker) {
            if (Object.hasOwn(fields, entry.identifier)) content = expand(fields[entry.identifier]);
            else if (entry.identifier === 'dialogueExamples') {
                const examples = [expand(c.mes_example || c.data?.mes_example || '')];
                for (const item of scan.native.EMEntries) {
                    if (item.position === 0) examples.unshift(item.content);
                    else examples.push(item.content);
                }
                content = examples.filter(Boolean).join('\n<START>\n');
                let example;
                const flush = () => { if(example?.content.trim())messages.push({...example,content:example.content.trim()});example=null; };
                for (const line of content.split(/\r?\n/)) {
                    if (line.trim() === '<START>') { flush(); continue; }
                    const userPrefix = `${snapshot.macroEnvironment.user}:`, charPrefix = `${snapshot.macroEnvironment.char}:`;
                    if (line.startsWith(userPrefix) || line.startsWith(charPrefix)) {
                        flush(); const isUser=line.startsWith(userPrefix);
                        example={role:'system',name:isUser?'example_user':'example_assistant',content:line.slice((isUser?userPrefix:charPrefix).length)};
                    } else if(example)example.content+='\n'+line;
                    else if(line.trim())diagnostics.push({code:'unparsed-example',message:'角色示例存在未标明说话人的文本。',blocking:true});
                }
                flush();continue;
            } else diagnostics.push({ code: 'unknown-marker', message: `尚未支持预设标记 ${entry.identifier}。`, blocking: true });
        } else content = expand(entry.content || '');
        if (!content) continue;
        const message = { role: entry.role || 'system', content };
        if (Number(entry.injection_position) === 1) depthItems.push({ depth: Number(entry.injection_depth) || 0, message });
        else if(entry.identifier==='main')messages.push(...start,message,...end);
        else messages.push(message);
    }
    if (!usedHistory) throw new Error('规划预设未启用聊天历史标记，无法确定本轮输入位置。');
    // Locate depth relative to history messages, not trailing system instructions.
    const historyEnd = messages.indexOf(history.at(-1)) + 1, historyStart=messages.indexOf(history[0]);
    const buckets=new Map();
    for(const item of depthItems){const anchor=Math.max(historyStart,historyEnd-item.depth);if(!buckets.has(anchor))buckets.set(anchor,[]);buckets.get(anchor).push(item.message);}
    for(const [anchor,items] of [...buckets].sort((a,b)=>b[0]-a[0])) {
        messages.splice(Math.max(0,anchor),0,...items);
    }
    const initialErrors = diagnostics.filter(d => d.blocking);
    if (initialErrors.length) throw new Error(initialErrors.map(d => d.message).join('\n'));
    for (const message of messages) {
        if (renderTemplate) message.content = await renderTemplate(message.content);
        message.content = message.content.replace(/{{\s*(?:get|format)_(?:message|chat|character|preset|global)_variable::[^{}]*}}/gi, token => expand(token));
    }
    const blocked = diagnostics.filter(d => d.blocking);
    if (blocked.length) throw new Error(blocked.map(d => d.message).join('\n'));
    const total = await tokenize(messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n'));
    if (total > (snapshot.inputBudget ?? snapshot.maxContext)) throw new Error('独立规划上下文超过扣除输出后的预算，请减少选择的资料。');
    return { messages, sourceManifest: { preset: preset.id, entries: preset.execution.map(e => e.identifier), world: scan.entries.map(e => [e.world, e.uid]), database: [...scan.database,...database.selected], databaseMode: database.mode, databaseReason: database.reason, plugins: injected.items.map(i => i.key) }, diagnostics, nextWorldState: scan.nextState };
}
