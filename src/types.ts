/**
 * [INPUT]: 无外部依赖
 * [OUTPUT]: 对外提供 nanobot bridge 协议类型定义
 * [POS]: 类型层，定义 bridge ↔ Python 通信的 JSON 消息格式
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// Nanobot bridge protocol — outbound to Python
export interface BridgeInboundMessage {
  type: "message";
  id: string;
  sender: string;       // Phone number or iCloud email
  chat_id: string;      // Chat GUID (iMessage;+;chat...)
  content: string;
  timestamp: number;
  isGroup: boolean;
  chat_title: string;   // Platform-provided group name (displayName)
  media: string[];
}

// Nanobot bridge protocol — inbound from Python
export interface BridgeSendCommand {
  type: "send";
  to: string;           // Chat GUID
  text: string;
}

export interface BridgeAuthCommand {
  type: "auth";
  token: string;
}

export interface BridgeStatusMessage {
  type: "status";
  status: "connected" | "disconnected";
}

// BlueBubbles types
export interface BBMessage {
  guid: string;
  text: string | null;
  dateCreated: number;
  isFromMe: boolean;
  handle: {
    address: string;    // Phone or email
  } | null;
  chats: Array<{
    guid: string;       // Chat GUID
    style: number;      // 43 = group, 45 = DM (macOS iMessage DB native)
    displayName: string | null;
    participants: Array<{
      address: string;
    }>;
  }>;
  attachments: Array<{
    guid: string;
    filePath: string;
    mimeType: string;
  }>;
  isGroup?: boolean;    // NOT present in real-time WebSocket events
}

export interface BBNewMessageEvent {
  type: "new-message";
  data: BBMessage;
}
