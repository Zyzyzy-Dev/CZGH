/* 预设副本视图：按 prompt_order 执行，柏宝箱分组仅控制显示和私有组开关。 */
// TauriTavern excludes these markers from ordinary chat assembly. This
// planner handles the ordinary chat path, not its separate Agent runtime.
const agentOnlyMarkers = new Set(['agentSystemPrompt', 'agentTask', 'agentResults']);
export function resolvePreset(snapshot, selection = {}) {
    const id = selection.presetId || snapshot.currentPreset;
    const preset = snapshot.presets[id];
    if (!preset) throw new Error('所选预设已不存在，请重新选择。');
    const diagnostics = [];
    const orders = preset.prompt_order || [];
    const order = orders.find(x => Number(x.character_id) === 100001)?.order || orders.find(x => Number(x.character_id) === 100000)?.order;
    if (!Array.isArray(order)) throw new Error('此预设没有可识别的 prompt_order，不能推测执行顺序。');
    const metadata = preset.extensions?.baibaiToolkit?.presetPromptGroups || {};
    const definitions = [...(metadata.groups || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    const groups = definitions.map(g => ({ ...structuredClone(g), enabled: selection.groupOverrides?.[g.id] ?? g.enabled ?? true, entries: [] }));
    const ungrouped = { id: '', name: '未分组', enabled: true, entries: [] };
    const entries = new Map((preset.prompts || []).map(x => [x.identifier, x]));
    const execution = [];
    const display = [], displayedGroups = new Set();
    for (const item of order) {
        const source = entries.get(item.identifier);
        if (!source) { diagnostics.push({code:'missing-prompt',message:`预设顺序引用不存在的条目 ${item.identifier}。`,blocking:true}); continue; }
        const groupId = metadata.prompts?.[item.identifier]?.groupId;
        const group = groups.find(g => g.id === groupId) || ungrouped;
        const entry = { ...structuredClone(source), enabled: selection.promptOverrides?.[item.identifier] ?? item.enabled ?? false, groupId: group.id };
        group.entries.push(entry);
        if (!group.id) display.push({ type: 'prompt', entry });
        else if (!displayedGroups.has(group.id)) {
            displayedGroups.add(group.id);
            display.push({ type: 'group', group });
        }
        if (entry.enabled && group.enabled && !(entry.marker && agentOnlyMarkers.has(entry.identifier))) execution.push(entry);
    }
    for (const key of Object.keys(selection.promptOverrides || {})) if (!entries.has(key)) diagnostics.push({code:'missing-entry',message:`旧方案条目 ${key} 已删除，不再套用开关。`});
    if (ungrouped.entries.length) groups.push(ungrouped);
    for (const group of groups) { group.checked = group.enabled && group.entries.every(e => e.enabled); group.partial = group.enabled && !group.checked && group.entries.some(e => e.enabled); }
    return { id, execution, groups, display, diagnostics };
}
