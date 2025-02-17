// The module 'vscode' contains the VS Code extensibility API
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
let outputChannel: vscode.OutputChannel;

// 获取webview内容
function getWebviewContent(
  webview: vscode.Webview,
  extensionPath: string,
  htmlFileName: string
) {
  const htmlPath = path.join(extensionPath, "webview-ui", "dist", htmlFileName);
  let html = fs.readFileSync(htmlPath, "utf-8");

  // 获取正确的资源路径
  const scriptPathOnDisk = path.join(extensionPath, "webview-ui", "dist");
  html = html.replace(/(href|src)="\/([^"]*)"/g, (match, p1, p2) => {
    // 处理相对路径
    const uri = vscode.Uri.file(path.join(scriptPathOnDisk, p2));
    return `${p1}="${webview.asWebviewUri(uri)}"`;
  });

  return html;
}

// Inspector侧边栏提供者类
class InspectorSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // 处理来自WebView的消息
    // webviewView.webview.onDidReceiveMessage(async (data) => {
    //   switch (data.type) {
    //     case "connect":
    //       // 打开主面板
    //       InspectorMainPanel.createOrShow(this._extensionUri.fsPath);
    //       break;
    //   }
    // });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return getWebviewContent(webview, this._extensionUri.fsPath, "index.html");
  }
}

export function activate(context: vscode.ExtensionContext) {
  // 注册侧边栏WebView
  const sidebarProvider = new InspectorSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "mcp-inspector-sidebar",
      sidebarProvider
    )
  );
}

// This method is called when your extension is deactivated
export function deactivate() {}
