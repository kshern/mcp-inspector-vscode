# MCP Inspector VSCode 扩展

MCP Inspector 是一个专为 VSCode 设计的扩展工具，用于可视化测试和调试 MCP (Model Control Protocol) 服务器。这个扩展提供了友好的用户界面，帮助开发者更高效地测试、调试和监控 MCP 服务器的行为。

本扩展的 WebView UI 部分基于 [Model Context Protocol Inspector](https://github.com/modelcontextprotocol/inspector) 项目开发，该项目是 Model Context Protocol 的官方调试和测试工具。

## 功能特点

- **可视化界面**：通过直观的 WebView 界面展示 MCP 服务器的请求和响应
- **实时监控**：实时监控 MCP 服务器的活动和状态
- **请求测试**：提供界面用于构建和发送测试请求到 MCP 服务器
- **响应分析**：格式化展示响应数据，便于分析和调试
- **服务器管理**：内置服务器管理功能，可以直接从 VSCode 启动和停止 MCP 服务器
- **自动端口分配**：自动查找可用端口，避免端口冲突

![MCP Inspector 界面](resources/mcp.png)

## 安装要求

- Visual Studio Code 1.97.0 或更高版本
- Node.js 和 npm (用于运行内置服务器)

## 安装方法

1. 从 VSCode 扩展市场安装，或者
2. 下载 `.vsix` 文件并通过 VSCode 的 "从 VSIX 安装..." 选项安装，或者
3. 克隆仓库并手动构建：

```bash
git clone https://github.com/kshern/mcp-inspector-vsocde.git
cd mcp-inspector-vsocde
npm install
npm run package
```

## 使用方法

1. 在 VSCode 活动栏中点击 MCP Inspector 图标打开扩展
2. 点击 "启动 MCP Inspector 服务器" 命令启动服务器
3. 使用 WebView 界面构建和发送请求到 MCP 服务器
4. 分析响应结果和服务器行为
5. 完成后，可以点击 "停止 MCP Inspector 服务器" 命令停止服务器

### 可用命令

- `MCP Inspector: 打开 MCP Inspector` - 打开主界面
- `MCP Inspector: 启动 MCP Inspector 服务器` - 启动代理服务器
- `MCP Inspector: 停止 MCP Inspector 服务器` - 停止代理服务器
- `MCP Inspector: 清理 NPM 缓存和依赖` - 当安装出现问题时清理npm缓存和依赖

### 扩展设置

本扩展提供以下设置项：

- `mcp-inspector.serverPort`: MCP Inspector 服务器使用的端口号（默认：3000）。如果该端口不可用，将自动寻找其他可用端口。
- `mcp-inspector.autoStartServer`: 扩展激活时是否自动启动 MCP Inspector 服务器（默认：true）。
- `mcp-inspector.installDependencies`: 首次启动服务器时是否自动安装缺失的依赖项（默认：true）。
- `mcp-inspector.preInitializeOnActivation`: 插件激活时是否自动在后台安装依赖和构建服务器（默认：true）。这将加快首次启动服务器的速度。
- `mcp-inspector.serverStartTimeout`: 服务器启动超时时间（毫秒）（默认：30000）。

## 故障排除

如果您在启动服务器时遇到问题：

1. 尝试使用命令面板中的"清理 MCP Inspector npm 缓存和依赖"命令
2. 查看 MCP Inspector 输出通道获取详细的错误信息
3. 确保 Node.js 和 npm 已正确安装并可访问
4. 如果出现权限问题，尝试以管理员权限运行 VSCode

## 项目结构

```
mcp-inspector-vsocde/
├── src/                 # 扩展源代码
├── webview-ui/          # WebView UI 代码 (基于 github.com/modelcontextprotocol/inspector)
│   ├── client/          # 前端客户端代码
│   └── server/          # 代理服务器代码
├── resources/           # 资源文件
└── dist/                # 编译后的代码
```

## 技术实现

本扩展由两部分组成：

1. **VSCode 扩展部分**：负责在 VSCode 中创建 WebView、管理服务器进程以及处理用户界面交互
2. **WebView UI 部分**：基于 [Model Context Protocol Inspector](https://github.com/modelcontextprotocol/inspector) 项目，提供直观的用户界面用于测试和调试 MCP 服务器

通过将官方 MCP Inspector 工具集成到 VSCode 中，本扩展为开发者提供了更便捷的 MCP 服务器开发和测试体验。

## 开发指南

### 构建和调试

1. 克隆仓库
2. 安装依赖：`npm install`
3. 在 VSCode 中打开项目
4. 按 F5 启动调试会话

### 构建扩展

```bash
npm run package
```

这将在 `dist` 目录下生成编译后的代码。

## 贡献指南

欢迎贡献代码、报告问题或提出改进建议。请遵循以下步骤：

1. Fork 仓库
2. 创建功能分支：`git checkout -b feature/your-feature-name`
3. 提交更改：`git commit -m '添加某功能'`
4. 推送到分支：`git push origin feature/your-feature-name`
5. 提交 Pull Request

## 致谢

特别感谢 [Model Context Protocol](https://github.com/modelcontextprotocol) 团队开发的 [MCP Inspector](https://github.com/modelcontextprotocol/inspector) 项目，本扩展的 WebView UI 部分基于该项目实现。

## 已知问题

- 在某些环境下，服务器可能需要手动重启才能正常工作
- 暂不支持多个 MCP 服务器的同时调试

## 版本历史

### 0.0.1

- 初始版本发布
- 基本的 MCP 服务器测试功能
- WebView UI 界面
- 服务器启动和停止功能

## 许可证

[MIT](LICENSE)

---

**享受使用 MCP Inspector!**
