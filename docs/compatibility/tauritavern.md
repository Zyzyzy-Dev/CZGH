# TauriTavern 兼容核查

核查日期：2026-10-13。插件测试版：0.5.5-dev.2。

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

## 确认还需适配

### 优先：插件手填 Key 的独立方案

插件目前用本地凭据库存 Key，通过 custom_include_headers 发送认证，并用 `czgh-local:<id>` 阻止宿主回退到当前密钥。TT 的 config.rs 即使存在 Authorization 附加头，也会严格读取显式 secret_id；本地编号并不存在于 TT 的密钥库中，因此请求可能直接报 Secret id not found。

上游测试 `custom_additional_authorization_does_not_hide_missing_secret_id` 明确验证这一行为。复制 TT 已保存连接并沿用真实密钥编号的方案不属于此问题。后续修复必须保证规划不会误用当前活动密钥，也不能把临时认证内容写入普通配置、日志或正文。本次未修改认证传输，不以移除 secret_id 作为修复。

依据：[TT 认证配置及对应测试](https://github.com/Darkatse/TauriTavern/blob/f6126b4fc9243eb3990f2c0bad86e2afcb502f22/src-tauri/crates/tt-application/src/services/chat_completion_service/config.rs)。插件对应 profiles.js 的 profileRequest/authorizeLocalRequest。

### 工具历史与连续工具调用

TT 把工具调用 assistant 和 role=tool 结果保存在真实 chat 楼层中，最终可见回答可能位于若干工具楼层之后。插件 eligibleRequest 当前只要看到请求历史里有 tool/tool_calls 就跳过，无法区分旧历史和正在续跑的工具调用，所以后续普通轮次也可能不规划。来源采集还会过滤 is_system，不能直接当作完整工具历史投影。

同时 generation-binding 使用预期的下一楼层编号，并在新一轮 started 时清理暂存；连续工具调用会改变楼层数量和事件顺序。需要一起处理：旧工具历史的只读转换、当轮续跑不重复规划、最终正文归属、停止与重生成。仅放宽 eligibleRequest 或接受任意后续楼层会引入重复规划或错误绑定。本次保留现有保护，不声称此路径已兼容。

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

- 单元测试覆盖复制格式的请求构建、未知/被覆盖格式、Claude 中文分块、thinking 隔离、结束后连接不关闭、截断、异常结束和提前中断。
- Edge 模拟浏览器覆盖从当前 TT 连接复制并编辑方案，实际发出的格式、模型、密钥编号，以及 Claude SSE 完成后注入规划；宿主模型设置不变。
- 保留并运行原有预设、世界书、手动续正文、流式取消、界面隔离与窄屏回归。模拟服务只验证前端契约，不模拟真实 TT 的认证库，不能用其通过证明手填 Key 已适配。
