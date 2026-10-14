/* API 方案宿主服务：外部只读、自有方案副本持久化、禁止改变活动密钥。 */
import { applySchemeOperation, migrateSchemes } from '../planning/schemes.js?v=0.5.7';

export function createApiSchemes(host) {
    let queue = Promise.resolve();
    const serial = action => { const result = queue.then(action); queue = result.catch(() => {}); return result; };
    const localId = id => {
        if (typeof id !== 'string' || !id.startsWith('local:')) throw new Error('当前连接和外部方案只读，请新建本地方案。');
        return id.slice(6);
    };
    const read = () => migrateSchemes(host.read());
    const release = async (ref, state) => {
        if (ref && !state.schemes.api.some(p => p.payload.keyRef === ref)) await host.vault?.remove(ref);
    };
    return {
        async list() {
            const metadata = p => ({ additional:structuredClone(p.additional||{}), model:p.model, apiUrl:p.connection?.custom_url||p.apiUrl||'', hasKey:!!(p.secretId||p.keyRef) });
            const current = host.currentSummary?.() || {};
            return [{ ...metadata(current), id:'current', name:'酒馆当前连接', origin:'current', keyState:'current', additional:structuredClone(host.currentAdditional?.()||current.additional||{}) }, ...host.external().map(p => ({ ...metadata(p), id:`external:${p.id}`, name:p.name, origin:'external' })), ...read().schemes.api.map(p => ({ ...metadata(p.payload), id:`local:${p.id}`, name:p.name, origin:'local' }))];
        },
        async resolve(selection, options) {
            let config;
            if (selection === 'current') config = await host.current(options);
            else if (selection?.startsWith('external:')) config = host.external().find(p => p.id === selection.slice(9));
            else config = read().schemes.api.find(p => p.id === localId(selection))?.payload;
            if (!config) throw new Error('API 方案已删除或当前连接不可用。');
            return structuredClone(config);
        },
        save({ id, name, config, key }) {
            return serial(async () => {
                if (id) localId(id);
                const state = read();
                const next = applySchemeOperation(state, { kind: 'api', operation: id ? 'overwrite' : 'create', id: id ? localId(id) : undefined, name, payload: config });
                const saved = id ? next.schemes.api.find(p => p.id === localId(id)) : next.schemes.api.at(-1);
                const oldRef = id ? state.schemes.api.find(p => p.id === localId(id))?.payload.keyRef : null;
                let newRef;
                if (key) {
                    if (!host.vault) throw new Error('本地密钥存储不可用。');
                    newRef = await host.vault.put(key);
                    saved.payload.keyRef = newRef;
                    delete saved.payload.secretId;
                }
                next.apiSelection = `local:${saved.id}`;
                try { await host.write(next); }
                catch (error) { if (newRef) await host.vault.remove(newRef); throw error; }
                await release(oldRef, next);
                return structuredClone(saved);
            });
        },
        remove(id) {
            return serial(async () => {
                const previous = read();
                const oldRef = previous.schemes.api.find(p => p.id === localId(id))?.payload.keyRef;
                const next = applySchemeOperation(previous, { kind: 'api', operation: 'delete', id: localId(id) });
                if (next.apiSelection === id) next.apiSelection = '';
                await host.write(next);
                await release(oldRef, next);
            });
        },
        async models(config, options) {
            if (!host.models) throw new Error('当前连接不支持拉取模型，可手动输入。');
            return host.models(structuredClone(config), options);
        },
    };
}
