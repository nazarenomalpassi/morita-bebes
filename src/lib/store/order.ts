import { buildWhatsAppHref } from "./contact";

export type CreatedStoreOrder = {
  order_number: string;
  total: number;
  customer_type: string;
  customer_name: string;
  customer_phone: string;
  customer_locality: string;
  customer_province: string;
  whatsapp: string | null;
  items: Array<{ product_name: string; quantity: number; unit_price: number }>;
};

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

export function orderMinimumProgress(subtotal: number, minimum: number) {
  return {
    reached: subtotal >= minimum,
    remaining: Math.max(0, minimum - subtotal),
    percent: minimum <= 0 ? 100 : Math.min(100, Math.max(0, subtotal / minimum * 100)),
  };
}

export function buildStoreWhatsAppUrl(order: CreatedStoreOrder) {
  const lines = [
    "Hola Morita Bebés",
    "",
    `Quiero realizar el pedido ${order.order_number}:`,
    `Cliente: ${order.customer_name}`,
    `Tipo: ${order.customer_type === "wholesale" ? "Mayorista" : "Minorista"}`,
    "",
    ...order.items.map((item) => `- ${item.product_name} x ${item.quantity} — ${money.format(item.quantity * item.unit_price)}`),
    "",
    `TOTAL: ${money.format(order.total)}`,
    `Localidad: ${order.customer_locality}, ${order.customer_province}`,
    `Teléfono: ${order.customer_phone}`,
  ];
  return buildWhatsAppHref(order.whatsapp, lines.join("\n"));
}
