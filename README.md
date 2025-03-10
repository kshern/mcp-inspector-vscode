# MCP Inspector VSCode Extension

[中文文档](README_ZH.md)

MCP Inspector is a VSCode extension designed for visual testing and debugging of MCP (Model Control Protocol) servers. This extension provides a user-friendly interface to help developers test, debug, and monitor MCP server behavior more efficiently.

The WebView UI part of this extension is based on the [Model Context Protocol Inspector](https://github.com/modelcontextprotocol/inspector) project, which is the official debugging and testing tool for the Model Context Protocol.

## Features

- **Visual Interface**: Display MCP server requests and responses through an intuitive WebView interface
- **Real-time Monitoring**: Monitor MCP server activities and status in real-time
- **Request Testing**: Provide an interface for building and sending test requests to MCP servers
- **Response Analysis**: Format and display response data for easy analysis and debugging
- **Server Management**: Built-in server management functions to start and stop MCP servers directly from VSCode
- **Automatic Port Allocation**: Automatically find available ports to avoid port conflicts

![MCP Inspector Interface](resources/mcp.png)

## Requirements

- Visual Studio Code 1.97.0 or higher
- Node.js and npm (for running the built-in server)

## Installation

1. Install from the VSCode Extension Marketplace, or
2. Download the `.vsix` file and install via VSCode's "Install from VSIX..." option, or
3. Clone the repository and build manually:

```bash
git clone https://github.com/kshern/mcp-inspector-vsocde.git
cd mcp-inspector-vsocde
npm install
npm run package
```

## Usage

1. Click the MCP Inspector icon in the VSCode activity bar to open the extension
2. Click the "Start MCP Inspector Server" command to start the server
3. Use the WebView interface to build and send requests to the MCP server
4. Analyze response results and server behavior
5. When finished, click the "Stop MCP Inspector Server" command to stop the server

### Available Commands

- `MCP Inspector: Open MCP Inspector` - Open the main interface
- `MCP Inspector: Start MCP Inspector Server` - Start the proxy server
- `MCP Inspector: Stop MCP Inspector Server` - Stop the proxy server

## Extension Settings

Currently, this extension has no configurable settings. Future versions may add the following settings:

- `mcpInspector.defaultPort`: Set the default port number
- `mcpInspector.autoStartServer`: Automatically start the server when the extension is launched

## Project Structure

```
mcp-inspector-vsocde/
├── src/                 # Extension source code
├── webview-ui/          # WebView UI code (based on github.com/modelcontextprotocol/inspector)
│   ├── client/          # Frontend client code
│   └── server/          # Proxy server code
├── resources/           # Resource files
└── dist/                # Compiled code
```

## Technical Implementation

This extension consists of two parts:

1. **VSCode Extension Part**: Responsible for creating WebViews in VSCode, managing server processes, and handling user interface interactions
2. **WebView UI Part**: Based on the [Model Context Protocol Inspector](https://github.com/modelcontextprotocol/inspector) project, providing an intuitive user interface for testing and debugging MCP servers

By integrating the official MCP Inspector tool into VSCode, this extension provides developers with a more convenient experience for MCP server development and testing.

## Development Guide

### Build and Debug

1. Clone the repository
2. Install dependencies: `npm install`
3. Open the project in VSCode
4. Press F5 to start a debugging session

### Build the Extension

```bash
npm run package
```

This will generate compiled code in the `dist` directory.

## Contributing

Contributions of code, issue reports, or improvement suggestions are welcome. Please follow these steps:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Commit your changes: `git commit -m 'Add some feature'`
4. Push to the branch: `git push origin feature/your-feature-name`
5. Submit a Pull Request

## Acknowledgements

Special thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol) team for developing the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) project, which the WebView UI part of this extension is based on.

## Known Issues

- In some environments, the server may need to be manually restarted to work properly
- Multiple MCP server debugging is not currently supported

## Release Notes

### 0.0.1

- Initial release
- Basic MCP server testing functionality
- WebView UI interface
- Server start and stop functionality

## License

[MIT](LICENSE)

---

**Enjoy using MCP Inspector!**
