/* 兼容资料注册表：仅选择明确属于插件的本轮注入槽，保留注入位置。 */
export const adapters = Object.freeze([
    { id: 'database', name: '数据库', category: 'memory', slots: ['database_memory'] },
    { id: 'baibai', name: '柏宝书', category: 'memory', slots: ['baibai_book_memory', 'baibai_book_memory_history', 'baibai_book_memory_state', 'baibai_book_time_tag', 'baibai_book_vector_recall'] },
    { id: 'seven-days', name: '构画', category: 'plot', slots: ['sp_outline_step', 'sp_lines_latent', 'sp_ledger_remind'] },
]);
export function selectInjections(snapshot, compatibilityIds = []) {
    const items = [], diagnostics = [];
    for (const adapter of adapters) {
        if (!compatibilityIds.includes(adapter.id)) continue;
        for (const key of adapter.slots) {
            const value = snapshot.injections?.[key];
            if (value?.hasFilter && value?.value?.trim()) diagnostics.push({code:'filtered-injection',message:`${adapter.name}注入带有尚未支持的动态过滤器。`,blocking:true});
            else if (value?.value?.trim() && value.position !== -1) items.push({ ...structuredClone(value), key, adapterId: adapter.id });
        }
        if (!items.some(x => x.adapterId === adapter.id)) diagnostics.push({ code: 'no-injection', message: `${adapter.name}本轮暂无注入。` });
    }
    return { items, diagnostics };
}
