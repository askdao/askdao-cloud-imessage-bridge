/**
 * [INPUT]: 依赖 ws (WebSocket); 依赖 node fetch; 依赖 types.ts
 * [OUTPUT]: 对外提供 BlueBubblesClient 类 — BlueBubbles REST + WebSocket 客户端
 * [POS]: BlueBubbles 适配层，将 BB 事件翻译为 nanobot bridge 标准协议
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import WebSocket from "ws";
import type { BBMessage, BridgeInboundMessage } from "./types.js";

export class BlueBubblesClient {
  private bbUrl: string;
  private bbPassword: string;
  private ws: WebSocket | null = null;
  private onMessage: ((msg: BridgeInboundMessage) => void) | null = null;
  private onStatusChange: ((connected: boolean) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private static HEARTBEAT_TIMEOUT_MS = 185_000; // pingInterval(60s) + pingTimeout(120s) + margin
  private static readonly RECONNECT_BASE_MS = 3_000;
  private static readonly RECONNECT_MAX_MS = 60_000;

  constructor(bbUrl: string, bbPassword: string) {
    this.bbUrl = bbUrl.replace(/\/$/, "");
    this.bbPassword = bbPassword;
  }

  setMessageHandler(handler: (msg: BridgeInboundMessage) => void): void {
    this.onMessage = handler;
  }

  setStatusHandler(handler: (connected: boolean) => void): void {
    this.onStatusChange = handler;
  }

  async connect(): Promise<void> {
    // Build WebSocket URL: http(s) → ws(s), append Socket.IO handshake params
    const wsUrl = `${this.bbUrl.replace("https://", "wss://").replace("http://", "ws://")}/socket.io/?password=${encodeURIComponent(this.bbPassword)}&EIO=4&transport=websocket`;
    console.log(`[BB] Connecting to: ${wsUrl.replace(this.bbPassword, "***")}`);

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      console.log("[BB] WebSocket connected");
      this.reconnectAttempts = 0;
      this.resetHeartbeat();
      this.onStatusChange?.(true);
    });

    this.ws.on("message", (data: Buffer) => {
      const raw = data.toString();
      this.handleSocketIO(raw);
    });

    this.ws.on("close", (code: number, reason: Buffer) => {
      console.log(`[BB] WebSocket disconnected (code=${code}, reason=${reason.toString() || "none"})`);
      this.onStatusChange?.(false);
      this.scheduleReconnect();
    });

    this.ws.on("error", (err: Error) => {
      console.error(`[BB] WebSocket error: ${err.message || err}`);
    });
  }

  private handleSocketIO(raw: string): void {
    // Socket.IO protocol: prefix digits indicate message type
    // 0 = open (server hello), 40 = connected, 2 = ping, 3 = pong, 42 = event
    if (raw.startsWith("0")) {
      // Open packet — contains {sid, pingInterval, pingTimeout, ...}
      try {
        const config = JSON.parse(raw.slice(1));
        console.log("[BB] Socket.IO open:", JSON.stringify(config));
        // Use server's ping config for heartbeat timeout
        if (config.pingInterval && config.pingTimeout) {
          const timeout = config.pingInterval + config.pingTimeout + 5000;
          BlueBubblesClient.HEARTBEAT_TIMEOUT_MS = timeout;
          console.log(`[BB] Heartbeat timeout set to ${timeout}ms`);
        }
      } catch { /* ignore */ }
      // Send namespace connect — try plain first, then with auth variants
      // BlueBubbles may accept auth via URL query alone
      console.log("[BB] Sending namespace connect (40)");
      this.ws?.send("40");
      return;
    }
    if (raw === "40" || raw.startsWith("40{")) {
      // Connected to namespace
      console.log("[BB] Socket.IO namespace connected");
      return;
    }
    if (raw.startsWith("41")) {
      // Namespace disconnect — may contain reason
      const reason = raw.length > 2 ? raw.slice(2) : "no reason";
      console.log(`[BB] Socket.IO namespace DISCONNECTED: ${reason}`);
      return;
    }
    if (raw.startsWith("44")) {
      // Connect error — contains error details
      console.log(`[BB] Socket.IO connect ERROR: ${raw.slice(2)}`);
      return;
    }
    if (raw.startsWith("42")) {
      try {
        const payload = JSON.parse(raw.slice(2));
        const eventName = Array.isArray(payload) ? payload[0] : "unknown";
        console.log(`[BB] Event: ${eventName}`, JSON.stringify(payload).slice(0, 300));
        if (Array.isArray(payload) && payload[0] === "new-message") {
          this.handleNewMessage(payload[1] as BBMessage);
        }
      } catch {
        // Ignore parse errors
      }
    } else if (raw === "2") {
      // Ping — respond with pong
      console.log("[BB] Ping received, sending pong");
      this.ws?.send("3");
      this.resetHeartbeat();
    } else if (raw === "3") {
      // Pong response (if we sent ping)
      this.resetHeartbeat();
    } else {
      // Log unknown packets for debugging
      console.log(`[BB] Unknown packet: ${raw.slice(0, 100)}`);
    }
  }

  private handleNewMessage(bbMsg: BBMessage): void {
    // Skip messages from self
    if (bbMsg.isFromMe) return;
    if (!bbMsg.text && (!bbMsg.attachments || bbMsg.attachments.length === 0)) return;

    const sender = bbMsg.handle?.address || "unknown";
    const chatGuid = bbMsg.chats?.[0]?.guid || "";
    const isGroup = bbMsg.chats?.[0]?.participants
      ? bbMsg.chats[0].participants.length > 1
      : false;

    const bridgeMsg: BridgeInboundMessage = {
      type: "message",
      id: bbMsg.guid,
      sender,
      chat_id: chatGuid,
      content: bbMsg.text || "",
      timestamp: Math.floor(bbMsg.dateCreated / 1000),
      isGroup,
      media: bbMsg.attachments?.map((a) => a.filePath) || [],
    };

    this.onMessage?.(bridgeMsg);
  }

  async sendMessage(chatGuid: string, text: string): Promise<void> {
    const url = `${this.bbUrl}/api/v1/message/text?password=${encodeURIComponent(this.bbPassword)}`;
    const tempGuid = `bridge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatGuid,
        message: text,
        method: "apple-script",
        tempGuid,
      }),
    });
    if (!resp.ok) {
      console.error("[BB] Send failed:", resp.status, await resp.text());
    }
  }

  private resetHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      console.log("[BB] Heartbeat timeout — no ping from server, reconnecting");
      this.ws?.terminate(); // 强制断开，不等 close 帧
    }, BlueBubblesClient.HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.clearHeartbeat();
    const delay = Math.min(
      BlueBubblesClient.RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      BlueBubblesClient.RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    console.log(`[BB] Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(console.error);
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
