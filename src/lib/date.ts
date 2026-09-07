export const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires";

const dateTimeInputFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ARGENTINA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsRecord(
  parts: Intl.DateTimeFormatPart[],
): Record<string, string> {
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function dateTimeInputValueInArgentina(date = new Date()) {
  const parts = partsRecord(dateTimeInputFormatter.formatToParts(date));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function dateInputValueInArgentina(date = new Date()) {
  return dateTimeInputValueInArgentina(date).slice(0, 10);
}

export function isIsoDate(value: string | null | undefined): value is string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function isYearMonth(value: string | null | undefined): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "");
}

export function nextIsoDate(value: string) {
  if (!isIsoDate(value)) throw new Error("Fecha inválida.");
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function argentinaLocalDateTimeToIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00-03:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return dateTimeInputValueInArgentina(parsed) === value
    ? parsed.toISOString()
    : null;
}

export function excelDateInArgentina(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARGENTINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = partsRecord(formatter.formatToParts(date));
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  ));
}
