/* iframe 通信协议：限定消息来源、允许的设置字段和五个主题变量。 */
import { defaults, promptDefaults } from '../planning/core.js?v=0.5.4-dev.1';
export const CHANNEL = 'creative-planning-v1';
export const THEME_KEYS = Object.freeze(['--SmartThemeBorderColor', '--SmartThemeBlurTintColor', '--SmartThemeBodyColor', '--mainFontFamily', '--monoFontFamily']);
export function themeSnapshot(style) {
    return Object.fromEntries(THEME_KEYS.map(key => [key, style.getPropertyValue(key).trim()]));
}
export function acceptsMessage(event, source, origin) {
    return Boolean(source && event.source === source && event.origin === origin && event.data?.channel === CHANNEL && typeof event.data.type === 'string');
}
export function cleanSettings(value) {
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries({...defaults,...promptDefaults}).filter(([key, initial]) =>
        typeof value[key] === typeof initial && (typeof initial !== 'number' || Number.isFinite(value[key]))
    ).map(([key]) => [key, value[key]]));
}
const METHODS = new Set(['state.read', 'settings.update', 'api.save', 'api.remove', 'api.models', 'scheme.loadCurrent', 'scheme.save', 'scheme.remove', 'selection.update', 'sources.refresh', 'planner.cancel', 'ui.close']);
export function validateRpc(data) {
    if (!data || typeof data.requestId !== 'string' || data.requestId.length > 100 || !METHODS.has(data.method)) throw new Error('无效的界面请求。');
    if (JSON.stringify(data.payload).length > 262144) throw new Error('界面请求过大。');
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('界面请求字段无效。');
            visit(child);
        }
    };
    visit(data.payload);
    return data;
}
