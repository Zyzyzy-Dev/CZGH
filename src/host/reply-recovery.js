/* 已完成规划随用户楼层保存；只有插件按钮发起的本轮请求可复用。 */
import { createId } from '../bridge/id.js?v=0.5.7';
import { fingerprint } from './message-plans.js?v=0.5.7';
import { chatPrefix, completeToolSpan, isToolCall, isToolResult } from '../planning/tool-history.js?v=0.5.7';

const KEY = 'czghCreativePlanningDraft';
// This is an edit detector, not an authentication or security boundary.
const signature = messages => fingerprint(chatPrefix(messages.map(m => ({...m,
    content: [m.content ?? null, m.swipes?.[m.swipe_id ?? 0] ?? null],
}))));

export function createReplyRecovery(host) {
    let armed = null, launching = false, active = null;
    const recent = new Map();
    const latestUser = () => host.messages().findLastIndex(m => m.is_user);
    const entry = () => host.messages()[latestUser()]?.extra?.[KEY];
    const matches = record => record?.chatId === host.identity() && record.version === 1
        && Number.isInteger(record.expectedMessageId) && record.expectedMessageId > 0
        && latestUser() < record.expectedMessageId
        && host.messages().length >= record.expectedMessageId
        && signature(host.messages().slice(0,record.expectedMessageId)) === record.sourceSignature;
    const tailMatches = record => {
        const current=signature(host.messages().slice(record.expectedMessageId));
        return current===record.tailSignature || current===record.rollbackSignature;
    };
    const valid = () => {const record=entry();return matches(record)&&tailMatches(record) ? record : null;};
    const changed = () => host.changed?.();
    const save = async identity => {
        // Native saves may queue before reading the current chat. Keep a small
        // session fallback too, so a quick switch cannot lose the completed plan.
        if(identity!==host.identity())return;
        await host.save();
        if(identity===host.identity())changed();
    };
    const tailAllowed = record => {
        const tail=host.messages().slice(record.expectedMessageId);
        if(!tail.length)return true;
        const last=tail.at(-1);
        const prose=last&&!last.is_user&&!last.is_system&&!isToolCall(last)&&!isToolResult(last);
        return (tail.length===1&&prose) || (host.tauriTavern?.() &&
            (completeToolSpan(tail) || (prose&&completeToolSpan(tail.slice(0,-1)))));
    };
    return {
        available: () => !launching && !!valid(),
        view() {
            const record=entry();if(!record||record.chatId!==host.identity())return null;
            const {text,openTag,closeTag,multiChain,createdAt,requestId,expectedMessageId,chatId}=record;
            return {text,openTag,closeTag,multiChain,createdAt,requestId,expectedMessageId,chatId,
                phase:'ready',stale:!valid(),canResume:!launching&&!host.busy()&&!!valid()};
        },
        async completed(record, message) {
            if(record.chatId!==host.identity())return;
            const anchor=latestUser();if(anchor<0||anchor>=record.expectedMessageId)return;
            const saved={...structuredClone(record),planId:record.requestId,writerMessage:structuredClone(message),
                sourceSignature:signature(host.messages().slice(0,record.expectedMessageId)),
                tailSignature:signature(host.messages().slice(record.expectedMessageId))};
            host.messages()[anchor].extra??={};
            host.messages()[anchor].extra[KEY]=saved;
            recent.set(saved.chatId,saved);
            if(recent.size>20)recent.delete(recent.keys().next().value);
            changed();await save(record.chatId);
        },
        async fresh() {
            active=null;
            recent.delete(host.identity());
            const user=host.messages()[latestUser()];if(!user?.extra?.[KEY])return;
            delete user.extra[KEY];changed();await save(host.identity());
        },
        async bound(record) {
            const saved=entry();
            if(saved&&saved.chatId===record.chatId&&saved.planId===(record.planId||record.requestId)) {
                delete host.messages()[latestUser()].extra[KEY];
                recent.delete(record.chatId);
                await save(record.chatId);
            }
        },
        active(record) {active={chatId:record.chatId,planId:record.planId||record.requestId,generationType:record.generationType};},
        async settled() {
            const record=entry(),attempt=active;active=null;
            if(!attempt||attempt.chatId!==host.identity()||record?.planId!==attempt.planId||!matches(record)||!tailAllowed(record))return;
            const tail=host.messages().slice(record.expectedMessageId),last=tail.at(-1);
            record.tailSignature=signature(tail);
            delete record.rollbackSignature;
            if(attempt.generationType==='swipe'&&last?.swipes?.length&&last.swipe_id>=last.swipes.length){
                const target=last.swipes.length-1;
                record.rollbackSignature=signature([...tail.slice(0,-1),{...last,swipe_id:target,mes:last.swipes[target]}]);
            }
            await save(record.chatId);
        },
        started(type, options, dryRun) {
            if(!armed)return;
            if(dryRun||['quiet','impersonate'].includes(type))return;
            if(type!==armed.type||armed.record.chatId!==host.identity())armed=null;
        },
        consume(data) {
            if(!armed)return false;
            if(!['normal','regenerate','swipe',undefined].includes(data.type))return false;
            const attempt=armed;armed=null;
            if(data.type!==attempt.type||!matches(attempt.record)||!Array.isArray(data.messages)) {
                host.stop();host.status('聊天内容已变化，未复用旧规划；请重新生成规划。');return true;
            }
            // Regenerate removes its failed reply before SETTINGS_READY. Swipe keeps its floor.
            const remaining=host.messages().slice(attempt.record.expectedMessageId);
            const swipeUnchanged=()=>{
                const last=remaining.at(-1),previous=attempt.tail.at(-1);
                if(!last||last.swipe_id!==attempt.swipeTarget)return false;
                const expectedSwipes=previous.swipes || [previous.mes];
                if(JSON.stringify(last.swipes)!==JSON.stringify(expectedSwipes))return false;
                const normalized=[...remaining.slice(0,-1),{...last,swipe_id:previous.swipe_id,swipes:previous.swipes}];
                return signature(normalized)===attempt.record.tailSignature;
            };
            if((attempt.type==='regenerate'&&remaining.length)||
                (attempt.type==='swipe'&&!swipeUnchanged())||
                (attempt.type==='normal'&&!tailMatches(attempt.record))) {
                host.stop();host.status('正文目标已变化，未复用旧规划；请重新生成规划。');return true;
            }
            const record={...attempt.record,requestId:createId(),generationType:attempt.type,
                expectedMessageId:host.messages().length-(attempt.type==='swipe'?1:0)};
            delete record.sourceSignature;delete record.tailSignature;delete record.rollbackSignature;delete record.writerMessage;
            data.messages=[...data.messages,structuredClone(attempt.record.writerMessage)];
            this.active(record);host.ready(record,attempt.record.writerMessage);
            host.status('已复用完成的规划，正在生成正文。');changed();return true;
        },
        async resume() {
            const record=valid();
            if(launching||host.busy())return false;
            if(!record){host.status('聊天内容已变化或没有可复用的完整规划，请重新生成规划。');changed();return false;}
            if(typeof host.generate!=='function'){host.status('当前酒馆未提供正文生成接口。');changed();return false;}
            // Preserve existing swipe alternatives; ordinary failures replace only the last failed reply.
            const tail=host.messages().slice(record.expectedMessageId),tools=tail.some(m=>isToolCall(m)||isToolResult(m));
            if(!tailAllowed(record)){host.status('聊天内容或工具记录不完整，请重新生成规划。');changed();return false;}
            const type=tools&&completeToolSpan(tail)?'normal':tail.length&&(tools||record.generationType==='swipe'||tail.at(-1)?.swipes?.length>1)?'swipe':'regenerate';
            if(type==='swipe'&&typeof host.swipe!=='function'){host.status('当前酒馆未提供备选回复生成接口，请使用酒馆重新生成。');changed();return false;}
            const swipeTarget=tail.at(-1)?.swipes?.length??1;
            const attempt={record:{...structuredClone(record),tailSignature:signature(tail)},type,tail:structuredClone(tail),swipeTarget};
            launching=attempt;armed=attempt;changed();
            try {
                if(type==='swipe')await host.swipe(host.messages().length-1,swipeTarget);
                else await host.generate(type,{automatic_trigger:true,...(type==='normal'?{depth:1}:{})});
                if(armed===attempt&&launching===attempt){host.status('酒馆未开始正文生成，请检查正文连接或备选回复设置后重试。');return false;}
                return true;
            }
            catch {if(launching===attempt&&record.chatId===host.identity())host.status('正文生成未完成，已保留规划，可再次点击“生成正文回复”。');return false;}
            finally {if(launching===attempt){armed=null;launching=false;if(record.chatId===host.identity()){host.finished?.();await this.settled();changed();}}}
        },
        switched(){
            armed=null;active=null;launching=false;
            const record=recent.get(host.identity());
            if(!entry()&&matches(record)) {
                const user=host.messages()[latestUser()];user.extra??={};user.extra[KEY]=structuredClone(record);
            }
            changed();
        },
    };
}
