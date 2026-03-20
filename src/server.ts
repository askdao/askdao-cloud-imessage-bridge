/**
 * [INPUT]: 依赖 ws (WebSocket); 依赖 bluebubbles.ts 的 BlueBubblesClient
 * [OUTPUT]: 对外提供 BridgeServer 类 — WebSocket server 供 Python 端连接
 * [POS]: WebSocket 服务层，复用 nanobot bridge 协议，桥接 BB ↔ Python
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { WebSocketServer, WebSocket } from "ws";
import { BlueBubblesClient } from "./bluebubbles.js";
import type { BridgeInboundMessage, BridgeSendCommand } from "./types.js";

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private bb: BlueBubblesClient;
  private clients: Set<WebSocket> = new Set();
  private authToken: string;
  private port: number;

  constructor(config: {
    port: number;
    authToken: string;
    bbUrl: string;
    bbPassword: string;
  }) {
    this.port = config.port;
    this.authToken = config.authToken;
    this.bb = new BlueBubblesClient(config.bbUrl, config.bbPassword);

    // Wire BB messages to all authenticated clients
    this.bb.setMessageHandler((msg) => this.broadcast(msg));
    this.bb.setStatusHandler((connected) => {
      this.broadcast({ type: "status", status: connected ? "connected" : "disconnected" });
    });
  }

  async start(): Promise<void> {
    // Connect to BlueBubbles
    await this.bb.connect();

    // Start WebSocket server for Python clients
    this.wss = new WebSocketServer({ port: this.port });
    console.log(`[Bridge] WebSocket server listening on :${this.port}`);

    this.wss.on("connection", (ws) => {
      let authenticated = !this.authToken; // No token = auto-auth

      ws.on("message", async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === "auth") {
            if (msg.token === this.authToken) {
              authenticated = true;
              ws.send(JSON.stringify({ type: "status", status: "connected" }));
              this.clients.add(ws);
              console.log("[Bridge] Client authenticated");
            } else {
              ws.send(JSON.stringify({ type: "error", error: "Invalid token" }));
              ws.close();
            }
            return;
          }

          if (!authenticated) {
            ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
            return;
          }

          if (msg.type === "send") {
            const cmd = msg as BridgeSendCommand;
            await this.bb.sendMessage(cmd.to, cmd.text);
          }
        } catch (err) {
          console.error("[Bridge] Error handling client message:", err);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log("[Bridge] Client disconnected");
      });
    });
  }

  private broadcast(msg: BridgeInboundMessage | { type: string; status: string }): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  async stop(): Promise<void> {
    await this.bb.disconnect();
    this.wss?.close();
  }
}
