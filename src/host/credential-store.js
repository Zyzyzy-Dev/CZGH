/* 浏览器本地密钥仓库：IndexedDB 持久保存，配置只引用随机 ID，不操作酒馆活动密钥。 */
import { createId } from '../bridge/id.js?v=0.5.5-dev.3';
export function createCredentialStore(indexedDB = globalThis.indexedDB) {
    async function run(mode, action) {
        if (!indexedDB) throw new Error('浏览器不支持本地密钥存储，请使用已有的编辑器方案。');
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('czgh-creative-planning-credentials', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('credentials');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(new Error('无法打开本地密钥存储，请检查浏览器网站数据权限。'));
        });
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction('credentials', mode);
                const request = action(tx.objectStore('credentials'));
                tx.oncomplete = () => resolve(request.result);
                tx.onabort = tx.onerror = () => reject(new Error('本地密钥保存或读取失败，方案未完成更新。'));
            });
        } finally { db.close(); }
    }
    return {
        async put(value) {
            if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error('请输入有效密钥。');
            const id = createId();
            await run('readwrite', store => store.put(value.trim(), id));
            return id;
        },
        async get(id) {
            const value = await run('readonly', store => store.get(id));
            if (typeof value !== 'string' || !value) throw new Error('此浏览器未保存该方案密钥，请重新输入并覆盖方案；未使用酒馆活动密钥。');
            return value;
        },
        remove: id => run('readwrite', store => store.delete(id)),
    };
}
