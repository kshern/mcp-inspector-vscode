// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as childProcess from "child_process";
import * as net from "net";
let outputChannel: vscode.OutputChannel;

// 获取webview内容
function getWebviewContent(
  webview: vscode.Webview,
  extensionPath: string,
  htmlFileName: string,
  proxyPort: number
) {
  const htmlPath = path.join(extensionPath, "webview-ui", "client", "dist", htmlFileName);
  let html = fs.readFileSync(htmlPath, "utf-8");

  // 获取正确的资源路径
  const scriptPathOnDisk = path.join(extensionPath, "webview-ui", "client", "dist");
  html = html.replace(/(href|src)="\/([^"]*)"/g, (match, p1, p2) => {
    // 处理相对路径
    const uri = vscode.Uri.file(path.join(scriptPathOnDisk, p2));
    return `${p1}="${webview.asWebviewUri(uri)}"`;
  });

  // 添加端口信息作为查询参数
  html = html.replace('<body>', `<body>
  <script>
    // 添加端口信息到URL查询参数
    const url = new URL(window.location.href);
    url.searchParams.set('proxyPort', '${proxyPort}');
    window.history.replaceState({}, '', url);
  </script>`);

  return html;
}

// 服务器管理类
class ServerManager {
  private static instance: ServerManager;
  private serverProcess: childProcess.ChildProcess | undefined;
  private outputChannel: vscode.OutputChannel;
  private isServerRunning: boolean = false;
  private port: number = 3000;

  private constructor() {
    // 创建输出通道
    this.outputChannel = vscode.window.createOutputChannel("MCP Inspector Server");
  }

  // 获取单例实例
  public static getInstance(): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager();
    }
    return ServerManager.instance;
  }

  // 查找可用端口
  private async findAvailablePort(startPort: number = 3000, endPort: number = 3999): Promise<number> {
    // 检查端口是否可用
    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => {
          resolve(false);
        });
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port);
      });
    };

    // 从起始端口开始检查
    for (let port = startPort; port <= endPort; port++) {
      if (await isPortAvailable(port)) {
        return port;
      }
    }

    // 如果没有可用端口，返回默认端口
    this.outputChannel.appendLine("警告：未找到可用端口，使用默认端口");
    return startPort;
  }

  // 启动服务器
  public async startServer(extensionPath: string): Promise<boolean> {
    if (this.isServerRunning) {
      vscode.window.showInformationMessage("MCP Inspector 服务器已经在运行中");
      return true;
    }

    try {
      // 查找可用端口
      this.port = await this.findAvailablePort();
      this.outputChannel.appendLine(`使用端口: ${this.port}`);

      // 显示输出通道
      this.outputChannel.show(true);
      this.outputChannel.appendLine("正在启动 MCP Inspector 服务器...");

      // 检查服务器目录是否存在
      const serverDir = path.join(extensionPath, "webview-ui", "server");
      if (!fs.existsSync(serverDir)) {
        this.outputChannel.appendLine("错误：找不到服务器目录");
        vscode.window.showErrorMessage("找不到 MCP Inspector 服务器目录");
        return false;
      }

      // 检查服务器构建目录是否存在，如果不存在则构建
      const buildDir = path.join(serverDir, "build");
      if (!fs.existsSync(buildDir)) {
        this.outputChannel.appendLine("服务器尚未构建，正在构建...");
        await this.buildServer(serverDir);
      }

      // 启动服务器进程
      this.serverProcess = childProcess.spawn("node", ["build/index.js"], {
        cwd: serverDir,
        env: {
          ...process.env,
          PORT: this.port.toString()
        },
        shell: true
      });

      // 处理服务器输出
      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.outputChannel.append(output);
        
        // 检查服务器是否已启动
        if (output.includes("Proxy server listening on port")) {
          this.isServerRunning = true;
          vscode.window.showInformationMessage(`MCP Inspector 服务器已启动，端口：${this.port}`);
        }
      });

      // 处理服务器错误
      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      // 处理服务器退出
      this.serverProcess.on("exit", (code: number | null) => {
        this.isServerRunning = false;
        this.outputChannel.appendLine(`服务器已退出，退出码：${code}`);
        if (code !== 0) {
          vscode.window.showErrorMessage(`MCP Inspector 服务器异常退出，退出码：${code}`);
        }
      });

      // 等待服务器启动
      return new Promise<boolean>((resolve) => {
        // 设置超时
        const timeout = setTimeout(() => {
          if (!this.isServerRunning) {
            this.outputChannel.appendLine("服务器启动超时");
            vscode.window.showErrorMessage("MCP Inspector 服务器启动超时");
            resolve(false);
          }
        }, 10000);

        // 检查服务器是否已启动
        const checkInterval = setInterval(() => {
          if (this.isServerRunning) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 500);
      });
    } catch (error) {
      this.outputChannel.appendLine(`启动服务器时出错：${error}`);
      vscode.window.showErrorMessage(`启动 MCP Inspector 服务器时出错：${error}`);
      return false;
    }
  }

  // 构建服务器
  private async buildServer(serverDir: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const buildProcess = childProcess.spawn("npm", ["run", "build"], {
        cwd: serverDir,
        shell: true
      });

      buildProcess.stdout.on("data", (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      buildProcess.stderr.on("data", (data: Buffer) => {
        this.outputChannel.append(data.toString());
      });

      buildProcess.on("exit", (code: number | null) => {
        if (code === 0) {
          this.outputChannel.appendLine("服务器构建成功");
          resolve();
        } else {
          this.outputChannel.appendLine(`服务器构建失败，退出码：${code}`);
          reject(new Error(`构建失败，退出码：${code}`));
        }
      });
    });
  }

  // 停止服务器
  public stopServer(): void {
    if (!this.isServerRunning || !this.serverProcess) {
      vscode.window.showInformationMessage("MCP Inspector 服务器未在运行");
      return;
    }

    try {
      // 在 Windows 上使用 taskkill 确保子进程被终止
      if (process.platform === "win32" && this.serverProcess.pid) {
        // 使用同步方法确保在VSCode关闭前完成进程终止
        childProcess.execSync(`taskkill /pid ${this.serverProcess.pid} /T /F`, { 
          encoding: 'utf-8',
          windowsHide: true 
        });
      } else if (this.serverProcess.pid) {
        // 对于非Windows平台，发送SIGTERM信号
        this.serverProcess.kill("SIGTERM");
        // 如果进程没有在1秒内终止，发送SIGKILL信号
        setTimeout(() => {
          if (this.serverProcess && this.serverProcess.pid) {
            try {
              this.serverProcess.kill("SIGKILL");
            } catch (e) {
              // 忽略错误
            }
          }
        }, 1000);
      }

      this.isServerRunning = false;
      this.serverProcess = undefined;
      this.outputChannel.appendLine("服务器已停止");
      vscode.window.showInformationMessage("MCP Inspector 服务器已停止");
    } catch (error) {
      this.outputChannel.appendLine(`停止服务器时出错：${error}`);
      vscode.window.showErrorMessage(`停止 MCP Inspector 服务器时出错：${error}`);
      
      // 尝试使用备用方法终止进程
      if (this.serverProcess && this.serverProcess.pid) {
        try {
          if (process.platform === "win32") {
            // 尝试使用另一种方法终止进程
            childProcess.exec(`taskkill /pid ${this.serverProcess.pid} /T /F`);
          } else {
            this.serverProcess.kill("SIGKILL");
          }
        } catch (e) {
          this.outputChannel.appendLine(`备用方法终止进程失败：${e}`);
        }
      }
      
      this.isServerRunning = false;
      this.serverProcess = undefined;
    }
  }

  // 获取服务器状态
  public isRunning(): boolean {
    return this.isServerRunning;
  }

  // 获取服务器端口
  public getPort(): number {
    return this.port;
  }

  // 释放资源
  public dispose(): void {
    this.stopServer();
    this.outputChannel.dispose();
  }
}

