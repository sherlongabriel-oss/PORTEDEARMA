import type { WASocket } from "@whiskeysockets/baileys";

interface BotState {
  qr: string | null;
  status: "connecting" | "open" | "close" | "unknown";
  lastError: string | null;
  updatedAt: string;
}

const state: BotState = {
  qr: null,
  status: "unknown",
  lastError: null,
  updatedAt: new Date().toISOString()
};

let socketRef: WASocket | null = null;

export function setSocket(socket: WASocket): void {
  socketRef = socket;
}

export function getSocket(): WASocket | null {
  return socketRef;
}

export function setQr(qr: string | null): void {
  state.qr = qr;
  state.updatedAt = new Date().toISOString();
}

export function setLastError(message: string | null): void {
  state.lastError = message;
  state.updatedAt = new Date().toISOString();
}

export function setStatus(status: BotState["status"]): void {
  state.status = status;
  state.updatedAt = new Date().toISOString();
}

export function getState(): BotState {
  return { ...state };
}

export async function logoutSocket(): Promise<void> {
  if (socketRef) {
    await socketRef.logout();
  }
}
