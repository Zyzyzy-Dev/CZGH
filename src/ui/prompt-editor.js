/* 提示词草稿编辑：取消不写入，恢复默认需完成后保存，失败保留草稿。 */
import { el, button } from './components.js?v=0.5.7-dev.2';
export function editPrompt({title,value,defaultValue,description,save}) {
    const dialog=el('dialog','detail-dialog prompt-editor');
    dialog.setAttribute('aria-label',`编辑${title}`);
    const header=el('header');header.append(el('h2','',`编辑${title}`),button('关闭编辑',()=>dialog.close(),'×'));
    const input=el('textarea','prompt-text');input.value=value;input.setAttribute('aria-label','提示词内容');input.spellcheck=false;input.maxLength=60000;
    const error=el('p','error');error.setAttribute('role','alert');
    const actions=el('div','dialog-actions prompt-actions');
    const reset=button('恢复默认',()=>{input.value=defaultValue;error.textContent='';input.focus();});
    const cancel=button('取消',()=>dialog.close());
    const done=button('完成',async()=>{
        done.disabled=true;reset.disabled=true;cancel.disabled=true;input.disabled=true;
        try {const result=await save(input.value);if(!result)throw Error('未能保存，请重试。');dialog.close();}
        catch(e){error.textContent=e.message;}
        finally{done.disabled=false;reset.disabled=false;cancel.disabled=false;input.disabled=false;}
    });done.classList.add('primary');
    actions.append(reset,cancel,done);
    dialog.append(header,el('p','hint',description),input,error,actions);
    dialog.addEventListener('cancel',event=>{if(done.disabled)event.preventDefault();});
    header.querySelector('button').addEventListener('click',event=>{if(done.disabled)event.stopImmediatePropagation();},true);
    dialog.addEventListener('close',()=>dialog.remove());
    document.body.append(dialog);dialog.showModal();input.focus();
}
