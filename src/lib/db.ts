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
    name: "Nova",
    systemPrompt: `Sos Nova, la asistente virtual de *Alta Telefonía* (altatelefonia.com.ar) 📱

Alta Telefonía es un e-commerce especializado en repuestos y accesorios para celulares: pantallas, baterías, placas, cámaras, flex, y mucho más. También hacemos servicio técnico.

*Tu personalidad:*
- Amigable, cálida y profesional
- Hablás en español rioplatense: usás "vos", "te", "podés", "tenés", etc.
- NUNCA usás la palabra "che" — suena pesado y repetitivo
- Usás algún emoji ocasionalmente pero sin exagerar
- Sos directa y útil: no das vueltas

*Cómo estructurás los mensajes para WhatsApp:*
- Usás *negrita* para resaltar nombres de productos, precios o puntos importantes
- Usás listas con guiones o bullets cuando hay varios ítems
- Mensajes cortos y claros (máx. 4-5 líneas por respuesta)
- Si hay precios, siempre mostrás USD y ARS (ej: *USD 10 | ARS $15.000*)
- Para el stock: ✅ disponible / ❌ sin stock

*Tus objetivos:*
1. Ayudar al cliente a encontrar el repuesto o accesorio que necesita
2. Informar precios en dólares y pesos argentinos
3. Confirmar disponibilidad de stock
4. Guiar al cliente para agregar al carrito y concretar la compra
5. Si no encontrás el producto exacto, sugerí alternativas similares

*Importante:*
- Si el cliente pregunta por un modelo de celular, buscá los repuestos de ese modelo
- Si algo no está disponible, decíselo con amabilidad y ofrecé alternativas
- No inventés precios ni productos que no están en el catálogo
- Si el cliente ya tiene algo en el carrito, podés mencionarlo`,
    model: "llama-3.3-70b-versatile",
    temperature: 0.65,
    maxTokens: 450,
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

export interface CartMongoItem {
  id: string;
  cartId: string;
  mongoProductId: string;
  name: string;
  image: string | null;
  unitPriceUSD: number;
  unitPriceARS: number;
  quantity: number;
}

async function getOrCreateCart(conversationId: string): Promise<string> {
  const q = query(collection(db, "carts"), where("conversationId", "==", conversationId), limit(1));
  const snap = await getDocs(q);
  if (!snap.empty) return snap.docs[0].id;
  const cartId = uuid();
  await setDoc(doc(db, "carts", cartId), {
    conversationId, status: "active",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  return cartId;
}

export async function getCart(conversationId: string) {
  const q = query(collection(db, "carts"), where("conversationId", "==", conversationId), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const cartDoc = snap.docs[0];
  const cartData = cartDoc.data();

  const itemsSnap = await getDocs(
    query(collection(db, "cartItems"), where("cartId", "==", cartDoc.id))
  );
  const items: CartMongoItem[] = itemsSnap.docs.map((d) => ({
    id: d.id,
    cartId: cartDoc.id,
    mongoProductId: d.data().mongoProductId ?? d.data().productId ?? "",
    name: d.data().name ?? "Producto",
    image: d.data().image ?? null,
    unitPriceUSD: d.data().unitPriceUSD ?? d.data().unitPrice ?? 0,
    unitPriceARS: d.data().unitPriceARS ?? 0,
    quantity: d.data().quantity ?? 1,
  }));

  return {
    id: cartDoc.id, ...cartData, items,
    createdAt: toDate(cartData.createdAt),
    updatedAt: toDate(cartData.updatedAt),
  };
}

export async function addToCart(
  conversationId: string,
  product: { mongoProductId: string; name: string; image: string | null; unitPriceUSD: number; unitPriceARS: number },
  quantity = 1
) {
  const cartId = await getOrCreateCart(conversationId);

  const existingQ = query(
    collection(db, "cartItems"),
    where("cartId", "==", cartId),
    where("mongoProductId", "==", product.mongoProductId),
    limit(1)
  );
  const existingSnap = await getDocs(existingQ);

  if (!existingSnap.empty) {
    await updateDoc(existingSnap.docs[0].ref, { quantity: (existingSnap.docs[0].data().quantity ?? 1) + quantity });
  } else {
    await setDoc(doc(db, "cartItems", uuid()), {
      cartId,
      mongoProductId: product.mongoProductId,
      name: product.name,
      image: product.image,
      unitPriceUSD: product.unitPriceUSD,
      unitPriceARS: product.unitPriceARS,
      quantity,
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
