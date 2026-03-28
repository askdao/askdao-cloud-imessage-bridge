# askdao-cloud-imessage-bridge

iMessage Bridge — 将 BlueBubbles REST/WebSocket API 翻译为 nanobot bridge 标准 WebSocket 协议。

## Architecture

```
Internet                         Mac mini
   │                    ┌─────────────────────────┐
   │    Cloudflare      │                         │
   ├──► Connector ──────┼──► imessage-bridge:3002 │
   │    (cloudflared)   │         │               │
   │                    │         ▼               │
   │                    │    BlueBubbles:1234      │
   │                    │         │               │
   │                    │         ▼               │
   │                    │    Messages.app          │
   │                    └─────────────────────────┘
   │
   ▼
Conductor (云端) 通过 wss://imessage-bridge.yourdomain.com 连接
```

## Prerequisites

- **macOS** (Messages.app 只在 macOS 上运行)
- **Node.js** >= 18
- **BlueBubbles Server** 已安装并运行 ([bluebubbles.app](https://bluebubbles.app))
- **Cloudflare 账号** + 一个托管在 Cloudflare 的域名

## Quick Start (Local Dev)

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env，填入实际值

# 启动
npm start       # 生产模式
npm run dev     # 开发模式 (watch)
```

## Environment Variables

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_PORT` | `3002` | WebSocket 服务端口 |
| `BRIDGE_TOKEN` | (空) | 客户端认证 token，空则不验证 |
| `BLUEBUBBLES_URL` | `http://localhost:1234` | BlueBubbles Server 地址 |
| `BLUEBUBBLES_PASSWORD` | (必填) | BlueBubbles Server 密码 |

生产环境建议用 `openssl rand -hex 32` 生成 `BRIDGE_TOKEN`。

## WebSocket Protocol

协议复用 nanobot bridge 标准：

**认证** (客户端 → Bridge)
```json
{"type": "auth", "token": "your-token"}
```

**入站消息** (BlueBubbles → 客户端)
```json
{
  "type": "message",
  "id": "guid",
  "sender": "+1234567890",
  "chat_id": "iMessage;+;chat...",
  "content": "hello",
  "timestamp": 1234567890,
  "isGroup": false,
  "chat_title": "Group Name",
  "media": []
}
```

**发送消息** (客户端 → BlueBubbles)
```json
{"type": "send", "to": "chat_guid", "text": "hello"}
```

**状态通知** (Bridge → 客户端)
```json
{"type": "status", "status": "connected"}
```

## Production Deployment (Mac mini)

### Step 1: Clone & Configure

```bash
cd ~/Services
git clone https://github.com/askdao/askdao-cloud-imessage-bridge.git
cd askdao-cloud-imessage-bridge
npm install

cp .env.example .env
# 编辑 .env，填入生产环境配置
```

### Step 2: Install as launchd Service

```bash
# 一键安装（自动检测 Node 路径、生成 plist、加载服务）
./deploy/macos/setup.sh install
```

服务会开机自启，崩溃后自动重启（10s 间隔）。

**管理命令：**

```bash
./deploy/macos/setup.sh status      # 查看服务状态
./deploy/macos/setup.sh logs        # 查看日志（最近 50 行）
./deploy/macos/setup.sh uninstall   # 卸载服务

# launchctl 直接操作
launchctl stop  com.askdao.imessage-bridge   # 停止
launchctl start com.askdao.imessage-bridge   # 启动
```

**日志位置：**
- stdout: `logs/bridge.log`
- stderr: `logs/bridge.error.log`

### Step 3: Setup Cloudflare Connector

```bash
# 安装
brew install cloudflared

# 登录（会打开浏览器授权）
cloudflared tunnel login

# 创建 Tunnel
cloudflared tunnel create imessage-bridge
# 记下输出的 Tunnel ID

# 配置 DNS
cloudflared tunnel route dns imessage-bridge imessage-bridge.yourdomain.com

# 创建配置文件
mkdir -p ~/.cloudflared
```

编辑 `~/.cloudflared/config.yml`（模板见 `deploy/macos/cloudflared-config.yml`）：

```yaml
tunnel: <Tunnel ID>
credentials-file: ~/.cloudflared/<Tunnel ID>.json

ingress:
  - hostname: imessage-bridge.yourdomain.com
    service: ws://localhost:3002
    originRequest:
      connectTimeout: 30s
      tcpKeepAlive: 30s
  - service: http_status:404
```

```bash
# 测试
cloudflared tunnel run imessage-bridge

# 安装为系统服务（开机自启）
sudo cloudflared service install
```

### Step 4: Verify

```bash
# 检查两个服务都在运行
launchctl list | grep -E 'askdao|cloudflare'

# 检查端口
lsof -i :3002

# 从外部测试 WebSocket 连通性
npx wscat -c wss://imessage-bridge.yourdomain.com
# 连上后发: {"type":"auth","token":"<your-token>"}
```

### Step 5: Configure Conductor

Conductor 端将 WebSocket 地址指向：

```
wss://imessage-bridge.yourdomain.com
```

连接时携带 `BRIDGE_TOKEN` 进行认证。

## Troubleshooting

| 问题 | 排查 |
|------|------|
| 服务启动失败 | `./deploy/macos/setup.sh logs` 查看错误日志 |
| 连不上 BlueBubbles | 确认 BlueBubbles Server 在运行，`curl http://localhost:1234/api/v1/ping` |
| Cloudflare Tunnel 断连 | `sudo launchctl list com.cloudflare.cloudflared` 检查状态 |
| WebSocket 连不上 | 确认 `BRIDGE_TOKEN` 两端一致，用 `wscat` 本地测试 `ws://localhost:3002` |
| 重启后服务没起来 | 确认 plist 在 `~/Library/LaunchAgents/`，Mac mini 已自动登录 |

**注意：** launchd LaunchAgent 需要用户登录后才生效。Mac mini 须配置**自动登录**：System Settings → Users & Groups → Automatic login。
