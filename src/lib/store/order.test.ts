import { describe, expect, it } from "vitest";

import { buildStoreWhatsAppUrl, orderMinimumProgress, type CreatedStoreOrder } from "./order";

const fixture: CreatedStoreOrder = {
  order_number: "MB-000125",
  total: 500000,
  customer_type: "wholesale",
  customer_name: "Juan Pérez",
  customer_phone: "351 555-1212",
  customer_locality: "Río Tercero",
  customer_province: "Córdoba",
  whatsapp: "+54 9 3571 555555",
  items: [{ product_name: "Pampers XXG", quantity: 5, unit_price: 100000 }],
};

describe("store order helpers", () => {
  it("enforces retail and wholesale minimum boundaries", () => {
    expect(orderMinimumProgress(19999, 20000)).toMatchObject({ reached: false, remaining: 1 });
    expect(orderMinimumProgress(20000, 20000)).toMatchObject({ reached: true, remaining: 0, percent: 100 });
    expect(orderMinimumProgress(499999, 500000)).toMatchObject({ reached: false, remaining: 1 });
    expect(orderMinimumProgress(500000, 500000)).toMatchObject({ reached: true, remaining: 0 });
  });

  it("builds a normalized WhatsApp URL from the saved order snapshot", () => {
    const url = buildStoreWhatsAppUrl(fixture);
    expect(url).toMatch(/^https:\/\/wa\.me\/5493571555555\?text=/);
    const message = decodeURIComponent(url!.split("?text=")[1]);
    expect(message).toContain("MB-000125");
    expect(message).toContain("Pampers XXG x 5");
    expect(message).toContain("Mayorista");
  });

  it("does not create a destination when WhatsApp is not configured", () => {
    expect(buildStoreWhatsAppUrl({ ...fixture, whatsapp: null })).toBeUndefined();
  });
});
