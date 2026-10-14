/* 私有宏解析：局部变量不写回酒馆；未授权资料宏不展开；未知语义阻断生成。 */
const safeKey = key => key && !['__proto__', 'constructor', 'prototype'].includes(key);
const print = value => value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
export function expandMacros(text, { snapshot, compatibilityIds = [], variables = { local: {}, global: {} }, serializeYaml }) {
    const state = structuredClone(variables), diagnostics = [];
    state.local ??= {}; state.global ??= {};
    const env = snapshot.macroEnvironment || {};
    const issue = (code, message, blocking = false) => diagnostics.push({ code, message, blocking });
    const pathValue = (value, path) => {
        for (const key of path.replace(/\[(?:["']([^"']+)["']|(\d+))\]/g, (_, quoted, index) => '.' + (quoted ?? index)).split('.')) {
            if (!safeKey(key)) return undefined;
            value = value != null && Object.hasOwn(Object(value), key) ? value[key] : undefined;
        }
        return value;
    };
    const replace = token => {
        const [raw, ...args] = token.split('::'); const name = raw.trim().toLowerCase();
        if (name.startsWith('//')) return '';
        if (name === 'trim') return '';
        if (name === 'newline') return '\n';
        if (name === 'noop') return '';
        const helper = /^(get|format)_(message|chat|character|preset|global)_variable$/.exec(name);
        if (helper) {
            if (!Object.hasOwn(snapshot.helperVariables || {}, helper[2])) { issue('helper-unavailable', `无法读取酒馆助手 ${helper[2]} 变量，请检查酒馆助手是否已加载。`, true); return ''; }
            const strip = value => Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$') && safeKey(key)).map(([key, child]) => [key, strip(child)])) : value;
            const value = strip(pathValue(snapshot.helperVariables[helper[2]], args.join('::')) ?? null);
            if (helper[1] === 'get' || typeof value === 'string') return typeof value === 'string' ? value : JSON.stringify(value);
            const yaml = serializeYaml?.(value);
            if (typeof yaml !== 'string') { issue('yaml-unavailable', '格式化变量宏需要 YAML 序列化接口。', true); return ''; }
            return yaml.trimEnd();
        }
        if (Object.hasOwn(env, name) && typeof env[name] !== 'object') return print(env[name]);
        if (/^(?:set|get|add|inc|dec)(?:global)?var$/.test(name)) {
            const map = name.includes('global') ? state.global : state.local;
            const key = args[0];
            if (!safeKey(key)) { issue('unsafe-variable', '变量名无效。', true); return ''; }
            if (name.startsWith('get')) return print(map[key]);
            if (name.startsWith('set')) map[key] = args.slice(1).join('::');
            else if (name.startsWith('add')) map[key] = Number.isFinite(Number(map[key] || 0)) && Number.isFinite(Number(args[1])) ? Number(map[key] || 0) + Number(args[1]) : print(map[key]) + (args[1] || '');
            else map[key] = Number(map[key] || 0) + (name.startsWith('inc') ? 1 : -1);
            return '';
        }
        if (name.startsWith('bbs')) {
            if (!compatibilityIds.includes('baibai')) { issue('excluded-macro', '柏宝书未勾选，相关宏已排除。'); return ''; }
            const cached = env.pluginMacros?.[token];
            if (cached !== undefined) return print(cached);
            const bbs = env.bbs;
            if (bbs && args.length === 0 && name === 'bbsvars') return print(bbs.vars);
            if (bbs && args.length === 0 && name === 'bbsstate') return print(bbs.state);
            if (bbs && args.length === 0 && name === 'bbssnapshot') return print(bbs);
            if (bbs && args.length === 1 && name === 'bbsvar') return print(pathValue(bbs.vars, args[0]));
            issue('macro-dependency', `无法读取柏宝书宏 ${raw} 所需的快照。`, true); return '';
        }
        issue('literal-placeholder', `未识别的双花括号内容 ${raw} 已原样保留。`);
        return `{{${token}}}`;
    };
    let evaluations = 0;
    function parse(input, depth = 0) {
        if (depth > 40 || evaluations > 10000) { issue('macro-limit', '宏嵌套或展开次数超过限制。', true); return ''; }
        let result = '', cursor = 0;
        while (cursor < input.length) {
            const start = input.indexOf('{{', cursor);
            if (start < 0) { result += input.slice(cursor); break; }
            result += input.slice(cursor, start);
            let nesting = 1, end = start + 2;
            for (; end < input.length; end++) {
                if (input.startsWith('{{', end)) { nesting++; end++; }
                else if (input.startsWith('}}', end)) { if (--nesting === 0) break; end++; }
            }
            if (nesting) {
                // The unmatched opener may be literal example text. Preserve the
                // whole remaining span; don't guess boundaries or execute its children.
                issue('literal-placeholder', '未闭合的双花括号内容已原样保留。');
                return result + input.slice(start);
            }
            const token = parse(input.slice(start + 2, end), depth + 1);
            evaluations++;
            let replacement = replace(token);
            if (/^format_(message|chat|character|preset|global)_variable::/i.test(token)) {
                const prefix = result.slice(result.lastIndexOf('\n') + 1);
                replacement = replacement.replaceAll('\n', '\n' + ' '.repeat(prefix.length));
            }
            result += replacement;
            cursor = end + 2;
        }
        return result;
    }
    const output = parse(String(text ?? ''));
    return { text: output, variables: state, diagnostics };
}
