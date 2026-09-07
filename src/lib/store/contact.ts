export function normalizeWhatsAppNumber(value?: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

export function buildWhatsAppHref(value?: string | null, message?: string) {
  const digits = normalizeWhatsAppNumber(value);
  if (!digits) return undefined;

  const baseUrl = `https://wa.me/${digits}`;
  return message ? `${baseUrl}?text=${encodeURIComponent(message)}` : baseUrl;
}

export function getInstagramContact(value?: string | null) {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if ((url.protocol !== "https:" && url.protocol !== "http:") || (hostname !== "instagram.com" && hostname !== "www.instagram.com")) {
      return undefined;
    }

    const username = url.pathname.split("/").filter(Boolean)[0];
    return {
      href: url.toString(),
      label: username ? `@${username}` : "Instagram",
    };
  } catch {
    return undefined;
  }
}
