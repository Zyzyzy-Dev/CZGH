# 测试

本目录仅用于开发验证，不会通过插件入口加载。

- `npm test`：Node 无网络单元及规划控制器测试。
- `npm run check`：JS 语法检查。
- `node tests/browser-check.mjs`：本地浏览器回归测试。需可用的 Playwright 与浏览器；可通过 `PLAYWRIGHT_MODULE_PATH` 指定已有 Playwright 模块路径，通过 `BROWSER_EXECUTABLE` 指定已有浏览器。可选 `SCREENSHOT_DIR` 保存桌面与窄屏截图。

浏览器测试启动临时本地 HTTP 服务与独立浏览器会话，使用模拟酒馆上下文和虚构 API 方案，不连接真实 API、不使用日常浏览器配置。

多思维链验证涵盖：默认关闭与手动标签设置保留、多区块识别和顺序提取、条件性区块缺席、嵌套去重、残缺拒绝、正文成品排除，以及保存后切聊天恢复和正文重试。用户提供的完整预设仅在本地离线核对，不作为仓库测试数据发布。
