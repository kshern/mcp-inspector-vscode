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
): string {
  try {
    // 构建HTML文件路径
    const htmlPath = path.join(extensionPath, "webview-ui", "client", "dist", htmlFileName);
    
    // 检查文件是否存在
    if (!fs.existsSync(htmlPath)) {
      throw new Error(`找不到HTML文件：${htmlPath}`);
    }
    
    // 读取HTML文件内容
    let html = fs.readFileSync(htmlPath, "utf-8");
    
    // 获取正确的资源路径
    const scriptPathOnDisk = path.join(extensionPath, "webview-ui", "client", "dist");
    
    // 替换资源路径，处理相对路径引用
    html = html.replace(/(href|src)="\/([^"]*)"/g, (match, p1, p2) => {
      try {
        const fullPath = path.join(scriptPathOnDisk, p2);
        if (fs.existsSync(fullPath)) {
          const uri = vscode.Uri.file(fullPath);
          return `${p1}="${webview.asWebviewUri(uri)}"`;
        } else {
          console.warn(`找不到资源文件：${fullPath}`);
          return match; // 保持原始引用不变
        }
      } catch (err) {
        console.warn(`处理资源路径出错：${err}`);
        return match;
      }
    });
    
    // 替换资源引用中的相对路径（处理没有/开头的路径）
    html = html.replace(/(href|src)="(?!http|https|vscode-webview-resource|#)([^\/][^"]*)"/g, (match, p1, p2) => {
      try {
        const fullPath = path.join(scriptPathOnDisk, p2);
        if (fs.existsSync(fullPath)) {
          const uri = vscode.Uri.file(fullPath);
          return `${p1}="${webview.asWebviewUri(uri)}"`;
        } else {
          console.warn(`找不到资源文件：${fullPath}`);
          return match;
        }
      } catch (err) {
        console.warn(`处理资源路径出错：${err}`);
        return match;
      }
    });

    // 添加端口信息作为查询参数
    const bodyTagIndex = html.indexOf('<body>');
    if (bodyTagIndex !== -1) {
      html = html.slice(0, bodyTagIndex + 6) + `
  <script>
    // 添加端口信息到URL查询参数
    const url = new URL(window.location.href);
    url.searchParams.set('proxyPort', '${proxyPort}');
    window.history.replaceState({}, '', url);
  </script>` + html.slice(bodyTagIndex + 6);
    } else {
      // 如果找不到<body>标签，尝试在<head>标签后添加脚本
      const headEndIndex = html.indexOf('</head>');
      if (headEndIndex !== -1) {
        html = html.slice(0, headEndIndex) + `
  <script>
    // 添加端口信息到URL查询参数
    const url = new URL(window.location.href);
    url.searchParams.set('proxyPort', '${proxyPort}');
    window.history.replaceState({}, '', url);
  </script>` + html.slice(headEndIndex);
      }
    }

    return html;
  } catch (error) {
    // 生成错误页面
    return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>MCP Inspector 错误</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 0;
          padding: 20px;
          background-color: #f5f5f5;
          color: #333;
        }
        .error-container {
          max-width: 800px;
          margin: 40px auto;
          background-color: #fff;
          border-radius: 5px;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
          padding: 20px;
        }
        h1 {
          color: #d32f2f;
          margin-top: 0;
        }
        pre {
          background-color: #f8f8f8;
          padding: 15px;
          border-radius: 4px;
          overflow: auto;
          border: 1px solid #ddd;
        }
        .suggestion {
          margin-top: 20px;
          padding: 15px;
          background-color: #e8f5e9;
          border-radius: 4px;
          border-left: 4px solid #4caf50;
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>MCP Inspector 加载失败</h1>
        <p>加载 MCP Inspector 界面时出错。这可能是因为客户端文件未正确构建。</p>
        
        <h2>错误详情</h2>
        <pre>${error instanceof Error ? error.message : String(error)}</pre>
        
        <div class="suggestion">
          <h3>建议的解决方案：</h3>
          <ol>
            <li>确保已经运行过 <code>npm run build</code> 来构建客户端文件</li>
            <li>检查 <code>webview-ui/client/dist</code> 目录中是否存在 <code>index.html</code> 文件</li>
            <li>尝试重新启动 VSCode</li>
            <li>如果问题仍然存在，尝试重新安装扩展</li>
          </ol>
        </div>
      </div>
    </body>
    </html>
    `;
  }
}

// 服务器管理类
class ServerManager {
  private static instance: ServerManager;
  private serverProcess: childProcess.ChildProcess | undefined;
  private outputChannel: vscode.OutputChannel;
  private isServerRunning: boolean = false;
  private port: number = 3000;
  private dependenciesInstalled: boolean = false;

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
  private async findAvailablePort(startPort: number = 3000, endPort: number = 65535): Promise<number> {
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
    // 首先尝试使用配置中的端口（如果存在）
    const configPort = vscode.workspace.getConfiguration('mcp-inspector').get<number>('serverPort');
    if (configPort) {
      if (await isPortAvailable(configPort)) {
        return configPort;
      } else {
        this.outputChannel.appendLine(`配置的端口 ${configPort} 不可用，将寻找其他可用端口`);
      }
    }

    // 否则，寻找可用端口
    for (let port = startPort; port <= endPort; port++) {
      if (await isPortAvailable(port)) {
        return port;
      }
    }

    // 如果没有可用端口，返回默认端口
    this.outputChannel.appendLine("警告：未找到可用端口，使用默认端口");
    return startPort;
  }

  // 检查必要的依赖项是否安装
  private async checkDependencies(serverDir: string): Promise<boolean> {
    this.outputChannel.appendLine("检查必要的依赖项...");
    
    // 获取配置，决定是否自动安装依赖项
    const installDependencies = vscode.workspace.getConfiguration('mcp-inspector').get<boolean>('installDependencies', true);
    
    // 检查node_modules目录是否存在
    const nodeModulesPath = path.join(serverDir, "node_modules");
    if (!fs.existsSync(nodeModulesPath)) {
      this.outputChannel.appendLine("未找到node_modules目录，需要安装依赖项");
      if (installDependencies) {
        return await this.installDependencies(serverDir);
      } else {
        vscode.window.showErrorMessage("MCP Inspector 需要安装依赖项，但自动安装已禁用。请在设置中启用'mcp-inspector.installDependencies'或手动安装依赖项。");
        return false;
      }
    }
    
    // 检查关键依赖包是否存在
    const keyDependencies = ["@modelcontextprotocol/sdk", "express", "cors", "ws"];
    for (const dep of keyDependencies) {
      const depPath = path.join(nodeModulesPath, dep);
      if (!fs.existsSync(depPath)) {
        this.outputChannel.appendLine(`未找到关键依赖项：${dep}，需要安装依赖项`);
        if (installDependencies) {
          return await this.installDependencies(serverDir);
        } else {
          vscode.window.showErrorMessage(`MCP Inspector 缺少关键依赖项：${dep}，但自动安装已禁用。请在设置中启用'mcp-inspector.installDependencies'或手动安装依赖项。`);
          return false;
        }
      }
    }
    
    this.outputChannel.appendLine("所有必要的依赖项都已安装");
    return true;
  }

  // 检查并安装必要的依赖项
  private async installDependencies(serverDir: string): Promise<boolean> {
    this.outputChannel.appendLine("检查并安装必要的依赖项...");
    
    try {
      // 首先检查npm是否可用
      try {
        await this.runCommand("npm", ["--version"], serverDir);
      } catch (error) {
        this.outputChannel.appendLine(`错误：无法执行npm命令，请确保npm已正确安装：${error}`);
        vscode.window.showErrorMessage("无法执行npm命令，请确保Node.js和npm已正确安装");
        return false;
      }
      
      // 先清理可能存在的lock文件，避免锁定问题
      this.outputChannel.appendLine("清理可能的lock文件...");
      const packageLockPath = path.join(serverDir, "package-lock.json");
      if (fs.existsSync(packageLockPath)) {
        try {
          fs.unlinkSync(packageLockPath);
          this.outputChannel.appendLine("已删除package-lock.json文件");
        } catch (err) {
          this.outputChannel.appendLine(`警告：无法删除package-lock.json文件：${err}`);
        }
      }
      
      // 首先安装根目录依赖项
      const rootDir = path.join(serverDir, "..");
      this.outputChannel.appendLine("安装根目录依赖项...");
      
      // 使用--no-package-lock参数避免生成package-lock.json
      // 使用--no-fund参数避免显示资金信息
      // 使用--loglevel=error只显示错误信息
      await this.runCommand("npm", ["install", "--no-package-lock", "--no-fund", "--loglevel=error"], rootDir);
      
      // 安装服务器依赖项
      this.outputChannel.appendLine("安装服务器依赖项...");
      await this.runCommand("npm", ["install", "--no-package-lock", "--no-fund", "--loglevel=error"], serverDir);
      
      // 检查package.json中是否包含TypeScript相关依赖
      const packageJsonPath = path.join(serverDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        const packageContent = fs.readFileSync(packageJsonPath, 'utf8');
        const packageJson = JSON.parse(packageContent);
        const devDeps = packageJson.devDependencies || {};
        
        // 需要安装的开发依赖
        const missingDevDeps: string[] = [];
        const requiredDevDeps = ["typescript", "@types/node", "@types/express", "@types/cors", "@types/ws"];
        
        for (const dep of requiredDevDeps) {
          if (!devDeps[dep]) {
            missingDevDeps.push(dep);
          }
        }
        
        // 只有在缺少依赖时才安装
        if (missingDevDeps.length > 0) {
          this.outputChannel.appendLine(`安装缺少的TypeScript开发依赖：${missingDevDeps.join(", ")}...`);
          await this.runCommand("npm", ["install", ...missingDevDeps, "--save-dev", "--no-package-lock", "--no-fund", "--loglevel=error"], serverDir);
        } else {
          this.outputChannel.appendLine("所有TypeScript开发依赖已存在，跳过安装");
        }
      } else {
        this.outputChannel.appendLine("警告：找不到package.json文件，跳过TypeScript依赖安装");
      }
      
      this.outputChannel.appendLine("依赖项安装成功");
      this.dependenciesInstalled = true;
      return true;
    } catch (error) {
      this.outputChannel.appendLine(`依赖项安装失败：${error}`);
      // 提供更具体的错误信息和解决方案
      if (error instanceof Error && error.message.includes("Cannot read properties of null (reading 'location')")) {
        this.outputChannel.appendLine("这可能是由于npm缓存损坏或package-lock.json文件不一致导致的。");
        this.outputChannel.appendLine("推荐解决方法：");
        this.outputChannel.appendLine("1. 手动运行 'npm cache clean --force'");
        this.outputChannel.appendLine("2. 删除项目中的 'package-lock.json' 和 'node_modules' 目录");
        this.outputChannel.appendLine("3. 重新启动VSCode并尝试再次启动服务器");
        
        vscode.window.showErrorMessage("npm安装失败，可能是缓存问题。请尝试手动清理npm缓存，详见输出面板。");
      }
      return false;
    }
  }
  
  // 运行命令的辅助方法
  private async runCommand(command: string, args: string[], cwd: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 记录执行的命令
      this.outputChannel.appendLine(`执行命令: ${command} ${args.join(' ')}`);
      this.outputChannel.appendLine(`工作目录: ${cwd}`);
      
      // 在Windows系统上使用完整路径的npm
      let execCommand = command;
      if (process.platform === 'win32' && command === 'npm') {
        // 尝试直接使用npm.cmd而不是npm
        execCommand = 'npm.cmd';
      }
      
      // 设置更多环境变量以帮助npm运行
      const childProc = childProcess.spawn(execCommand, args, {
        cwd,
        env: {
          ...process.env,
          FORCE_COLOR: 'true',
          NODE_ENV: 'development',
          // 禁用npm更新检查，以减少可能的错误
          NPM_CONFIG_UPDATE_NOTIFIER: 'false',
          // 设置较短的npm超时时间
          NPM_CONFIG_FETCH_TIMEOUT: '60000',
          NPM_CONFIG_FETCH_RETRY_MINTIMEOUT: '10000',
          NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT: '60000'
        },
        shell: true
      });
      
      let stdoutData = '';
      let stderrData = '';

      childProc.stdout.on("data", (data: Buffer) => {
        const str = data.toString();
        stdoutData += str;
        this.outputChannel.append(str);
        
        // 检查常见错误模式
        if (str.includes("Error: Cannot find module")) {
          this.outputChannel.appendLine("检测到模块缺失错误，可能需要重新安装依赖");
        }
      });

      childProc.stderr.on("data", (data: Buffer) => {
        const str = data.toString();
        stderrData += str;
        this.outputChannel.append(str);
        
        // 分析常见错误模式
        if (str.includes("Cannot find module")) {
          // 模块缺失错误
          const moduleMatch = str.match(/Cannot find module '([^']+)'/);
          if (moduleMatch && moduleMatch[1]) {
            const missingModule = moduleMatch[1];
            this.outputChannel.appendLine(`检测到缺失模块: ${missingModule}`);
            this.outputChannel.appendLine(`尝试手动安装该模块可能解决问题: npm install ${missingModule}`);
          }
        } else if (str.includes("SyntaxError")) {
          // 语法错误
          this.outputChannel.appendLine("检测到JavaScript语法错误，服务器代码可能存在问题");
        } else if (str.includes("EADDRINUSE")) {
          // 端口被占用
          this.outputChannel.appendLine(`端口可能已被占用，请尝试使用其他端口或关闭占用端口的应用`);
          
          // 尝试寻找新端口并重启服务器
          vscode.window.showWarningMessage(
            `端口可能已被占用，是否尝试使用其他端口?`,
            "是", "否"
          ).then(choice => {
            if (choice === "是") {
              // 停止当前服务器
              this.stopServer();
              
              // 重新启动服务器（会自动寻找新端口）
              setTimeout(() => {
                // 直接提示用户重新启动
                vscode.commands.executeCommand("mcp-inspector.startServer");
              }, 1000);
            }
          });
        }
      });
      
      childProc.on("error", (err) => {
        this.outputChannel.appendLine(`命令执行错误：${err.message}`);
        reject(new Error(`命令执行错误：${err.message}`));
      });

      childProc.on("exit", (code: number | null) => {
        this.outputChannel.appendLine(`命令执行完成，退出码：${code}`);
        if (code === 0) {
          resolve();
        } else {
          // 提供更具体的错误信息
          const errorMessage = `命令执行失败，退出码：${code}`;
          if (stderrData) {
            this.outputChannel.appendLine(`错误输出：${stderrData}`);
          }
          reject(new Error(errorMessage));
        }
      });
    });
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

      // 检查必要的依赖项是否安装和服务器是否已构建
      // 如果在插件激活时已经完成了预初始化，则可以跳过这些步骤
      if (!this.dependenciesInstalled) {
        this.outputChannel.appendLine("依赖项尚未安装，正在检查...");
        const dependenciesInstalled = await this.checkDependencies(serverDir);
        if (!dependenciesInstalled) {
          this.outputChannel.appendLine("安装依赖项失败，无法启动服务器");
          vscode.window.showErrorMessage("安装 MCP Inspector 服务器依赖项失败");
          return false;
        }
      } else {
        this.outputChannel.appendLine("依赖项已在插件激活时安装，跳过检查");
      }

      // 检查 build/index.js 文件是否存在
      const indexJsPath = path.join(serverDir, "build", "index.js");
      if (!fs.existsSync(indexJsPath)) {
        this.outputChannel.appendLine("错误：找不到服务器入口文件 build/index.js");
        
        // 如果依赖已安装但构建文件不存在，可能是构建失败或未执行构建
        if (this.dependenciesInstalled) {
          this.outputChannel.appendLine("依赖已安装但构建文件不存在，尝试重新构建...");
        } else {
          this.outputChannel.appendLine("尝试构建服务器...");
        }
        
        try {
          // 尝试构建服务器
          await this.runCommand("npm", ["run", "build"], serverDir);
          
          // 再次检查入口文件
          if (!fs.existsSync(indexJsPath)) {
            this.outputChannel.appendLine("构建后仍找不到服务器入口文件");
            vscode.window.showErrorMessage("找不到 MCP Inspector 服务器入口文件");
            return false;
          }
          
          this.outputChannel.appendLine("服务器构建成功");
        } catch (error) {
          this.outputChannel.appendLine(`构建服务器时出错：${error}`);
          vscode.window.showErrorMessage("构建 MCP Inspector 服务器失败");
          return false;
        }
      } else {
        this.outputChannel.appendLine("服务器入口文件已存在，跳过构建步骤");
      }

      // 启动服务器进程
      this.outputChannel.appendLine("启动服务器进程...");
      
      // 在Windows系统上使用正确的Node路径
      const nodePath = process.platform === 'win32' ? 'node.exe' : 'node';
      
      try {
        // 检查index.js文件大小和内容
        const indexJsStats = fs.statSync(indexJsPath);
        this.outputChannel.appendLine(`服务器入口文件大小: ${indexJsStats.size} 字节`);
        
        if (indexJsStats.size < 100) {
          // 文件太小，可能有问题
          this.outputChannel.appendLine("警告: 服务器入口文件可能不完整，文件大小过小");
          
          // 尝试读取文件内容进行诊断
          const indexJsContent = fs.readFileSync(indexJsPath, 'utf8');
          this.outputChannel.appendLine(`文件内容预览: ${indexJsContent.substring(0, 200)}...`);
          
          if (!indexJsContent.includes("require(") && !indexJsContent.includes("import ")) {
            this.outputChannel.appendLine("错误: 入口文件不包含有效的JavaScript代码");
            vscode.window.showErrorMessage("MCP Inspector 服务器入口文件不完整，请尝试重新构建");
            return false;
          }
        }
        
        // 设置更多环境变量以帮助服务器运行
        this.serverProcess = childProcess.spawn(nodePath, ["build/index.js"], {
          cwd: serverDir,
          env: {
            ...process.env,
            PORT: this.port.toString(),
            NODE_ENV: 'development',
            DEBUG: 'mcp:*',  // 启用更多调试信息
            NODE_OPTIONS: '--max-old-space-size=4096',  // 增加Node内存限制
            FORCE_COLOR: 'true'  // 确保彩色输出
          },
          shell: true
        });
        
        if (!this.serverProcess || !this.serverProcess.pid) {
          throw new Error("无法创建服务器进程");
        }
        
        this.outputChannel.appendLine(`服务器进程已启动，PID: ${this.serverProcess.pid}`);
      } catch (error) {
        this.outputChannel.appendLine(`创建服务器进程时出错: ${error}`);
        vscode.window.showErrorMessage("启动 MCP Inspector 服务器进程失败");
        return false;
      }

      // 处理服务器输出
      this.serverProcess.stdout?.on("data", (data: Buffer) => {
        const output = data.toString();
        this.outputChannel.append(output);
        
        // 检查服务器是否已启动
        if (output.includes("Proxy server listening on port") || 
            output.includes("Server is running on port") ||
            output.includes("listening on port")) {
          this.isServerRunning = true;
          this.outputChannel.appendLine("检测到服务器已成功启动");
          vscode.window.showInformationMessage(`MCP Inspector 服务器已启动，端口：${this.port}`);
        }
        
        // 检查常见错误模式
        if (output.includes("Error: Cannot find module")) {
          this.outputChannel.appendLine("检测到模块缺失错误，可能需要重新安装依赖");
        }
      });

      // 处理服务器错误输出
      this.serverProcess.stderr?.on("data", (data: Buffer) => {
        const errorOutput = data.toString();
        this.outputChannel.append(errorOutput);
        
        // 分析常见错误模式
        if (errorOutput.includes("Cannot find module")) {
          // 模块缺失错误
          const moduleMatch = errorOutput.match(/Cannot find module '([^']+)'/);
          if (moduleMatch && moduleMatch[1]) {
            const missingModule = moduleMatch[1];
            this.outputChannel.appendLine(`检测到缺失模块: ${missingModule}`);
            this.outputChannel.appendLine(`尝试手动安装该模块可能解决问题: npm install ${missingModule}`);
          }
        } else if (errorOutput.includes("SyntaxError")) {
          // 语法错误
          this.outputChannel.appendLine("检测到JavaScript语法错误，服务器代码可能存在问题");
        } else if (errorOutput.includes("EADDRINUSE")) {
          // 端口被占用
          this.outputChannel.appendLine(`端口 ${this.port} 已被占用，请尝试使用其他端口或关闭占用该端口的应用`);
          
          // 尝试寻找新端口并重启服务器
          vscode.window.showWarningMessage(
            `端口 ${this.port} 已被占用，是否尝试使用其他端口?`,
            "是", "否"
          ).then(choice => {
            if (choice === "是") {
              // 停止当前服务器
              this.stopServer();
              
              // 重新启动服务器（会自动寻找新端口）
              setTimeout(() => {
                // 直接执行启动服务器命令
                vscode.commands.executeCommand("mcp-inspector.startServer");
              }, 1000);
            }
          });
        }
      });

      // 处理服务器退出
      this.serverProcess.on("exit", (code: number | null) => {
        this.isServerRunning = false;
        this.outputChannel.appendLine(`服务器已退出，退出码：${code}`);
        
        if (code !== 0) {
          // 提供更具体的错误信息
          let errorMessage = `MCP Inspector 服务器异常退出，退出码：${code}`;
          
          // 根据退出码给出建议
          if (code === 1) {
            errorMessage += "。这可能是由于Node.js运行时错误或未捕获的异常导致的。";
            this.outputChannel.appendLine("退出码1通常表示未捕获的JavaScript异常或运行时错误。");
          } else if (code === 134 || code === 139 || code === 11) {
            errorMessage += "。这可能是由于内存问题或C++扩展崩溃导致的。";
            this.outputChannel.appendLine("退出码表明可能有内存问题或本机扩展崩溃。");
          } else if (code === 127) {
            errorMessage += "。命令可能找不到或路径问题。";
            this.outputChannel.appendLine("退出码127通常表示命令未找到或路径问题。");
          }
          
          vscode.window.showErrorMessage(errorMessage);
        }
      });
      
      // 监听错误事件
      this.serverProcess.on("error", (error: Error) => {
        this.outputChannel.appendLine(`服务器进程错误：${error.message}`);
        this.isServerRunning = false;
        vscode.window.showErrorMessage(`MCP Inspector 服务器进程错误：${error.message}`);
      });

      // 等待服务器启动
      return new Promise<boolean>((resolve) => {
        // 从配置中获取超时时间
        const serverStartTimeout = vscode.workspace.getConfiguration('mcp-inspector').get<number>('serverStartTimeout', 30000);
        
        // 设置超时
        const timeout = setTimeout(() => {
          if (!this.isServerRunning) {
            this.outputChannel.appendLine("服务器启动超时");
            
            // 检查服务器进程是否仍在运行
            if (this.serverProcess) {
              if (this.serverProcess.stdout) {
                this.outputChannel.appendLine("服务器进程仍在运行，但未发送正确的启动消息。");
                this.outputChannel.appendLine("尝试继续使用此进程...");
                this.isServerRunning = true;
                clearInterval(checkInterval);
                resolve(true);
                return;
              } else {
                this.outputChannel.appendLine("服务器进程可能已经崩溃。");
                this.stopServer();
              }
            }
            
            vscode.window.showErrorMessage("MCP Inspector 服务器启动超时，请检查输出通道获取详细信息");
            resolve(false);
          }
        }, serverStartTimeout); // 使用配置中的超时时间

        // 检查服务器是否已启动
        const checkInterval = setInterval(() => {
          if (this.isServerRunning) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve(true);
          } else if (this.serverProcess && this.serverProcess.exitCode !== null) {
            // 服务器进程已退出
            clearTimeout(timeout);
            clearInterval(checkInterval);
            this.outputChannel.appendLine(`服务器进程意外退出，退出码：${this.serverProcess.exitCode}`);
            vscode.window.showErrorMessage(`MCP Inspector 服务器意外退出，退出码：${this.serverProcess.exitCode}`);
            resolve(false);
          }
        }, 500);
      });
    } catch (error) {
      this.outputChannel.appendLine(`启动服务器时出错：${error}`);
      vscode.window.showErrorMessage(`启动 MCP Inspector 服务器时出错：${error}`);
      return false;
    }
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

  // 获取输出通道
  public getOutputChannel(): vscode.OutputChannel {
    return this.outputChannel;
  }

  // 公共方法：预初始化服务器（安装依赖和构建）
  public async preInitializeServer(serverDir: string): Promise<void> {
    try {
      // 安装依赖
      this.outputChannel.appendLine("预初始化：正在安装依赖...");
      await this.installDependencies(serverDir);
      
      // 检查是否需要构建
      const indexJsPath = path.join(serverDir, "build", "index.js");
      if (!fs.existsSync(indexJsPath)) {
        this.outputChannel.appendLine("预初始化：正在构建服务器...");
        await this.runCommand("npm", ["run", "build"], serverDir);
      }
      
      this.outputChannel.appendLine("预初始化：完成");
    } catch (error) {
      this.outputChannel.appendLine(`预初始化失败：${error}`);
      throw error;
    }
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
  
  // 检查是否需要在插件激活时预先安装依赖和构建服务器
  const preInitializeOnActivation = vscode.workspace.getConfiguration('mcp-inspector').get<boolean>('preInitializeOnActivation', true);
  
  if (preInitializeOnActivation) {
    // 使用setTimeout确保不阻塞插件激活过程
    setTimeout(async () => {
      try {
        const serverDir = path.join(context.extensionUri.fsPath, "webview-ui", "server");
        
        // 检查服务器目录是否存在
        if (!fs.existsSync(serverDir)) {
          serverManager.getOutputChannel().appendLine("错误：找不到服务器目录");
          return;
        }
        
        // 在后台安装依赖和构建服务器
        serverManager.getOutputChannel().appendLine("插件激活：正在后台安装依赖和构建服务器...");
        serverManager.getOutputChannel().appendLine("这将加快首次启动服务器的速度。如果不需要此功能，可在设置中禁用'mcp-inspector.preInitializeOnActivation'");
        
        // 使用公共方法进行预初始化
        await serverManager.preInitializeServer(serverDir).catch(err => {
          serverManager.getOutputChannel().appendLine(`插件激活：初始化服务器时出错: ${err}`);
        });
        
        serverManager.getOutputChannel().appendLine("插件激活：依赖安装和构建过程完成");
      } catch (error) {
        serverManager.getOutputChannel().appendLine(`插件激活：初始化过程出错: ${error}`);
      }
    }, 3000); // 延迟3秒执行，避免阻塞插件激活
  } else {
    serverManager.getOutputChannel().appendLine("插件激活：预初始化已在设置中禁用，将在首次启动服务器时安装依赖和构建");
  }

  // 注册启动服务器命令
  const startServerCommand = vscode.commands.registerCommand("mcp-inspector.startServer", async () => {
    await serverManager.startServer(context.extensionUri.fsPath).then(started => {
      if (started) {
        vscode.window.showInformationMessage("MCP Inspector 服务器已启动");
      }
    });
  });

  // 注册停止服务器命令
  const stopServerCommand = vscode.commands.registerCommand("mcp-inspector.stopServer", () => {
    serverManager.stopServer();
    vscode.window.showInformationMessage("MCP Inspector 服务器已停止");
  });

  // 命令：清理npm缓存并重置依赖
  const cleanNpmCacheCommand = vscode.commands.registerCommand("mcp-inspector.cleanNpmCache", async () => {
    vscode.window.showInformationMessage("正在清理npm缓存，这可能需要一些时间...");
    const outputChannel = vscode.window.createOutputChannel("MCP Inspector NPM清理");
    outputChannel.show();
    
    try {
      outputChannel.appendLine("清理npm缓存...");
      
      // 在Windows系统上使用npm.cmd而不是npm
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      
      // 运行npm cache clean --force
      const cleanProcess = childProcess.spawn(npmCmd, ["cache", "clean", "--force"], {
        shell: true
      });
      
      cleanProcess.stdout.on("data", (data: Buffer) => {
        outputChannel.append(data.toString());
      });
      
      cleanProcess.stderr.on("data", (data: Buffer) => {
        outputChannel.append(data.toString());
      });
      
      await new Promise<void>((resolve, reject) => {
        cleanProcess.on("exit", (code: number | null) => {
          if (code === 0) {
            outputChannel.appendLine("npm缓存清理成功");
            resolve();
          } else {
            outputChannel.appendLine(`npm缓存清理失败，退出码：${code}`);
            reject(new Error(`npm缓存清理失败，退出码：${code}`));
          }
        });
        
        cleanProcess.on("error", (err) => {
          outputChannel.appendLine(`npm缓存清理错误：${err.message}`);
          reject(err);
        });
      });
      
      // 清理完成
      outputChannel.appendLine("\n清理完成，请尝试重新启动服务器");
      vscode.window.showInformationMessage("npm缓存清理完成，请尝试重新启动服务器");
    } catch (error) {
      outputChannel.appendLine(`清理操作失败：${error}`);
      vscode.window.showErrorMessage("npm缓存清理失败，请查看输出面板获取详细信息");
    }
  });

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

  // 检查是否需要自动启动服务器
  const autoStartServer = vscode.workspace.getConfiguration('mcp-inspector').get<boolean>('autoStartServer', true);
  if (autoStartServer) {
    // 当插件激活时，自动启动服务器
    serverManager.startServer(context.extensionUri.fsPath).then(started => {
      if (started) {
        vscode.window.showInformationMessage("MCP Inspector 服务器已自动启动");
      }
    });
  }

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

  context.subscriptions.push(startServerCommand);
  context.subscriptions.push(stopServerCommand);
  context.subscriptions.push(cleanNpmCacheCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {
  // 停止服务器
  ServerManager.getInstance().stopServer();
  
  // 释放侧边栏管理器资源
  SidebarManager.getInstance("").dispose();
}
