/**
 * WebSocket client stub — U4 wires live tx / subscription messages.
 * Shape mirrors protocol.ts ClientMessage / ServerMessage.
 */
export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export interface WsClient {
  status: WsStatus;
  connect: (url?: string) => void;
  disconnect: () => void;
  send: (msg: unknown) => void;
}

function notWired(name: string): never {
  throw new Error(`not wired: ${name}`);
}

export function createWsClient(): WsClient {
  return {
    status: "idle",
    connect: (_url?: string) => notWired("ws.connect"),
    disconnect: () => notWired("ws.disconnect"),
    send: (_msg: unknown) => notWired("ws.send"),
  };
}
