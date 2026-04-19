export type MessageDirection = "inbound" | "outbound";
export type MessageSender = "contact" | "agent" | "ai";
export type MessageType = "text" | "image" | "document" | "interactive" | "cart";
export type MessageStatus = "sent" | "delivered" | "read" | "failed";
export type ConversationStatus = "open" | "resolved" | "pending";
export type CartStatus = "active" | "sent" | "paid" | "abandoned";

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  waMessageId: string | null;
  direction: MessageDirection;
  sender: MessageSender;
  type: MessageType;
  content: string;
  status: MessageStatus;
  metadata: string | null;
  createdAt: Date;
}

export interface CartItem {
  id: string;
  cartId: string;
  productId: string;
  product: Product;
  quantity: number;
  unitPrice: number;
}

export interface Cart {
  id: string;
  conversationId: string;
  status: CartStatus;
  items: CartItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  contactId: string;
  contact: Contact;
  aiEnabled: boolean;
  aiPaused: boolean;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  messages: Message[];
  cart: Cart | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  category: string | null;
  sku: string | null;
  stock: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AIConfig {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  includeProducts: boolean;
  active: boolean;
}

export interface WAConfig {
  id: string;
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  businessId: string | null;
}

export interface ConversationListItem {
  id: string;
  contact: Contact;
  aiEnabled: boolean;
  aiPaused: boolean;
  status: ConversationStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessage: Message | null;
}
