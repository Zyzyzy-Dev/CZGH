/* 生成事件关联：流式结束可能早于消息收到，按请求、聊天、楼号与生成类型绑定。 */
import { chatPrefix, completeToolSpan, isToolCall, isToolResult } from '../planning/tool-history.js?v=0.5.6-dev.1';
export function createGenerationBinding(host) {
    let staged, prefix, continuationMessage, candidate, continuing = false, ended = false;
    const discard=()=>{if(staged)host.discard(staged.requestId);staged=null;prefix=null;continuationMessage=null;candidate=null;continuing=false;ended=false;};
    const valid = () => staged && staged.chatId===host.identity() && !host.isAborted?.()
        && (!host.messages || chatPrefix(host.messages().slice(0,staged.expectedMessageId))===prefix);
    const toolSpan = end => host.tauriTavern?.() && host.messages && valid()
        && completeToolSpan(host.messages().slice(staged.expectedMessageId,end));
    return {
        stage(record,message){discard();staged=record;continuationMessage=message ? structuredClone(message) : null;prefix=host.messages ? chatPrefix(host.messages().slice(0,record.expectedMessageId)) : null;},
        started(type,options,dryRun){
            if(type==='normal'&&!dryRun&&continuationMessage&&toolSpan()){continuing=true;candidate=null;ended=false;}
            else discard();
        },
        continueRequest(data){
            if(!continuing)return false;
            continuing=false;
            if(data.type!=='normal'||!Array.isArray(data.messages)||!toolSpan()){discard();return false;}
            data.messages=[...data.messages,structuredClone(continuationMessage)];
            return true;
        },
        stopped:discard,
        async ended(){
            // A stopped tool chain has no final prose to bind. For normal streaming,
            // MESSAGE_RECEIVED follows GENERATION_ENDED, so retain a prose tail.
            const tail=host.messages?.().at(-1);
            if(staged&&host.tauriTavern?.()&&(!valid()||isToolCall(tail)||isToolResult(tail)))discard();
            ended=true;
            if(candidate){const [id,type]=candidate;candidate=null;await this.received(id,type);}
        },
        async received(id,type){
            if(!staged)return;
            if(!valid()){discard();return;}
            if(!['normal','regenerate','swipe',undefined].includes(type))return;
            // TT can emit visible intermediary text before attaching tool_calls.
            // Non-streaming final replies also emit before GENERATION_ENDED.
            if(host.tauriTavern?.()&&!ended){candidate=[id,type];return;}
            const message=host.messages?.()[id];
            if(host.messages&&(!message||message.is_user||message.is_system||isToolCall(message)||isToolResult(message)))return;
            if(id!==staged.expectedMessageId&&!(id===host.messages?.().length-1&&toolSpan(id)))return;
            const record=staged;staged=null;continuationMessage=null;prefix=null;continuing=false;
            await host.bind(record,id);
        },
    };
}
