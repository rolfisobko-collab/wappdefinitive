import { MercadoPagoConfig, Preference } from "mercadopago";

// ─── Credenciales MercadoPago ────────────────────────────────────────────────
const _mp1 = "APP_USR-6602267923473389-031617-";
const _mp2 = "eb91fe86d21d03bd124d4b01b8eeca05-190566766";
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || (_mp1 + _mp2);

// ─── Datos bancarios para transferencia ─────────────────────────────────────
export const TRANSFER_INFO = {
  banco:    "Banco Santander",
  alias:    "alta794..",
  titular:  "De Sousa Bueno Liliana Solange",
  cuit:     "23-30638794-4",
  recargo:  0.025, // 2.5%
};

// ─── Dirección USDT TRC-20 ───────────────────────────────────────────────────
export const USDT_INFO = {
  address: "TLRUicbfHNmrm2nrMRnHA8sSz77mYzzgC2",
  network: "TRC-20 (TRON)",
  warning: "⚠️ *Usá SOLO la red TRC-20*. Si enviás por otra red (ERC-20, BEP-20, etc.) el dinero se pierde.",
};

// ─── Crear preferencia de pago en MercadoPago ────────────────────────────────
export interface MPItem {
  name: string;
  quantity: number;
  unitPriceARS: number;
}

export async function createMPPreference(items: MPItem[], payerPhone: string): Promise<string> {
  const client = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });
  const preference = new Preference(client);

  const response = await preference.create({
    body: {
      items: items.map((i) => ({
        id:          i.name.slice(0, 50),
        title:       i.name.slice(0, 256),
        quantity:    i.quantity,
        unit_price:  Math.round(i.unitPriceARS),
        currency_id: "ARS",
      })),
      payer: {
        phone: { area_code: "54", number: payerPhone.replace(/\D/g, "").slice(-10) },
      },
      payment_methods: {
        excluded_payment_types: [],
        installments: 1,
      },
      statement_descriptor: "Alta Telefonia",
      auto_return: "approved",
      back_urls: {
        success: "https://altatelefonia.com.ar",
        failure: "https://altatelefonia.com.ar",
        pending: "https://altatelefonia.com.ar",
      },
    },
  });

  return response.init_point ?? "";
}

// ─── Calcular total con recargo de transferencia ─────────────────────────────
export function calcTransferTotal(totalARS: number) {
  const surcharge = Math.round(totalARS * TRANSFER_INFO.recargo);
  return { original: totalARS, surcharge, total: totalARS + surcharge };
}
