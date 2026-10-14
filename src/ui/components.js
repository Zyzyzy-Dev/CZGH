/* 界面基础控件：安全文本节点、图标按钮、字段、分组和本地对话框。 */
import { setIcon } from './icons.js?v=0.5.6';
export function el(tag, className = '', text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
export function button(label, action, icon) {
    const node = el('button', icon ? 'icon' : '', icon || label); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label); node.addEventListener('click', action); if(icon==='↥')setIcon(node,'edit');if(icon==='⌫'){setIcon(node,'trash');node.classList.add('danger-icon');}return node;
}
export function select(label, options, value, change) {
    const node = el('select'); node.setAttribute('aria-label', label);
    for (const option of options) { const item = el('option', '', option.name); item.value = option.id; node.append(item); }
    node.value = value; node.addEventListener('change', () => change(node.value)); return node;
}
export function field(label, value, change, type = 'text') {
    const wrap = el('label', 'field'), caption = el('span', '', label), node = el('input');
    node.type = type; node.value = value ?? ''; node.setAttribute('aria-label', label);
    node.autocomplete = type === 'password' ? 'new-password' : 'off';
    node.addEventListener('change', () => change(type === 'number' ? Number(node.value) : node.value)); wrap.append(caption, node); return wrap;
}
export function check(label, checked, change, partial = false) {
    const wrap = el('label', 'check'), node = el('input'); node.type = 'checkbox'; node.checked = !!checked; node.indeterminate = !!partial; node.setAttribute('aria-label', label);
    node.addEventListener('change', () => change(node.checked)); wrap.append(node, el('span', '', label)); return wrap;
}
export function toggleSwitch(label, checked, change, partial = false) {
    const node = el('button', 'toggle-switch');
    node.type = 'button';
    node.setAttribute('role', 'switch');
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-checked', String(!!checked));
    node.dataset.partial = String(partial);
    node.title = partial ? `${label}（部分开启）` : label;
    node.append(el('span', 'switch-track'));
    node.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); checked=!checked;node.setAttribute('aria-checked',String(checked));change(checked);
    });
    return node;
}
export function section(title, content, collapsed = false) {
    const wrap = el('details', 'card'); wrap.dataset.viewKey=title; wrap.open = !collapsed; wrap.append(el('summary', '', title), content); return wrap;
}
export function detail(title, content) {
    const dialog = el('dialog', 'detail-dialog'), header = el('header'); header.append(el('h2','',title),button('关闭详情',()=>dialog.close(),'×'));
    dialog.append(header,el('pre','entry-content',content || '此条目没有文本内容。')); document.body.append(dialog); dialog.addEventListener('close',()=>dialog.remove()); dialog.showModal();
}
export async function ask(title, initial, destructive = false, confirmLabel = '') {
    return new Promise(resolve => {
        const dialog=el('dialog','confirm-dialog'), heading=el('h2','',title), actions=el('div','dialog-actions');
        const input=el('input');input.value=initial || '';input.setAttribute('aria-label','方案名称');input.maxLength=100;
        let value=null;
        actions.append(button('取消',()=>dialog.close()),button(confirmLabel||(destructive?'删除':'保存'),()=>{if(!destructive&&!input.value.trim())return;value=destructive?true:input.value.trim();dialog.close();}));
        dialog.append(heading);if(!destructive)dialog.append(input);dialog.append(actions);document.body.append(dialog);
        dialog.addEventListener('close',()=>{dialog.remove();resolve(value);});dialog.showModal();if(!destructive)input.focus();
    });
}
