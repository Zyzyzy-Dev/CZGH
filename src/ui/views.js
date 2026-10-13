/* 三页工作台视图：设置、预设开关、世界书开关与来源详情；所有操作交给宿主。 */
import { el, button, field, check, toggleSwitch, select, section, detail, ask } from './components.js?v=0.5.4-dev.1';
import { entryKey } from '../planning/world-info.js?v=0.5.4-dev.1';
import { schemeSelectionState } from '../planning/schemes.js?v=0.5.4-dev.1';
import { promptDefaults } from '../planning/core.js?v=0.5.4-dev.1';
import { editAdditional } from './additional-editor.js?v=0.5.4-dev.1';
import { editPrompt } from './prompt-editor.js?v=0.5.4-dev.1';
import { isDatabaseMemoEntry } from '../planning/database-memory.js?v=0.5.4-dev.1';
export function renderView(root, state, ui, act) {
    const samePage=root.dataset.page===ui.page;
    const scrollTop=samePage?root.scrollTop:0;
    const open=new Map(samePage?[...root.querySelectorAll('details[data-view-key]')].map(node=>[node.dataset.viewKey,node.open]):[]);
    const active=document.activeElement;
    const focus=samePage&&root.contains(active)?{label:active.getAttribute('aria-label'),tag:active.tagName,type:active.type,start:active.selectionStart,end:active.selectionEnd}:null;
    const matchesFocus=node=>node.tagName===focus.tag&&node.type===focus.type&&node.getAttribute('aria-label')===focus.label;
    const focusIndex=focus?[...root.querySelectorAll('[aria-label]')].filter(matchesFocus).indexOf(active):-1;
    // Build off-DOM so intermediate empty content cannot clamp the scroll position.
    const next=el('div');
    buildView(next,state,ui,act,root);
    for(const node of next.querySelectorAll('details[data-view-key]'))if(open.has(node.dataset.viewKey))node.open=open.get(node.dataset.viewKey);
    root.replaceChildren(...next.childNodes);root.dataset.page=ui.page;
    if(focus?.label){
        const target=[...root.querySelectorAll('[aria-label]')].filter(matchesFocus)[focusIndex];
        target?.focus({preventScroll:true});
        if(target&&focus.start!=null)target.setSelectionRange(focus.start,focus.end);
    }
    root.scrollTop=scrollTop;
}
function buildView(root, state, ui, act, liveRoot) {
    const s=state.settings, selection=s.selection;
    root.replaceChildren();
    const toolbar=(kind)=>{
        const bar=el('div','scheme-bar');bar.append(el('span','muted','方案'));
        const nativeName=kind==='preset'?'当前酒馆预设':'当前酒馆世界书';
        const tracked=schemeSelectionState(s,kind), selected=tracked.id;
        const options=[{id:'',name:''},{id:'@current',name:nativeName},...s.schemes[kind]];
        const chooser=select(`${kind==='preset'?'预设':'世界书'}方案`,options,selected,async id=>{
            if(id==='@current'){
                if(await ask(`是否载入${nativeName}？将替换本页的独立选择，不修改酒馆原配置。`,'',true,'载入'))await act('scheme.loadCurrent',{kind});
                else renderView(liveRoot,state,ui,act);
            }else if(id)await act('scheme.save',{kind,applyId:id});
        });
        chooser.options[0].disabled=true;chooser.options[0].hidden=true;bar.append(chooser);
        bar.append(button('新建方案',async()=>{const name=await ask('新建方案','');if(name)await act('scheme.save',{kind,name});},'+'));
        const overwrite=button('覆盖方案',async()=>{const item=options.find(x=>x.id===selected);if(!item?.id)return;const name=await ask('覆盖方案',item.name);if(name)await act('scheme.save',{kind,id:item.id,name});},'↥');overwrite.disabled=!s.schemes[kind].some(x=>x.id===selected);if(overwrite.disabled)overwrite.title='请先选择已保存的方案；当前酒馆来源不能覆盖';bar.append(overwrite);
        const remove=button('删除方案',async()=>{if(await ask('删除选中的方案？','',true)){await act('scheme.remove',{kind,id:selected});}},'⌫');remove.disabled=!s.schemes[kind].some(x=>x.id===selected);if(remove.disabled)remove.title='请先选择已保存的方案；当前酒馆来源不能删除';bar.append(remove);return bar;
    };
    const saveHint=kind=>{const x=schemeSelectionState(s,kind);const hint=el('p','save-hint',x.dirty?'改动未保存':x.id?'改动已保存':'');hint.setAttribute('role','status');if(!x.id&&x.dirty)hint.append(el('span','save-help',' · 点击＋新建方案'));return hint;};
    const change=async(key,id,value)=>{
        if(!['promptOverrides','groupOverrides'].includes(key))return act('selection.update',{[key]:{...selection[key],[id]:value}});
        selection[key][id]=value;
        for(const group of state.preset?.groups||[]){
            if(key==='groupOverrides'&&group.id===id)group.enabled=value;
            if(key==='promptOverrides')for(const entry of group.entries)if(entry.identifier===id)entry.enabled=value;
        }
        if(ui.page==='preset')liveRoot.querySelector('.save-hint')?.replaceWith(saveHint('preset'));
        const result=await act('selection.update',{[key]:{...selection[key]},compact:true},false);
        if(!result)await act('state.read');
    };
    const row=(label,content,checked,toggle)=>{const node=el('div','entry-row');const open=button('查看 '+label,()=>detail(label,content));open.textContent=label;open.className='entry-open';node.append(open,toggleSwitch(label,checked,toggle));node.addEventListener('click',event=>{if(event.target===node)detail(label,content);});return node;};
    if(ui.page==='settings'){
        root.append(check('启用创作规划',s.enabled,v=>act('settings.update',{enabled:v})));
        const api=el('div','section-body');
        const profile=state.profiles.find(p=>p.id===s.apiSelection);
        const apiOptions=profile?state.profiles:[{id:s.apiSelection||'',name:'原方案不可用，请重新选择',origin:'missing'},...state.profiles];
        const draft=ui.apiDraft;
        const bar=el('div','scheme-bar');bar.append(el('span','muted','方案'),select('API 方案',apiOptions.map(p=>({...p,name:`${p.origin==='local'?'本地 · ':''}${p.name}`})),s.apiSelection,async value=>{ui.apiDraft={};await act('settings.update',{apiSelection:value});}));
        const save=async overwrite=>{const name=await ask(overwrite?'覆盖 API 方案':'新建 API 方案',overwrite?profile?.name:'');if(name)await act('api.save',{id:overwrite?s.apiSelection:undefined,sourceId:s.apiSelection,name,apiUrl:draft.apiUrl,model:draft.model,key:draft.key,additional:draft.additional});};
        bar.append(button('新建 API 方案',()=>save(false),'+'));
        const over=button('覆盖 API 方案',()=>save(true),'↥');over.disabled=profile?.origin!=='local';bar.append(over);
        const del=button('删除 API 方案',async()=>{if(await ask('删除此 API 方案？','',true))await act('api.remove',{id:s.apiSelection});},'⌫');del.disabled=profile?.origin!=='local';bar.append(del);api.append(bar);
        api.append(field('URL',draft.apiUrl??profile?.apiUrl,v=>draft.apiUrl=v));
        const key=field('Key',draft.key||'',v=>draft.key=v,'password');key.querySelector('input').placeholder=profile?.hasKey?'已保存，留空保留原密钥':'输入新密钥';key.append(button('显示或隐藏密钥',()=>{const input=key.querySelector('input');input.type=input.type==='password'?'text':'password';},'◉'));api.append(key);
        const model=field('模型',draft.model??profile?.model,v=>draft.model=v);model.querySelector('input').setAttribute('list','model-list');model.append(button('拉取模型',async()=>{ui.models=await act('api.models',{},false);renderView(liveRoot,state,ui,act);}));api.append(model);
        const list=el('datalist');list.id='model-list';for(const name of ui.models||[]){const o=el('option');o.value=name;list.append(o);}api.append(list);
        const numbers=el('div','two-fields');numbers.append(field('最大输出',s.maxTokens,v=>act('settings.update',{maxTokens:v}),'number'),field('超时秒数',s.timeoutSeconds,v=>act('settings.update',{timeoutSeconds:v}),'number'));numbers.classList.add('api-limits');numbers.append(button('附加参数',()=>editAdditional(draft.additional??profile?.additional,value=>{draft.additional=value;})));api.append(numbers);

        api.append(check('流式输出规划',s.stream,v=>act('settings.update',{stream:v})));root.append(section('通用设置',api));
        const compatibility=el('div','section-body');
        for(const [category,label] of [['memory','记忆插件'],['plot','剧情规划插件']]){compatibility.append(el('h3','',label));for(const plugin of state.compatibility.filter(p=>p.category===category)){const line=el('div','plugin-row');line.append(check(plugin.name,selection.compatibilityIds.includes(plugin.id),v=>act('selection.update',{compatibilityIds:v?[...selection.compatibilityIds,plugin.id]:selection.compatibilityIds.filter(x=>x!==plugin.id)})),el('small','muted',plugin.status));compatibility.append(line);}}
        root.append(section('插件兼容',compatibility));
        const syntax=el('div','section-body');
        syntax.append(check('EJS 模板兼容（ST-Prompt-Template）',s.templateCompat,v=>act('settings.update',{templateCompat:v})),el('p','hint','按已安装模板插件执行 EJS；模板中的脚本可能修改变量。不会自动执行 MVU 生成后回写。'));
        root.append(section('提示词语法',syntax,true));
        const display=el('div','section-body');display.append(check('在用户消息下显示规划',s.displayPlan,v=>act('settings.update',{displayPlan:v})));root.append(section('显示设置',display));
        const advanced=el('div','section-body advanced-settings');advanced.append(check('规划完成后自动生成正文',s.autoReply,v=>act('settings.update',{autoReply:v})));advanced.append(select('规划标签',[{id:'auto',name:'自动跟随预设标签'},{id:'manual',name:'手动指定标签'}],s.tagMode,v=>act('settings.update',{tagMode:v})));
        if(s.tagMode==='manual')advanced.append(field('开始标签',s.openTag,v=>act('settings.update',{openTag:v})),field('结束标签',s.closeTag,v=>act('settings.update',{closeTag:v})));
        advanced.append(el('h3','','内置提示词设置'));
        for(const [key,title,description] of [
            ['plannerPrompt','插件内置提示词','发送给规划 API 的完整引导。当前预设的规划标签要求由插件自动附加，无需填写宏。修改后点击完成保存；恢复默认仅替换当前草稿。'],
            ['writerPrompt','注入正文上下文提示词','与规划一起注入正文上下文的完整引导。实际规划及首尾标签由插件自动附加，无需手动粘贴。修改后点击完成保存；恢复默认仅替换当前草稿。'],
        ]) {
            const value=s[key]??promptDefaults[key];
            const row=button(`编辑${title}`,()=>editPrompt({title,value,defaultValue:promptDefaults[key],description,save:text=>act('settings.update',{[key]:text})}));
            row.className='prompt-setting';row.replaceChildren(el('span','prompt-name',title),el('small',value===promptDefaults[key]?'prompt-badge':'prompt-badge custom',value===promptDefaults[key]?'默认':'已自定义'));
            const icon=button('编辑',()=>{},'↥').querySelector('svg');if(icon)row.append(icon);
            advanced.append(row);
        }
        const advancedCard=section('高级设置',advanced,ui.advancedCollapsed??true);
        advancedCard.addEventListener('toggle',()=>{if(advancedCard.isConnected)ui.advancedCollapsed=!advancedCard.open;});root.append(advancedCard);
    } else if(ui.page==='preset') {
        const bar=toolbar('preset');const chooser=el('div','preset-choice');chooser.append(el('span','muted','选择预设'),select('选择预设',state.presets.map(id=>({id,name:id})),selection.presetId||state.preset?.id,id=>act('selection.update',{presetId:id,promptOverrides:{},groupOverrides:{}})));bar.append(chooser);root.append(bar,saveHint('preset'));
        for(const item of state.preset?.display||[]){if(item.type==='prompt'){const entry=item.entry;root.append(row(entry.name||entry.identifier,entry.content,entry.enabled,v=>change('promptOverrides',entry.identifier,v)));continue;}const group=item.group;const content=el('div','section-body');const groupToggle=toggleSwitch('启用 '+group.name,group.enabled,value=>change('groupOverrides',group.id,value));for(const entry of group.entries)content.append(row(entry.name||entry.identifier,entry.content,entry.enabled,v=>change('promptOverrides',entry.identifier,v)));const card=section(group.name,content,ui.collapsed?.[group.id]??group.collapsed);card.dataset.viewKey='preset:'+state.preset.id+':'+group.id;card.classList.add('switch-card');const summary=card.querySelector('summary');summary.replaceChildren(el('span','group-title',group.name),groupToggle);card.addEventListener('toggle',()=>{if(card.isConnected)(ui.collapsed??={})[group.id]=!card.open;});root.append(card);}
    } else {
        root.append(toolbar('world'),saveHint('world'));
        const bindings=[['全局世界书',state.bindings.global],['角色世界书',state.bindings.character],['用户角色世界书',state.bindings.persona],['聊天附加世界书',state.bindings.chat],['插件开启的世界书',selection.extraBooks]];
        for(const [label,names] of bindings){if(!names?.length&& !['全局世界书','角色世界书','聊天附加世界书','插件开启的世界书'].includes(label))continue;const content=el('div','section-body');
            if(!names?.length)content.append(el('p','hint','尚未挂载世界书'));
            for(const name of names||[]){const book=el('details','book');book.dataset.viewKey='book:'+label+':'+name;book.open=ui.openBooks?.[name]??false;book.addEventListener('toggle',()=>{if(book.isConnected)(ui.openBooks??={})[name]=book.open;});const heading=el('summary','book-heading');heading.append(el('span','',name),toggleSwitch(name,selection.bookOverrides[name]!==false,v=>change('bookOverrides',name,v)));book.append(heading);for(const [uid,entry] of Object.entries(state.books[name]?.entries||{})){const key=entryKey(name,entry.uid??uid);book.append(row(entry.comment||`条目 ${uid}`,entry.content,selection.entryOverrides[key]??(selection.compatibilityIds.includes('database')&&state.databaseMode!=='keywords'&&isDatabaseMemoEntry(entry)?true:!entry.disable),v=>change('entryOverrides',key,v)));}content.append(book);}
            root.append(section(label,content));}
        const add=button('添加世界书',()=>{
            const dialog=el('dialog','detail-dialog');dialog.append(el('h2','','添加世界书'));const search=el('input');search.placeholder='搜索世界书';search.setAttribute('aria-label','搜索世界书');const list=el('div','book-picker');
            const draw=()=>{list.replaceChildren();for(const name of state.bookNames.filter(n=>n.toLowerCase().includes(search.value.toLowerCase()))){const selected=selection.extraBooks.includes(name);list.append(check(name,selected,async v=>{await act('selection.update',{extraBooks:v?[...selection.extraBooks,name]:selection.extraBooks.filter(x=>x!==name)});dialog.close();}));}};
            search.addEventListener('input',draw);dialog.append(search,list,button('完成',()=>dialog.close()));document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());draw();dialog.showModal();
        });add.className='primary add-book';root.append(add);
    }
    if(state.error)root.append(el('p','error',state.error));
}
