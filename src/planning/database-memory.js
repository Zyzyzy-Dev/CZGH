/* 数据库 1.2.9 世界书导出识别：沿用独立扫描，不读取原始全表或触发数据库更新。 */
import { recallTags, databaseRecallQuery, selectDatabaseMemos } from './database-recall.js?v=0.5.5-dev.3';
const generatedName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?TavernDB-ACU-(?:ReadableDataTable|OutlineTable|ImportantPersonsIndex|PersonsHeader|CustomExport(?:-.+)?|WrapperStart|WrapperEnd|MemoryStart|MemoryEnd)$/;
const rowName=/^(ACU-\[[^\r\n]*?\]-)?(外部导入-)?(?:重要人物条目|小总结条目|总结条目)\d+$/;
const unresolvedTemplate=/\{\[\s*(?:db\.|sql\b)|<if\s+(?:seed|cell|cond|db|sql)\s*=|<(?:calc|max|min|random)(?:\s|>)|\$v:/i;
const key=(book,uid)=>JSON.stringify([book,String(uid)]);
const memoName=/^(?:ACU-\[[^\r\n]*?\]-)?(?:外部导入-)?(?:TavernDB-ACU-CustomExport-纪要-|(?:小总结条目|总结条目)[\s_#-]*)(\d+)(?:\s.*)?$/i;
export const isDatabaseMemoEntry=entry=>memoName.test(String(entry.name||entry.comment||'').trim());
export const databaseSourceBooks=(snapshot,selection)=>[...new Set([...Object.values(snapshot.bindings||{}).flat(),...(selection.extraBooks||[])].filter(Boolean))].filter(book=>selection.bookOverrides?.[book]!==false);

export function databaseMemoryDecision(snapshot,selection){
    // One automatic policy. Ignore obsolete manual modes even in unmigrated snapshots.
    const input=String(snapshot.userInput??snapshot.history?.findLast(m=>m.role==='user')?.content??'');
    // Validate all blocks before accepting any result: a completed block can be
    // followed by a second block that is still streaming. Nested blocks are invalid.
    let open=false,blocks=0;
    const fail=()=>{throw Error('数据库召回块尚未完整写入或格式无效，本轮规划已停止，请待召回完成后重试。');};
    const remainder=input.replace(/<\/?recall\b[^>]*>/gi,tag=>{
        if(/^<\/recall\s*>$/i.test(tag)){if(!open)fail();open=false;blocks++;}
        else if(/^<recall(?:\s[^>]*)?>$/i.test(tag)&&!tag.endsWith('/>')){if(open)fail();open=true;}
        else fail();
        return '';
    });
    if(open||/<\/?recall\b/i.test(remainder))fail();
    if(blocks)return {mode:'keywords',reason:'recall-block'};
    const codes=new Set((input.match(/\bAM\d+\b/gi)||[]).map(code=>code.toUpperCase()));
    const books=databaseSourceBooks(snapshot,selection);
    for(const book of books){
        if(selection.bookOverrides?.[book]===false)continue;
        for(const [uid,entry] of Object.entries(snapshot.books?.[book]?.entries||{})){
            if(!isDatabaseMemoEntry(entry)||!(selection.entryOverrides?.[JSON.stringify([book,entry.uid??uid])]??!entry.disable))continue;
            const keys=[entry.key,entry.keys,entry.strategy?.keys].flat().filter(x=>typeof x==='string');
            if(keys.some(k=>codes.has(k.trim().toUpperCase())))return {mode:'keywords',reason:'matched-codes'};
        }
    }
    return {mode:'ranked',reason:'no-recall-signal'};
}
export const databaseMemoryMode=(snapshot,selection)=>databaseMemoryDecision(snapshot,selection).mode;
export function prepareDatabaseMemory(snapshot,selection){
    if(!selection.compatibilityIds?.includes('database'))return {snapshot,selected:[],mode:'disabled',reason:'disabled'};
    const {mode,reason}=databaseMemoryDecision(snapshot,selection);
    if(mode==='keywords'){
        const copy=structuredClone(snapshot);
        copy.databaseKeywordMode=true;
        return {snapshot:copy,selected:[],mode,reason};
    }
    const copy=structuredClone(snapshot),candidates=[];
    for(const book of databaseSourceBooks(snapshot,selection)){
      if(!copy.books?.[book])throw Error(`无法读取世界书「${book}」。`);
      for(const [uid,entry] of Object.entries(copy.books[book].entries||{})){
        const match=String(entry.name||entry.comment||'').trim().match(memoName);
        if(!match)continue;
        const id=entry.uid??uid;
        // This source owns all memo entries, including ones excluded by its limit.
        entry.databaseManaged=true;
        if(selection.bookOverrides?.[book]===false||selection.entryOverrides?.[JSON.stringify([book,id])]===false)continue;
        const content=String(entry.content||'').trim();
        if(content)candidates.push({book,uid:id,content,tags:recallTags(entry),name:entry.name||entry.comment});
      }
    }
    const picked=selectDatabaseMemos(candidates,databaseRecallQuery(snapshot),25);
    for(const entry of picked)if(unresolvedTemplate.test(entry.content))throw Error(`数据库纪要「${entry.book} / ${entry.name}」包含尚未支持的查询或条件模板，请使用普通文本导出。`);
    copy.injections={...copy.injections,database_memory:{value:picked.map(e=>e.content).join('\n\n'),position:1,depth:0,role:0,scan:false}};
    return {snapshot:copy,selected:picked.map(e=>[e.book,e.uid]),mode,reason};
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
