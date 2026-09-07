import { describe, expect, it } from "vitest";

import { buildWhatsAppHref, getInstagramContact, normalizeWhatsAppNumber } from "./contact";

describe("store contact links", () => {
  it("normalizes the configured WhatsApp number", () => {
    expect(normalizeWhatsAppNumber("+54 9 3571 362168")).toBe("5493571362168");
    expect(normalizeWhatsAppNumber("0054 9 3571 362168")).toBe("5493571362168");
  });

  it("builds a WhatsApp link with an encoded message", () => {
    expect(buildWhatsAppHref("+54 9 3571 362168", "Hola Morita Bebés"))
      .toBe("https://wa.me/5493571362168?text=Hola%20Morita%20Beb%C3%A9s");
  });

  it("extracts the Instagram handle and rejects unrelated hosts", () => {
    expect(getInstagramContact("https://www.instagram.com/morita_bebes?igsi=abc"))
      .toMatchObject({ label: "@morita_bebes" });
    expect(getInstagramContact("https://example.com/morita_bebes")).toBeUndefined();
  });
});
