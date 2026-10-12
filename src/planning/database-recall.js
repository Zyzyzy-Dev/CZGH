/* 构画 98053ee 的数据库检索规则：中文双字/英文词重合评分，同分取靠后记录，再恢复原顺序。 */
// Reference: ST-SevenDaysCal/index.js buildAnimaRecallQuery/selectAnimaSlices.
export function recallTokens(text){
    const value=String(text||'').toLowerCase().replace(/\s+/g,' '),tokens=new Set();
    for(const run of value.match(/[\u3400-\u9fff]{2,}/g)||[]){
        if(run.length<=8)tokens.add(run);
        for(let i=0;i<run.length-1;i++)tokens.add(run.slice(i,i+2));
    }
    for(const word of value.match(/[a-z0-9_]{2,}/g)||[])tokens.add(word);
    return tokens;
}
export function recallTags(entry){
    return [...new Set([entry.name,entry.comment,entry.strategy?.keys,entry.key,entry.keys].flat().filter(x=>x!=null&&String(x).trim()).map(x=>String(x).trim()))].join(' ');
}
// Same default cleaning policy as Gouhua: retain content, rescue it through other
// wrappers, remove paired non-content blocks; preserve text in unclosed wrappers.
export function recallProse(raw){
    const source=String(raw||'').replace(/<!--[\s\S]*?-->/g,''),root={children:[]},stack=[root];
    const pattern=/<\/?([\p{L}_][\p{L}\p{N}_.:-]*)(?:\s[^>]*)?\/?>|\[\[([\s\S]*?)\]\]/gu;
    let end=0;
    for(const m of source.matchAll(pattern)){
        const parent=stack.at(-1);parent.children.push(source.slice(end,m.index));end=m.index+m[0].length;
        if(m[2]!==undefined){parent.children.push({bracket:true,children:[recallProse(m[2])]});continue;}
        const name=m[1],normalized=name.toLowerCase();
        if(m[0].startsWith('</')){
            for(let i=stack.length-1;i>0;i--)if(normalized==='content'?stack[i].name.toLowerCase()===normalized:stack[i].name===name){stack[i].closed=true;stack.length=i;break;}
        }else if(!/\/\s*>$/.test(m[0])){const node={name,children:[],closed:false};parent.children.push(node);stack.push(node);}
    }
    stack.at(-1).children.push(source.slice(end));
    const render=(children,rescue=false)=>children.map(node=>{
        if(typeof node==='string')return rescue?'':node;
        if(node.bracket)return rescue?'':'[['+render(node.children)+']]';
        return render(node.children,node.closed?node.name.toLowerCase()!=='content':rescue);
    }).join('');
    return render(root.children).replace(/\n{3,}/g,'\n\n').trim();
}
export function databaseRecallQuery(snapshot){
    const recent=snapshot.databaseRecent??(snapshot.history||[]).filter(m=>m.role==='assistant').map(m=>m.content);
    return `${snapshot.userInput||''}\n${recent.slice(-6).map(text=>recallProse(text).slice(-700)).join('\n')}`.slice(-6000);
}
export function selectDatabaseMemos(items,query,limit){
    const tokens=recallTokens(query);
    return items.map((item,index)=>{
        const hay=recallTokens(`${item.tags}\n${item.content}`);
        let score=0;for(const token of tokens)if(hay.has(token))score+=token.length>=4?2:1;
        return {item,index,score};
    }).sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,limit).sort((a,b)=>a.index-b.index).map(x=>x.item);
}
