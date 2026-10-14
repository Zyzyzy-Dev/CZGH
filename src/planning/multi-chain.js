/* Opt-in recognition and extraction of separate public planning blocks. */
const tagPattern = () => /<(\/?)([\p{L}_][\p{L}\p{N}_.:~\-]*)\s*>/gu;
const planningName = /think|thought|reason|analysis|planning|abstract|cot|(?:^|[_:-])plan(?:$|[_:-])|思维链|思考|规划|推演|写作准备|创作准备/i;
const cue = /思维链|写作准备|创作准备|规划|思考|推演|reasoning|planning|thinking/i;
const directive = /标签|包裹|放在|输出|关闭|格式|使用|tag|wrap|output|close|use/i;
const excluded = /^(?:content|body|正文|status.*|状态.*|bbs_.*|details|summary|div|span|p|script|style|system|user|assistant|Interleaving)$|format|template|guide|instruction|schema|格式|模板|规则|示例/i;
const negative = /(?:不要|不得|禁止|不使用|不再|而非|不是|错误示例|do not|don't|instead of)[^。；;\n]*$/i;
const legacy = /(?:旧版|旧标签|已废弃|已废止|legacy)[^。；;\n]*$/i;
const productContext = /(?:(?:思考|规划|推演|准备)(?:完成|结束|完毕)?(?:之?后|以后)|(?:完成|结束)(?:思考|规划|推演|准备)(?:之?后)|after\s+(?:thinking|planning)|(?:正文|成品|状态栏|选项|变量更新)[^。；;\n<>]{0,12}(?:使用|输出|采用|格式|标签))[^。；;\n]*$/i;

export function resolveMultiPlanningTags(messages) {
    const texts = messages.filter(m => ['system', 'developer'].includes(m.role) && typeof m.content === 'string').map(m => m.content);
    const closed = new Set(), obsolete = new Set(), candidates = new Map();
    for (const text of texts) for (const line of text.split(/\r?\n/)) {
        for (const token of line.matchAll(tagPattern())) {
            if (token[1]) closed.add(token[2]);
            if (legacy.test(line.slice(Math.max(0, token.index - 90), token.index))) obsolete.add(token[2]);
        }
    }
    for (const text of texts) {
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i], tokens = [...line.matchAll(tagPattern())];
            for (let j = 0; j < tokens.length; j++) {
                const token = tokens[j], name = token[2];
                if (excluded.test(name) || obsolete.has(name)) continue;
                const before = line.slice(Math.max(0, token.index - 90), token.index);
                if (negative.test(before) && !/(?:不得|不要|禁止)(?:省略|漏掉|跳过)[^。；;\n]*$/.test(before)) continue;
                if (!planningName.test(name) && productContext.test(before)) continue;
                const next = tokens[j + 1], after = line.slice(token.index + token[0].length, next?.index ?? token.index + token[0].length + 90);
                const explicit = cue.test(before) && directive.test(before);
                const enclosesCue = !token[1] && next?.[1] === '/' && next[2] === name && cue.test(after);
                const standalone = tokens.length === 1 && line.trim() === token[0] && cue.test(lines[i - 1] || '') && directive.test(lines[i - 1] || '');
                // Named thinking blocks are often introduced by bare opening tags,
                // with instructions on subsequent lines rather than before the tag.
                const namedPair = !token[1] && planningName.test(name) && closed.has(name);
                if (explicit || enclosesCue || standalone || namedPair) candidates.set(name, { openTag: `<${name}>`, closeTag: `</${name}>` });
            }
        }
    }
    const planningTags = [...candidates.values()];
    if (!planningTags.length) throw new Error('未能识别多思维链的规划标签，请检查已启用预设中的区块格式。');
    return { ...planningTags[0], planningTags };
}

export function extractMultiPlan(text, planningTags) {
    if (!Array.isArray(planningTags) || !planningTags.length) throw new Error('多思维链缺少已识别的规划标签。');
    const delimiters = new Map();
    for (const pair of planningTags) {
        if (!pair?.openTag || !pair.closeTag || pair.openTag === pair.closeTag) throw new Error('多思维链的规划标签无效。');
        for (const [tag, closing] of [[pair.openTag, false], [pair.closeTag, true]]) {
            if (delimiters.has(tag)) throw new Error('多思维链存在重复的规划标签。');
            delimiters.set(tag, { pair, closing });
        }
    }
    let boundaries = text;
    for (const tag of delimiters.keys()) {
        const quoted = '`' + tag + '`';
        boundaries = boundaries.split(quoted).join(' '.repeat(quoted.length));
    }
    const escaped = [...delimiters.keys()].sort((a, b) => b.length - a.length).map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(escaped.join('|'), 'g'), stack = [], blocks = [];
    for (const match of boundaries.matchAll(pattern)) {
        const { pair, closing } = delimiters.get(match[0]);
        if (!closing) {
            if (stack.some(item => item.pair.openTag === pair.openTag)) throw new Error('规划存在同名区块重复嵌套；本次不注入。');
            stack.push({ pair, start: match.index, contentStart: match.index + match[0].length });
        } else {
            const opening = stack.pop();
            if (!opening || opening.pair.closeTag !== match[0]) throw new Error('规划标签未正确配对；本次不注入。');
            if (!text.slice(opening.contentStart, match.index).trim()) throw new Error('规划包含空区块；本次不注入。');
            // A parent already includes its nested blocks. Never duplicate them.
            if (!stack.length) blocks.push(text.slice(opening.start, match.index + match[0].length));
        }
    }
    if (stack.length) throw new Error('规划存在未闭合区块；本次不注入。');
    if (!blocks.length) throw new Error('未找到完整的规划标签区块；本次不注入。');
    return blocks.join('\n\n');
}
