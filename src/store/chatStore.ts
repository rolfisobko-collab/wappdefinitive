"use client";

import { create } from "zustand";
import { ConversationListItem, Message, Cart } from "@/lib/types";

interface ChatStore {
  conversations: ConversationListItem[];
  selectedConversationId: string | null;
  messages: Record<string, Message[]>;
  carts: Record<string, Cart | null>;
  isLoadingConversations: boolean;
  isLoadingMessages: boolean;
  searchQuery: string;
  sidebarTab: "chats" | "products" | "settings";

  setConversations: (convs: ConversationListItem[]) => void;
  selectConversation: (id: string | null) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  setCart: (conversationId: string, cart: Cart | null) => void;
  setLoadingConversations: (loading: boolean) => void;
  setLoadingMessages: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSidebarTab: (tab: "chats" | "products" | "settings") => void;
  updateConversation: (id: string, updates: Partial<ConversationListItem>) => void;
  markAsRead: (conversationId: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  conversations: [],
  selectedConversationId: null,
  messages: {},
  carts: {},
  isLoadingConversations: false,
  isLoadingMessages: false,
  searchQuery: "",
  sidebarTab: "chats" as "chats" | "products" | "settings",

  setConversations: (convs) => set({ conversations: convs }),

  selectConversation: (id) => set({ selectedConversationId: id }),

  setMessages: (conversationId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [conversationId]: messages },
    })),

  addMessage: (conversationId, message) =>
    set((state) => {
      const existing = state.messages[conversationId] ?? [];
      const alreadyExists = existing.some((m) => m.id === message.id);
      if (alreadyExists) return state;
      return {
        messages: {
          ...state.messages,
          [conversationId]: [...existing, message],
        },
        conversations: state.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: message,
                lastMessageAt: message.createdAt,
                unreadCount:
                  message.direction === "inbound" && state.selectedConversationId !== conversationId
                    ? c.unreadCount + 1
                    : c.unreadCount,
              }
            : c
        ),
      };
    }),

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] ?? []).map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ),
      },
    })),

  setCart: (conversationId, cart) =>
    set((state) => ({
      carts: { ...state.carts, [conversationId]: cart },
    })),

  setLoadingConversations: (loading) => set({ isLoadingConversations: loading }),

  setLoadingMessages: (loading) => set({ isLoadingMessages: loading }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  markAsRead: (conversationId) =>
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c
      ),
    })),
}));
