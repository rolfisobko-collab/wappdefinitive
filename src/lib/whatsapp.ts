import axios from "axios";

const WA_API_BASE = "https://graph.facebook.com/v19.0";

export function getWAClient(phoneNumberId: string, accessToken: string) {
  const client = axios.create({
    baseURL: `${WA_API_BASE}/${phoneNumberId}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  return {
    async sendTextMessage(to: string, text: string) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text, preview_url: false },
      });
      return res.data;
    },

    async sendInteractiveList(
      to: string,
      header: string,
      body: string,
      footer: string,
      buttonText: string,
      sections: WAListSection[]
    ) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          header: { type: "text", text: header },
          body: { text: body },
          footer: { text: footer },
          action: {
            button: buttonText,
            sections,
          },
        },
      });
      return res.data;
    },

    async sendProductCatalog(to: string, catalogId: string, productId: string) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "product",
          body: { text: "Aquí está el producto:" },
          action: {
            catalog_id: catalogId,
            product_retailer_id: productId,
          },
        },
      });
      return res.data;
    },

    async sendProductCard(
      to: string,
      imageUrl: string | null,
      bodyText: string,
      buttons: { id: string; title: string }[]
    ) {
      const safeButtons = buttons.slice(0, 3).map((b) => ({
        type: "reply",
        reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
      }));

      if (imageUrl) {
        const res = await client.post("/messages", {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            header: { type: "image", image: { link: imageUrl } },
            body: { text: bodyText.slice(0, 1024) },
            action: { buttons: safeButtons },
          },
        });
        return res.data;
      } else {
        const res = await client.post("/messages", {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text: bodyText.slice(0, 1024) },
            action: { buttons: safeButtons },
          },
        });
        return res.data;
      }
    },

    async sendButtons(to: string, bodyText: string, buttons: { id: string; title: string }[]) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: bodyText.slice(0, 1024) },
          action: {
            buttons: buttons.slice(0, 3).map((b) => ({
              type: "reply",
              reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
            })),
          },
        },
      });
      return res.data;
    },

    async markAsRead(messageId: string) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      });
      return res.data;
    },

    async sendTemplateMessage(
      to: string,
      templateName: string,
      languageCode: string,
      components: object[]
    ) {
      const res = await client.post("/messages", {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components,
        },
      });
      return res.data;
    },
  };
}

export interface WAListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export function parseIncomingWebhook(body: WAWebhookBody): ParsedWAMessage[] {
  const messages: ParsedWAMessage[] = [];

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return messages;

    for (const msg of value.messages) {
      const contact = value.contacts?.find((c: WAContact) => c.wa_id === msg.from);

      let text = msg.text?.body ?? "";
      let interactivePayload: { type: string; id: string; title: string } | null = null;

      if (msg.type === "interactive") {
        const interactive = msg.interactive as Record<string, unknown>;
        const iType = interactive?.type as string;
        if (iType === "button_reply") {
          const reply = interactive.button_reply as Record<string, string>;
          text = reply?.title ?? "";
          interactivePayload = { type: "button_reply", id: reply?.id ?? "", title: reply?.title ?? "" };
        } else if (iType === "list_reply") {
          const reply = interactive.list_reply as Record<string, string>;
          text = reply?.title ?? "";
          interactivePayload = { type: "list_reply", id: reply?.id ?? "", title: reply?.title ?? "" };
        }
      }

      messages.push({
        messageId: msg.id,
        from: msg.from,
        contactName: contact?.profile?.name ?? msg.from,
        timestamp: new Date(parseInt(msg.timestamp) * 1000),
        type: msg.type,
        text,
        interactivePayload,
        rawMessage: msg,
      });
    }
  } catch {
    // ignore parse errors
  }

  return messages;
}

export interface ParsedWAMessage {
  messageId: string;
  from: string;
  contactName: string;
  timestamp: Date;
  type: string;
  text: string;
  interactivePayload: { type: string; id: string; title: string } | null;
  rawMessage: object;
}

interface WAContact {
  wa_id: string;
  profile?: { name: string };
}

export interface WAWebhookBody {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: WAContact[];
        messages?: Array<{
          id: string;
          from: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          [key: string]: unknown;
        }>;
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}
