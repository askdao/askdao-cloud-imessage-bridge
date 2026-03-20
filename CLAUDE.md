# askdao-cloud-imessage-bridge/
> L2 | 父级: ../CLAUDE.md

iMessage Bridge — 将 BlueBubbles REST/WebSocket API 翻译为 nanobot bridge 标准 WebSocket 协议。运行在 macOS 上，需要 BlueBubbles Server 提供 iMessage 底层连接。

## 技术栈
Node.js/TypeScript + ws + BlueBubbles REST API

## 成员清单
src/index.ts: 入口，环境变量读取 + BridgeServer 启动
src/server.ts: WebSocket server，管理 Python 客户端认证 + 消息广播 + 命令转发
src/bluebubbles.ts: BlueBubbles 客户端，Socket.IO WebSocket 连接 + REST API 发送消息
src/types.ts: 类型定义，nanobot bridge 协议 + BlueBubbles API 数据结构
package.json: 依赖定义（ws, tsx, typescript）
tsconfig.json: TypeScript 编译配置

## 部署
```bash
# 环境变量
BRIDGE_PORT=3002
BRIDGE_TOKEN=your-secret
BLUEBUBBLES_URL=http://localhost:1234
BLUEBUBBLES_PASSWORD=your-bb-password

# 运行
npm install
npm start
```

## WebSocket 协议（复用 nanobot bridge 标准）
- 入站（BB → Python）: `{type: "message", id, sender, chat_id, content, timestamp, isGroup, media}`
- 出站（Python → BB）: `{type: "send", to, text}`
- 认证: `{type: "auth", token}`
- 状态: `{type: "status", status: "connected"|"disconnected"}`

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