// Inspector主面板类
class InspectorMainPanel {
  /**
   * 跟踪当前面板
   */
  public static currentPanel: InspectorMainPanel | undefined;

  private static readonly viewType = "mcpInspector";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionPath: string;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionPath: string) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // 如果已经有面板存在，则显示它
    if (InspectorMainPanel.currentPanel) {
      InspectorMainPanel.currentPanel._panel.reveal(column);
      return;
    }

    // 否则，创建一个新面板
    const panel = vscode.window.createWebviewPanel(
      InspectorMainPanel.viewType,
      "MCP Inspector",
      column || vscode.ViewColumn.One,
      {
        // 启用JavaScript
        enableScripts: true,
        // 限制可以加载的资源
        localResourceRoots: [vscode.Uri.file(path.join(extensionPath, "webview-ui", "client", "dist"))]
      }
    );

    InspectorMainPanel.currentPanel = new InspectorMainPanel(panel, extensionPath);
  }

  private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
    this._panel = panel;
    this._extensionPath = extensionPath;

    // 设置webview内容
    this._update();

    // 当面板被关闭时，清理资源
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // 当面板变为可见时更新内容
    this._panel.onDidChangeViewState(
      e => {
        if (this._panel.visible) {
          this._update();
        }
      },
      null,
      this._disposables
    );

    // 处理来自webview的消息
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.type) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this._disposables
    );
  }

  private _update() {
    const webview = this._panel.webview;
    const serverManager = ServerManager.getInstance();
    this._panel.webview.html = getWebviewContent(webview, this._extensionPath, "index.html", serverManager.getPort());
  }

  public dispose() {
    InspectorMainPanel.currentPanel = undefined;

    // 清理资源
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

// 自定义树视图提供者，用于实现点击Activity Bar图标直接打开webview面板
class EmptyTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  // 获取树项元素
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  // 获取子元素
  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    // 返回空数组，不显示任何树项
    return Promise.resolve([]);
  }
}

// 侧边栏管理器，用于监控和管理侧边栏的状态
class SidebarManager {
  private static instance: SidebarManager;
  private disposables: vscode.Disposable[] = [];
  private isOurViewActive: boolean = false;
  private extensionPath: string;

