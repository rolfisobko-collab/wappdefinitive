import {
  collection, doc, getDoc, getDocs, updateDoc, deleteDoc,
  query, where, limit, setDoc, Timestamp, serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { v4 as uuid } from "uuid";

// ─── helpers ───────────────────────────────────────────────────────────────

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (val instanceof Timestamp) return val.toDate();
  if (val instanceof Date) return val;
  return new Date(val as string);
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// ─── CONTACTS ──────────────────────────────────────────────────────────────

export async function upsertContact(phone: string, name?: string | null) {
  const q = query(collection(db, "contacts"), where("phone", "==", phone));
  const snap = await getDocs(q);

  if (!snap.empty) {
    const ref = snap.docs[0].ref;
    if (name) await updateDoc(ref, { name, updatedAt: serverTimestamp() });
    return { id: snap.docs[0].id, ...snap.docs[0].data(), updatedAt: new Date() };
  }

  const id = uuid();
  const data = { phone, name: name ?? null, avatarUrl: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await setDoc(doc(db, "contacts", id), data);
  return { id, ...data, createdAt: new Date(), updatedAt: new Date() };
}

export async function getContact(id: string) {
  const snap = await getDoc(doc(db, "contacts", id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { id: snap.id, ...d, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) };
}

// ─── CONVERSATIONS ─────────────────────────────────────────────────────────

export async function getConversations() {
  const snap = await getDocs(query(collection(db, "conversations")));
  const results = await Promise.all(snap.docs.map(async (d) => {
    const data = d.data();
    const contact = await getContact(data.contactId);
    return {
      id: d.id,
      ...data,
      contact,
      lastMessageAt: data.lastMessageAt ? toDate(data.lastMessageAt) : null,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    };
  }));
  // Sort by lastMessageAt desc in JS
  return results.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return tb - ta;
  });
}

export async function getConversation(id: string) {
  const snap = await getDoc(doc(db, "conversations", id));
  if (!snap.exists()) return null;
  const data = snap.data();
  const contact = await getContact(data.contactId);
  const messages = await getMessages(id);
  const cart = await getCart(id);
  return {
    id: snap.id, ...data, contact, messages, cart,
    lastMessageAt: data.lastMessageAt ? toDate(data.lastMessageAt) : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export async function findOpenConversation(contactId: string) {
  // Single where clause to avoid composite index requirement
  const q = query(
    collection(db, "conversations"),
    where("contactId", "==", contactId),
    limit(5)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  // Filter open in JS
  const openDoc = snap.docs.find((d) => d.data().status === "open");
  if (!openDoc) return null;
  const data = openDoc.data();
  const messages = await getMessages(openDoc.id, 20);
  return { id: openDoc.id, ...data, messages };
}

export async function createConversation(contactId: string) {
  const id = uuid();
  const data = {
    contactId, aiEnabled: true, aiPaused: false, status: "open",
    unreadCount: 0, lastMessageAt: null, lastMessage: null,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, "conversations", id), data);
  return { id, ...data, createdAt: new Date(), updatedAt: new Date() };
}

export async function updateConversation(id: string, updates: Record<string, unknown>) {
  await updateDoc(doc(db, "conversations", id), { ...stripUndefined(updates), updatedAt: serverTimestamp() });
}

// ─── MESSAGES ──────────────────────────────────────────────────────────────

export async function getMessages(conversationId: string, limitCount = 200) {
  const q = query(
    collection(db, "messages"),
    where("conversationId", "==", conversationId),
    limit(limitCount)
  );
  const snap = await getDocs(q);
  const msgs = snap.docs.map((d) => ({
    id: d.id, ...d.data(), createdAt: toDate(d.data().createdAt),
  }));
  // Sort in JS to avoid needing composite Firestore index
  return msgs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export async function createMessage(data: {
  conversationId: string;
  waMessageId?: string | null;
  direction: string;
  sender: string;
  type?: string;
  content: string;
  status?: string;
  metadata?: string | null;
}) {
  const id = uuid();
  const msgData = {
    ...data,
    type: data.type ?? "text",
    status: data.status ?? "sent",
    waMessageId: data.waMessageId ?? null,
    metadata: data.metadata ?? null,
    createdAt: serverTimestamp(),
  };
  await setDoc(doc(db, "messages", id), msgData);

  // Denormalize lastMessage in conversation
  await updateDoc(doc(db, "conversations", data.conversationId), {
    lastMessage: { id, ...data, createdAt: new Date() },
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { id, ...msgData, createdAt: new Date() };
}

export async function updateMessage(id: string, updates: Record<string, unknown>) {
  await updateDoc(doc(db, "messages", id), stripUndefined(updates));
}

export async function findMessageByWAId(waMessageId: string) {
  const q = query(collection(db, "messages"), where("waMessageId", "==", waMessageId), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ─── PRODUCTS ──────────────────────────────────────────────────────────────

export async function getProducts(onlyActive = false) {
  const q = onlyActive
    ? query(collection(db, "products"), where("active", "==", true))
    : query(collection(db, "products"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id, ...d.data(),
    createdAt: toDate(d.data().createdAt),
    updatedAt: toDate(d.data().updatedAt),
  }));
}

export async function getProduct(id: string) {
  const snap = await getDoc(doc(db, "products", id));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { id: snap.id, ...d, createdAt: toDate(d.createdAt), updatedAt: toDate(d.updatedAt) };
}

export async function createProduct(data: Record<string, unknown>) {
  const id = uuid();
  const pd = { ...data, active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await setDoc(doc(db, "products", id), pd);
  return { id, ...pd, createdAt: new Date(), updatedAt: new Date() };
}

export async function updateProduct(id: string, updates: Record<string, unknown>) {
  await updateDoc(doc(db, "products", id), { ...stripUndefined(updates), updatedAt: serverTimestamp() });
}

export async function deleteProduct(id: string) {
  await deleteDoc(doc(db, "products", id));
}

// ─── AI CONFIG ─────────────────────────────────────────────────────────────

export async function getAIConfig() {
  const snap = await getDoc(doc(db, "config", "ai"));
  if (!snap.exists()) return getDefaultAIConfig();
  return { id: "ai", ...snap.data() };
}

export function getDefaultAIConfig() {
  return {
    id: "ai",
    name: "Asistente Principal",
    systemPrompt: `Eres un asistente de ventas amigable y profesional. Tu nombre es Mia.

Tu objetivo es:
1. Responder consultas sobre productos disponibles
2. Ayudar a los clientes a elegir lo que buscan
3. Informar sobre precios y disponibilidad
4. Guiar al cliente para completar su compra

Tono: Cercano, amigable pero profesional. Usá español rioplatense (vos, che, etc.)
Siempre: Sé conciso, no más de 3-4 oraciones por respuesta.`,
    model: "llama-3.3-70b-versatile",
    temperature: 0.7,
    maxTokens: 400,
    includeProducts: true,
    groqApiKey: null,
  };
}

export async function saveAIConfig(data: Record<string, unknown>) {
  await setDoc(doc(db, "config", "ai"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  return getAIConfig();
}

// ─── WA CONFIG ─────────────────────────────────────────────────────────────

export async function getWAConfig() {
  const snap = await getDoc(doc(db, "config", "wa"));
  if (!snap.exists()) return null;
  return { id: "wa", ...snap.data() };
}

export async function saveWAConfig(data: Record<string, unknown>) {
  await setDoc(doc(db, "config", "wa"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// ─── CART ──────────────────────────────────────────────────────────────────

export async function getCart(conversationId: string) {
  const q = query(collection(db, "carts"), where("conversationId", "==", conversationId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const cartDoc = snap.docs[0];
  const cartData = cartDoc.data();

  const itemsSnap = await getDocs(
    query(collection(db, "cartItems"), where("cartId", "==", cartDoc.id))
  );
  const items = await Promise.all(itemsSnap.docs.map(async (itemDoc) => {
    const item = itemDoc.data();
    const product = await getProduct(item.productId);
    return { id: itemDoc.id, ...item, product };
  }));

  return {
    id: cartDoc.id, ...cartData,
    items,
    createdAt: toDate(cartData.createdAt),
    updatedAt: toDate(cartData.updatedAt),
  };
}

export async function addToCart(conversationId: string, productId: string, quantity = 1) {
  const product = await getProduct(productId);
  if (!product) throw new Error("Producto no encontrado");

  // Get or create cart
  let cartId: string;
  const cartQuery = query(collection(db, "carts"), where("conversationId", "==", conversationId), limit(1));
  const cartSnap = await getDocs(cartQuery);

  if (cartSnap.empty) {
    cartId = uuid();
    await setDoc(doc(db, "carts", cartId), {
      conversationId, status: "active",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  } else {
    cartId = cartSnap.docs[0].id;
  }

  // Check if item exists
  const existingQ = query(
    collection(db, "cartItems"),
    where("cartId", "==", cartId),
    where("productId", "==", productId),
    limit(1)
  );
  const existingSnap = await getDocs(existingQ);

  if (!existingSnap.empty) {
    const existing = existingSnap.docs[0];
    await updateDoc(existing.ref, { quantity: (existing.data().quantity ?? 1) + quantity });
  } else {
    const itemId = uuid();
    await setDoc(doc(db, "cartItems", itemId), {
      cartId, productId, quantity,
      unitPrice: (product as Record<string, unknown>).price,
    });
  }

  await updateDoc(doc(db, "carts", cartId), { updatedAt: serverTimestamp() });
  return getCart(conversationId);
}

export async function removeFromCart(conversationId: string, itemId?: string) {
  if (itemId) {
    await deleteDoc(doc(db, "cartItems", itemId));
  } else {
    const cartQ = query(collection(db, "carts"), where("conversationId", "==", conversationId), limit(1));
    const cartSnap = await getDocs(cartQ);
    if (!cartSnap.empty) {
      const cartId = cartSnap.docs[0].id;
      const itemsSnap = await getDocs(query(collection(db, "cartItems"), where("cartId", "==", cartId)));
      await Promise.all(itemsSnap.docs.map((d) => deleteDoc(d.ref)));
    }
  }
  return getCart(conversationId);
}
