/* 数据库 1.2.9 世界书导出识别：沿用独立扫描，不读取原始全表或触发数据库更新。 */
import { recallTags, databaseRecallQuery, selectDatabaseMemos } from './database-recall.js?v=0.5.2-dev.4';
const generatedName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?TavernDB-ACU-(?:ReadableDataTable|OutlineTable|ImportantPersonsIndex|PersonsHeader|CustomExport(?:-.+)?|WrapperStart|WrapperEnd|MemoryStart|MemoryEnd)$/;
const rowName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?(?:重要人物条目|小总结条目|总结条目)\d+$/;
const unresolvedTemplate=/\{\[\s*(?:db\.|sql\b)|<if\s+(?:seed|cell|cond|db|sql)\s*=|<(?:calc|max|min|random)(?:\s|>)|\$v:/i;
const key=(book,uid)=>JSON.stringify([book,String(uid)]);
const memoName=/^(?:ACU-\[[^\r\n]*?\]-)?(?:外部导入-)?(?:TavernDB-ACU-CustomExport-纪要-|(?:小总结条目|总结条目)[\s_#-]*)(\d+)(?:\s.*)?$/i;
export const isDatabaseMemoEntry=entry=>memoName.test(String(entry.name||entry.comment||'').trim());

export function databaseMemoryMode(snapshot,selection){
    if(['keywords','ranked'].includes(selection.databaseMode))return selection.databaseMode;
    const input=String(snapshot.userInput??snapshot.history?.findLast(m=>m.role==='user')?.content??'');
    // A complete recall block is an explicit result, including an empty result.
    if(/<recall\b[^>]*>[\s\S]*?<\/recall\s*>/i.test(input))return 'keywords';
    if(/<recall\b/i.test(input))throw Error('数据库召回块尚未完整写入，本轮规划已停止，请待召回完成后重试。');
    const codes=new Set((input.match(/\bAM\d+\b/gi)||[]).map(code=>code.toUpperCase()));
    for(const data of Object.values(snapshot.books||{}))for(const entry of Object.values(data.entries||{})){
        if(!isDatabaseMemoEntry(entry))continue;
        const keys=[entry.key,entry.keys,entry.strategy?.keys].flat().filter(x=>typeof x==='string');
        if(keys.some(k=>codes.has(k.trim().toUpperCase())))return 'keywords';
    }
    return 'ranked';
}
export function prepareDatabaseMemory(snapshot,selection){
    if(!selection.compatibilityIds?.includes('database'))return {snapshot,selected:[],mode:'disabled'};
    const mode=databaseMemoryMode(snapshot,selection);
    if(mode==='keywords'){
        const copy=structuredClone(snapshot),target=snapshot.databaseTarget||selection.databaseBook;
        // Explicitly selected database books participate even when not natively attached.
        if(target){
            if(!copy.books?.[target])throw Error('数据库世界书不可用，请重新选择。');
            copy.bindings={...copy.bindings,global:[...(copy.bindings?.global||[]),target]};
        }
        copy.databaseKeywordMode=true;
        return {snapshot:copy,selected:[],mode};
    }
    const book=snapshot.databaseTarget||selection.databaseBook||snapshot.character?.data?.extensions?.world;
    if(!book||!snapshot.books?.[book])throw Error('数据库纪要世界书不可用，请在插件兼容中选择正确的世界书。');
    const copy=structuredClone(snapshot),candidates=[];
    for(const [uid,entry] of Object.entries(copy.books[book].entries||{})){
        const match=String(entry.name||entry.comment||'').trim().match(memoName);
        if(!match)continue;
        const id=entry.uid??uid;
        // This source owns all memo entries, including ones excluded by its limit.
        entry.databaseManaged=true;
        if(selection.bookOverrides?.[book]===false||selection.entryOverrides?.[JSON.stringify([book,id])]===false)continue;
        const content=String(entry.content||'').trim();
        if(content)candidates.push({uid:id,content,tags:recallTags(entry),name:entry.name||entry.comment});
    }
    const limit=Number.isInteger(selection.databaseLimit)?Math.max(1,Math.min(50,selection.databaseLimit)):20;
    const picked=selectDatabaseMemos(candidates,databaseRecallQuery(snapshot),limit);
    for(const entry of picked)if(unresolvedTemplate.test(entry.content))throw Error(`数据库纪要「${book} / ${entry.name}」包含尚未支持的查询或条件模板，请使用普通文本导出。`);
    copy.injections={...copy.injections,database_memory:{value:picked.map(e=>e.content).join('\n\n'),position:1,depth:0,role:0,scan:false}};
    return {snapshot:copy,selected:picked.map(e=>[book,e.uid]),mode};
}

export function databaseMemoryEntries(snapshot){
    const entries=[];
    for(const [book,data] of Object.entries(snapshot.books||{})){
        const rows=Object.entries(data.entries||{});
        // Chinese row names alone are ambiguous; require a matching database marker in the same book/scope.
        const scopes=new Set(rows.flatMap(([,entry])=>{const match=String(entry.comment||'').match(generatedName);return match?[(match[1]||'')+(match[2]||'')]:[];}));
        for(const [uid,entry] of rows){
            const name=String(entry.comment||''),row=name.match(rowName);
            if(generatedName.test(name)||(row&&scopes.has((row[1]||'')+(row[2]||''))))entries.push({book,uid:entry.uid??uid,name});
        }
    }
    return entries;
}

export function validateDatabaseMemories(snapshot,activated){
    const known=new Set(databaseMemoryEntries(snapshot).map(entry=>key(entry.book,entry.uid)));
    const selected=activated.filter(entry=>known.has(key(entry.world,entry.uid))||(snapshot.databaseKeywordMode&&isDatabaseMemoEntry(entry)));
    for(const entry of selected)if(unresolvedTemplate.test(String(entry.content||'')))throw new Error(`数据库记忆「${entry.world} / ${entry.comment}」仍包含查询或条件模板。当前仅支持已导出为普通文本的记忆，请调整数据库导出配置，或在规划世界书页关闭此条目。`);
    return selected.map(entry=>[entry.world,entry.uid]);
}