  private constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  // 获取单例实例
  public static getInstance(extensionPath: string): SidebarManager {
    if (!SidebarManager.instance) {
      SidebarManager.instance = new SidebarManager(extensionPath);
    }
    return SidebarManager.instance;
  }

  // 初始化侧边栏管理器
  public initialize(context: vscode.ExtensionContext): void {
    // 监听窗口状态变化
    this.disposables.push(
      vscode.window.onDidChangeWindowState(e => {
        // 当窗口获得焦点时，检查侧边栏状态
        if (e.focused) {
          this.checkSidebarState();
        }
      })
    );

    // 监听活动视图变化
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.checkSidebarState();
      })
    );

    // 注册命令以手动关闭侧边栏并打开webview
    this.disposables.push(
      vscode.commands.registerCommand("mcp-inspector.closeSidebarAndOpenWebview", () => {
        this.closeSidebarAndOpenWebview();
      })
    );

    // 将所有的disposables添加到context中
    context.subscriptions.push(...this.disposables);
  }

  // 设置我们的视图是否激活
  public setOurViewActive(active: boolean): void {
    this.isOurViewActive = active;
    if (active) {
      // 如果我们的视图被激活，则关闭侧边栏并打开webview
      this.closeSidebarAndOpenWebview();
    }
  }

  // 检查侧边栏状态
  private checkSidebarState(): void {
    // 使用setTimeout来确保在UI更新后执行
    setTimeout(() => {
      // 如果我们的视图不是当前激活的，则不做任何操作
      if (!this.isOurViewActive) {
        return;
      }

      // 关闭侧边栏并打开webview
      this.closeSidebarAndOpenWebview();
    }, 100);
  }

  // 关闭侧边栏并打开webview
  private closeSidebarAndOpenWebview(): void {
    // 打开webview面板
    InspectorMainPanel.createOrShow(this.extensionPath);
    
    // 尝试关闭侧边栏
    vscode.commands.executeCommand("workbench.action.closeSidebar");
  }

  // 释放资源
  public dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  // 创建服务器管理器实例
  const serverManager = ServerManager.getInstance();

  // 注册启动服务器命令
  context.subscriptions.push(
    vscode.commands.registerCommand("mcp-inspector.startServer", async () => {
      await serverManager.startServer(context.extensionUri.fsPath);
    })
  );

  // 注册停止服务器命令
  context.subscriptions.push(
    vscode.commands.registerCommand("mcp-inspector.stopServer", () => {
      serverManager.stopServer();
    })
  );

  // 注册打开主面板的命令
  context.subscriptions.push(
    vscode.commands.registerCommand("mcp-inspector.openWebview", async () => {
      // 如果服务器未运行，则启动服务器
      if (!serverManager.isRunning()) {
        const started = await serverManager.startServer(context.extensionUri.fsPath);
        if (!started) {
          vscode.window.showErrorMessage("无法启动 MCP Inspector 服务器，无法打开 webview");
          return;
        }
      }

      // 打开主面板（在编辑器区域）
      InspectorMainPanel.createOrShow(context.extensionUri.fsPath);
    })
  );

  // 初始化侧边栏管理器
  const sidebarManager = SidebarManager.getInstance(context.extensionUri.fsPath);
  sidebarManager.initialize(context);

  // 注册空树视图提供者
  const treeDataProvider = new EmptyTreeDataProvider();
  const treeView = vscode.window.createTreeView("mcp-inspector-view", {
    treeDataProvider: treeDataProvider,
    showCollapseAll: false
  });

  // 监听树视图的可见性变化
  context.subscriptions.push(
    treeView.onDidChangeVisibility(e => {
      if (e.visible) {
        // 当树视图变为可见时，通知侧边栏管理器
        sidebarManager.setOurViewActive(true);
      } else {
        sidebarManager.setOurViewActive(false);
      }
    })
  );

  context.subscriptions.push(treeView);

  // 当插件激活时，自动启动服务器
  serverManager.startServer(context.extensionUri.fsPath).then(started => {
    if (started) {
      vscode.window.showInformationMessage("MCP Inspector 服务器已自动启动");
    }
  });

  // 监听VSCode窗口关闭事件
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => {
      // 终端关闭时检查服务器状态
      if (serverManager.isRunning()) {
        serverManager.stopServer();
      }
    })
  );

  // 监听VSCode窗口状态变化事件
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((e) => {
      // 当窗口失去焦点时，记录状态但不停止服务器
      if (!e.focused) {
        console.log("VSCode窗口失去焦点");
      }
    })
  );

  // 添加额外的退出监听器
  process.on("exit", () => {
    // 进程退出时确保服务器停止
    if (serverManager.isRunning()) {
      serverManager.stopServer();
    }
  });

  // 添加SIGINT信号监听器（Ctrl+C）
  process.on("SIGINT", () => {
    // 收到中断信号时确保服务器停止
    if (serverManager.isRunning()) {
      serverManager.stopServer();
      process.exit(0);
    }
  });
}

// This method is called when your extension is deactivated
export function deactivate() {
  // 停止服务器
  ServerManager.getInstance().stopServer();
  
  // 释放侧边栏管理器资源
  SidebarManager.getInstance("").dispose();
}
