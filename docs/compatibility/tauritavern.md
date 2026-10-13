# TauriTavern 兼容核查

核查日期：2026-10-13。插件测试版：0.5.5-dev.3。

核查上游固定提交：[f6126b4](https://github.com/Darkatse/TauriTavern/tree/f6126b4fc9243eb3990f2c0bad86e2afcb502f22)。以下是该提交的源码结论，不代表所有 TT 分支、安装版本或设备已实测。没有调用真实模型 API，也没有运行完整 TT 应用。

## 本次已修复

### 保存 API 方案丢失接口格式

TT 的自定义连接可以选择 OpenAI 兼容、Responses、Claude Messages、Gemini Interactions、Gemini GenerateContent。插件原先只复制 URL、模型、附加参数和密钥引用，遗漏 `custom_api_format`，后续保存又重建 connection，使连接被当作默认 OpenAI 格式发送。

现在复制、保存、编辑和请求构建均保留该字段。旧版 ST 没有此字段时保持原行为。未知格式明确报错，附加参数不能覆盖已选择的格式。手动新填 URL 和 Key 仍按既有 OpenAI 兼容方案处理，没有新增协议选择界面。保存格式不等于 Gemini 原生流式已支持。

依据：[格式定义](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-application/src/services/chat_completion_service/custom_api_format.rs)、[自定义请求分发](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-application/src/services/chat_completion_service/payload/custom.rs)。

### Claude 原生流式事件

TT 的 Claude 流式路径会转发 Anthropic 事件；原来的插件只提取 OpenAI choices.delta.content。现在读取 text 类型内容块，忽略 thinking 等非成品文本，并在 message_stop 确认正常完成。仅收到 stop_reason、连接提前中断或 DONE 不能替代 message_stop。输出额度耗尽仍返回截断状态并由规划校验拒绝；工具调用、拒绝和其他异常结束不注入正文。

本次没有解除原生 provider 的现有来源限制；主要覆盖自定义 Claude Messages 连接。TT 的非流式 Claude 和 Responses 路径已有 OpenAI 风格规范化，不重复转换。

依据：[Claude 请求与流处理](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/claude.rs)、[Responses 转换](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-adapter-provider-http/src/http_chat_completion_repository/openai_responses.rs)、[前端 SSE 转发](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src/tauri/main/routes/ai-routes.js)。

## dev.3 补充适配

### 插件手填 Key 的独立方案

插件原先用本地凭据库存 Key，通过 custom_include_headers 发送认证，并用 `czgh-local:<id>` 阻止宿主回退到当前密钥。TT 的 config.rs 即使存在 Authorization 附加头，也会严格读取显式 secret_id；本地编号并不存在于 TT 的密钥库中，因此请求可能直接报 Secret id not found。

上游测试 `custom_additional_authorization_does_not_hide_missing_secret_id` 明确验证这一行为。dev.3 通过官方宿主标记 `window.__TAURITAVERN__` 识别 TT：本地 Key 请求将 URL 放进 reverse_proxy、Key 放进 proxy_password，custom_url 留空且移除本地 secret_id，使用 config.rs 明确支持的单次认证分支；此分支不查询活动密钥。不是添加第三方代理，目标地址仍是用户填写的地址。模型列表请求使用同样路径，各协议由 TT 选择认证头。其他 ST 环境保留原有路径；复制 TT 已有连接的真实 secretId 路径不变。

密钥仍只保存在原有本地凭据库，临时请求的认证字段不进入消息、普通设置或插件上下文预览。没有调用 TT 的密钥写入接口。TT 自身若禁用 endpoint_overrides（例如某些 iOS 构建策略），仍可能拒绝自定义地址/认证；本插件不绕过宿主策略。

依据：[TT 认证配置及对应测试](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-application/src/services/chat_completion_service/config.rs)。插件对应 profiles.js 的 profileRequest/authorizeLocalRequest。

### 工具历史与连续工具调用

TT 把工具调用 assistant 和 role=tool 结果保存在真实 chat 楼层中，最终可见回答可能位于若干工具楼层之后。插件原先只要看到请求历史里有 tool/tool_calls 就跳过。dev.3 区分历史与当轮：旧工具记录之后出现新用户输入时允许新规划，显式 regenerate/swipe 同样允许；当前工具续跑不再次生成规划。

历史调用的名称、参数和结果转为带说明的参考文本，不把工具定义、执行字段或内部推理发送给规划 API，也不修改原始聊天。来源中的系统工具结果被保留；一般系统楼层仍按原规则排除。

TT 续跑只在同一聊天、原消息内容未改变、新增楼层构成调用与结果逐一匹配的完整工具链时保留规划；每次递归请求追加原来的规划交接消息。任意普通楼层、新用户输入、缺失/重复结果、停止、显式重试或切换聊天不能借此继续旧绑定。最终正文可在工具楼层之后，但不能跳过无关楼层。

额外核对发现：有可见文字的工具中间回复也会发 MESSAGE_RECEIVED，且可能早于 tool_calls 字段保存。因此 TT 的绑定要等 GENERATION_ENDED 确认后再完成：兼容非流式“先收到消息、后结束”，以及流式“先结束、后收到消息”。没有给一般 ST 开启工具递归推断。

依据：[聊天载荷中的工具记录与事件契约](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/docs/CurrentState/ChatPayload.md)、[工具实现](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src/scripts/tool-calling.js)、[主生成流程](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src/script.js)。

## 尚不能宣称兼容的范围

- 原生 Agent 模式：dev.1 只是普通规划忽略三个 Agent 专用标记，没有接入 Agent 执行流程。当前未发现需要额外跳过的标准预设标记。
- 其他原生 provider/协议：插件跟随当前连接仍有来源白名单；Gemini 原生流、Bedrock 等需要逐条验证请求与响应，不能因为复制了格式就算兼容。
- 移动端键盘：TT 提供 layout-kit/IME 安全区域接口，插件目前使用自己的 dialog/dvh 布局。需要真实设备确认键盘遮挡及返回手势，桌面模拟窄屏不能证明这些行为。

## 本次未发现需要改动的基础接口

- 当前 chat[] 是完整历史，聊天裁剪是 DOM 层裁剪；不能根据较旧的 ExtensionDEV.md「仅最近 N 条」描述额外补读并重复拼接历史。以当前 ChatPayload、Chat API 文档及代码为准。冷 swipe 存储不等于删除当前 mes 或缩短完整楼层数组。
- getContext、普通生成事件、saveChat、聊天元数据和独立请求取消接口仍有对应路径；当前核查未发现需要另写原生桥接的证据。saveChat 走完整保存队列；不能拿只保存头部的元数据操作代替消息保存。
- Responses 流已转成 OpenAI choices 格式，原有解析可继续使用。
- 「规划最大输出已超过所选预设的上下文额度」来自插件预算校验；截图本身不足以认定 TT 实现错误。

依据：[当前聊天载荷](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/docs/CurrentState/ChatPayload.md)、[Chat API](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/docs/API/Chat.md)、[上下文接口](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src/scripts/st-context.js)、[扩展接口说明](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/ExtensionDEV.md)。

## 验证范围

- 单元测试覆盖复制格式、Claude 流式、TT 单次认证参数、多轮工具链匹配、停止/重试/切聊/消息修改失效、中间回复的事件顺序，以及历史工具文本投影。
- Edge 模拟浏览器覆盖复制并编辑方案、手填 Key 请求和模型列表、连续两轮工具只生成一次规划、最终正文持久化、下一轮用户输入仍能规划、历史结果进入上下文，以及密钥不进入消息/设置/预览。
- 保留原有预设、世界书、手动续正文、流式取消、界面隔离与窄屏回归。模拟服务与源码契约校验通过仍不等于完整 TT 应用和真实服务商认证实测通过。
