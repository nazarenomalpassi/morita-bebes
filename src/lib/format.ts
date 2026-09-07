export const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 2,
});

export const quantity = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 3,
});

export const dateTime = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export const shortDate = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

export function localDate(value: string | Date) {
  return shortDate.format(typeof value === "string" ? new Date(`${value}T12:00:00`) : value);
}
