/**
 * [INPUT]: 依赖 server.ts 的 BridgeServer
 * [OUTPUT]: 对外提供 iMessage Bridge 入口 — 从环境变量启动
 * [POS]: 应用入口，读取环境变量，启动 BridgeServer
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import "dotenv/config";
import { BridgeServer } from "./server.js";

const port = parseInt(process.env.BRIDGE_PORT || "3002", 10);
const authToken = process.env.BRIDGE_TOKEN || "";
const bbUrl = process.env.BLUEBUBBLES_URL || "http://localhost:1234";
const bbPassword = process.env.BLUEBUBBLES_PASSWORD || "";

if (!bbPassword) {
  console.error("BLUEBUBBLES_PASSWORD is required");
  process.exit(1);
}

const server = new BridgeServer({ port, authToken, bbUrl, bbPassword });

server.start().then(() => {
  console.log(`iMessage Bridge running on :${port}`);
  console.log(`BlueBubbles: ${bbUrl}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.stop();
  process.exit(0);
});
