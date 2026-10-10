/* 附加参数编辑器：修改草稿，随 API 方案新建或覆盖保存。 */
import {el,button} from './components.js?v=0.5.0';
export function editAdditional(value,onSave){
 const dialog=el('dialog','detail-dialog prompt-editor');dialog.setAttribute('aria-label','附加参数');dialog.append(el('h2','','附加参数'));
 const fields={};
 for(const [key,label,hint] of [['custom_include_body','包括主体参数','top_k: 20'],['custom_exclude_body','排除主体参数','- frequency_penalty'],['custom_include_headers','包含请求标头','X-Custom-Header: value']]){
  const wrap=el('label','additional-field');wrap.append(el('span','',label));const input=el('textarea');input.value=value?.[key]||'';input.placeholder=hint;input.rows=4;input.maxLength=60000;input.setAttribute('aria-label',label);wrap.append(input);dialog.append(wrap);fields[key]=input;
 }
 dialog.append(el('p','hint','使用 YAML 格式。完成后请新建或覆盖 API 方案保存。'));
 const actions=el('div','dialog-actions');actions.append(button('取消',()=>dialog.close()),button('完成',()=>{onSave(Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value])));dialog.close();}));dialog.append(actions);
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
