"use client";

import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000", {
      path: "/api/socket",
      transports: ["websocket", "polling"],
    });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export type SocketEvents = {
  "new-message": { conversationId: string; message: import("./types").Message };
  "message-status": { conversationId: string; messageId: string; status: string };
  "conversation-updated": { conversationId: string; updates: object };
  "ai-response": { conversationId: string; message: import("./types").Message };
};
