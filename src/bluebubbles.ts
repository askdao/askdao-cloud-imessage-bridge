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
    const wsUrl = `${this.bbUrl.replace("http", "ws")}/socket.io/?auth=${this.bbPassword}&EIO=4&transport=websocket`;

    this.ws = new WebSocket(wsUrl);

    this.ws.on("open", () => {
      console.log("[BB] WebSocket connected");
      this.onStatusChange?.(true);
    });

    this.ws.on("message", (data: Buffer) => {
      const raw = data.toString();
      this.handleSocketIO(raw);
    });

    this.ws.on("close", () => {
      console.log("[BB] WebSocket disconnected");
      this.onStatusChange?.(false);
      this.scheduleReconnect();
    });

    this.ws.on("error", (err: Error) => {
      console.error("[BB] WebSocket error:", err.message);
    });
  }

  private handleSocketIO(raw: string): void {
    // Socket.IO protocol: prefix digits indicate message type
    // 0 = open, 2 = ping, 3 = pong, 42 = event
    if (raw.startsWith("42")) {
      try {
        const payload = JSON.parse(raw.slice(2));
        if (Array.isArray(payload) && payload[0] === "new-message") {
          this.handleNewMessage(payload[1] as BBMessage);
        }
      } catch {
        // Ignore parse errors
      }
    } else if (raw === "2") {
      // Ping — respond with pong
      this.ws?.send("3");
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
    const url = `${this.bbUrl}/api/v1/message/text`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.bbPassword}`,
      },
      body: JSON.stringify({
        chatGuid,
        message: text,
        method: "apple-script",
      }),
    });
    if (!resp.ok) {
      console.error("[BB] Send failed:", resp.status, await resp.text());
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log("[BB] Reconnecting...");
      this.connect().catch(console.error);
    }, 5000);
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
