/* 世界书私有扫描入口：合并挂载来源、本地开关、原生扫描器和独立计时状态。 */
import { createNativeScanner } from './native-world-scan.js?v=0.5.7-dev.1';
import { expandMacros } from './macros.js?v=0.5.7-dev.1';
import { selectInjections } from './compatibility.js?v=0.5.7-dev.1';
import { validateDatabaseMemories } from './database-memory.js?v=0.5.7-dev.1';
export const entryKey = (book, uid) => JSON.stringify([book, uid]);
export async function scanWorldInfo({ snapshot, selection = {}, previousState = {}, tokenize, random = Math.random, serializeYaml }) {
    const diagnostics = [], nextState = structuredClone(previousState);
    let variables = structuredClone(snapshot.variables || { local: {}, global: {} });
    const expand = text => {
        const value = expandMacros(text, { snapshot, compatibilityIds: selection.compatibilityIds, variables, serializeYaml });
        variables = value.variables; diagnostics.push(...value.diagnostics);
        if (value.diagnostics.some(d => d.blocking)) throw new Error(value.diagnostics.filter(d => d.blocking).map(d => d.message).join('\n'));
        return value.text;
    };
    const groups = { chat: [], persona: [], character: [], global: [] }, seen = new Set();
    const bindings = { ...snapshot.bindings, global: [...(snapshot.bindings.global || []), ...(selection.extraBooks || [])] };
    for (const scope of ['chat', 'persona', 'character', 'global']) for (const book of bindings[scope] || []) {
        if (seen.has(book) || selection.bookOverrides?.[book] === false) continue;
        seen.add(book);
        if (!snapshot.books[book]) throw new Error(`世界书「${book}」尚未读取或已删除。`);
        for (const [uid, raw] of Object.entries(snapshot.books[book].entries)) {
            if(raw.databaseManaged)continue;
            const e = { order: 100, position: 0, key: [], keysecondary: [], probability: 100, ...structuredClone(raw), world: book, uid: raw.uid ?? uid };
            e.disable = !(selection.entryOverrides?.[entryKey(book, e.uid)] ?? !e.disable);
            if (e.disable) continue;
            if (e.vectorized || e.automationId || e.characterFilter?.tags?.length) throw new Error(`世界书「${book}」条目 ${e.uid} 使用向量、自动化或标签过滤，尚未支持隔离扫描，请关闭该条目。`);
            // A stable full-data identity avoids applying stale timers to edited entries.
            e.hash = JSON.stringify(e);
            groups[scope].push(e);
        }
    }
    const sort = list => list.sort((a, b) => b.order - a.order);
    const strategy = snapshot.worldSettings?.world_info_character_strategy ?? 1;
    const rest = strategy === 0 ? sort([...groups.character, ...groups.global]) : strategy === 2 ? [...sort(groups.global), ...sort(groups.character)] : [...sort(groups.character), ...sort(groups.global)];
    const entries = [...sort(groups.chat), ...sort(groups.persona), ...rest];
    const injection = selectInjections(snapshot, selection.compatibilityIds);
    const context = { extensionPrompts: Object.fromEntries(injection.items.map(i => [i.key, i])), tagMap: {} };
    const engine = createNativeScanner({ settings: snapshot.worldSettings || {}, metadata: nextState, entries, context, expand, tokenize, random, characterFile: snapshot.character?.avatar?.replace(/\.[^.]+$/, '') });
    const history = [...snapshot.history].reverse().map(m => {
        const text = typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
        return snapshot.worldSettings?.world_info_include_names && m.name ? `${m.name}: ${text}` : text;
    });
    const c = snapshot.character || {}, env = snapshot.macroEnvironment || {};
    const result = await engine.scan(history, snapshot.maxContext, false, { trigger: snapshot.trigger || 'normal', personaDescription: env.persona || '', characterDescription: c.description || c.data?.description || '', characterPersonality: c.personality || c.data?.personality || '', characterDepthPrompt: c.data?.extensions?.depth_prompt?.prompt || '', scenario: c.scenario || c.data?.scenario || '', creatorNotes: c.data?.creator_notes || '' });
    const activated=[...result.allActivatedEntries];
    const database=validateDatabaseMemories(snapshot,activated);
    return { entries: activated, database, nextState, diagnostics, native: result, variables };
}
