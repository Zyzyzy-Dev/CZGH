/* 柏宝书公开只读宏适配：仅物化已选资料直接引用的宏，不扫描插件私有数据库。 */
import { resolvePreset } from '../planning/presets.js?v=0.5.2';
import { entryKey } from '../planning/world-info.js?v=0.5.2';
export async function materializePluginMacros(snapshot, selection, api) {
    const result=structuredClone(snapshot);result.macroEnvironment.pluginMacros={};
    if(!selection.compatibilityIds?.includes('baibai'))return result;
    const texts=resolvePreset(snapshot,selection).execution.map(e=>e.content||'');
    const books=new Set([...Object.values(snapshot.bindings).flat(),...(selection.extraBooks||[])]);
    for(const name of books)if(selection.bookOverrides?.[name]!==false)for(const [uid,e] of Object.entries(snapshot.books[name]?.entries||{}))if(selection.entryOverrides?.[entryKey(name,e.uid??uid)]??!e.disable)texts.push(e.content||'',...(e.key||[]),...(e.keysecondary||[]));
    const tokens=new Set(texts.flatMap(text=>[...text.matchAll(/{{\s*(bbs[^{}]*?)\s*}}/gi)].map(m=>m[1])));
    const numeric=value=>{if(value===undefined||value==='')return undefined;const n=Number(value);if(!Number.isInteger(n)||n<0)throw Error('柏宝书宏楼号须为非负整数。');return n;};
    const options=(floor,at)=>{if(at!==undefined&&!['before','after',''].includes(at))throw Error('柏宝书宏时点须为 before 或 after。');return {floor:numeric(floor),at:at||undefined};};
    for(const token of tokens){
        const [raw,...args]=token.split('::'),name=raw.trim().toLowerCase();let value;
        if(!api)throw Error('预设引用了柏宝书宏，但未检测到柏宝书公开接口。');
        if(name==='bbsvar')value=await api.getVar(args[0],options(args[1],args[2]));
        else if(name==='bbssnapshot')value=await api.getSnapshot(options(args[0],args[1]));
        else if(name==='bbsvars')value=(await api.getSnapshot()).vars;
        else if(name==='bbsstate')value=(await api.getSnapshot()).state;
        else if(name==='bbshistory')value=(await api.getHistory({before:numeric(args[0])})).relativeText;
        else if(name==='bbsinjectedhistory')value=(await api.getInjectedHistory()).relativeText;
        else if(name==='bbsfloor')value=await api.getFloor(numeric(args[0]));
        else throw Error(`尚未支持柏宝书宏 ${raw}。`);
        result.macroEnvironment.pluginMacros[token]=value==null?'':typeof value==='string'?value:JSON.stringify(value);
    }
    return result;
}
