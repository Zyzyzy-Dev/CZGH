/* 数据库 1.2.9 世界书导出识别：沿用独立扫描，不读取原始全表或触发数据库更新。 */
const generatedName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?TavernDB-ACU-(?:ReadableDataTable|OutlineTable|ImportantPersonsIndex|PersonsHeader|CustomExport(?:-.+)?|WrapperStart|WrapperEnd|MemoryStart|MemoryEnd)$/;
const rowName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?(?:重要人物条目|小总结条目|总结条目)\d+$/;
const unresolvedTemplate=/\{\[\s*(?:db\.|sql\b)|<if\s+(?:seed|cell|cond|db|sql)\s*=|<(?:calc|max|min|random)(?:\s|>)|\$v:/i;
const key=(book,uid)=>JSON.stringify([book,String(uid)]);
const memoName=/^(?:ACU-\[[^\r\n]*?\]-)?(?:外部导入-)?(?:TavernDB-ACU-CustomExport-纪要-|(?:小总结条目|总结条目)[\s_#-]*)(\d+)(?:\s.*)?$/i;
export const isDatabaseMemoEntry=entry=>memoName.test(String(entry.comment||entry.name||'').trim());

export function prepareDatabaseMemory(snapshot,selection){
    if(!selection.compatibilityIds?.includes('database'))return {snapshot,selected:[]};
    const book=snapshot.databaseTarget||selection.databaseBook||snapshot.character?.data?.extensions?.world;
    if(!book||!snapshot.books?.[book])throw Error('数据库纪要世界书不可用，请在插件兼容中选择正确的世界书。');
    const copy=structuredClone(snapshot),candidates=[];
    for(const [uid,entry] of Object.entries(copy.books[book].entries||{})){
        const match=String(entry.comment||entry.name||'').trim().match(memoName);
        if(!match)continue;
        const id=entry.uid??uid;
        // This source owns all memo entries, including ones excluded by its limit.
        entry.databaseManaged=true;
        if(selection.bookOverrides?.[book]===false||selection.entryOverrides?.[JSON.stringify([book,id])]===false)continue;
        const content=String(entry.content||'').trim();
        if(content)candidates.push({uid:id,content,number:Number(match[1]),name:entry.comment||entry.name});
    }
    const limit=Number.isInteger(selection.databaseLimit)?Math.max(1,Math.min(200,selection.databaseLimit)):20;
    const picked=candidates.sort((a,b)=>b.number-a.number||String(a.uid).localeCompare(String(b.uid))).slice(0,limit).reverse();
    for(const entry of picked)if(unresolvedTemplate.test(entry.content))throw Error(`数据库纪要「${book} / ${entry.name}」包含尚未支持的查询或条件模板，请使用普通文本导出。`);
    copy.injections={...copy.injections,database_memory:{value:picked.map(e=>e.content).join('\n\n'),position:1,depth:0,role:0,scan:false}};
    return {snapshot:copy,selected:picked.map(e=>[book,e.uid])};
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
    const selected=activated.filter(entry=>known.has(key(entry.world,entry.uid)));
    for(const entry of selected)if(unresolvedTemplate.test(String(entry.content||'')))throw new Error(`数据库记忆「${entry.world} / ${entry.comment}」仍包含查询或条件模板。当前仅支持已导出为普通文本的记忆，请调整数据库导出配置，或在规划世界书页关闭此条目。`);
    return selected.map(entry=>[entry.world,entry.uid]);
}
