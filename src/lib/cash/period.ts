export const CASH_TIME_ZONE = "America/Argentina/Cordoba";
export const CASH_CLOSE_HOUR = 22;

export type CashPeriod = {
  businessDate: string;
  startsAt: Date;
  closesAt: Date;
  isAwaitingNextDay: boolean;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  month: "2-digit",
  timeZone: CASH_TIME_ZONE,
  year: "numeric",
});

function localParts(value: Date) {
  const parts = Object.fromEntries(
    formatter.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export function addCashDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function argentinaDateTime(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

export function getCurrentCashPeriod(now = new Date()): CashPeriod {
  const local = localParts(now);
  const isAwaitingNextDay = local.hour >= CASH_CLOSE_HOUR;
  const businessDate = isAwaitingNextDay ? addCashDays(local.date, 1) : local.date;

  return {
    businessDate,
    startsAt: argentinaDateTime(businessDate, 0),
    closesAt: argentinaDateTime(businessDate, CASH_CLOSE_HOUR),
    isAwaitingNextDay,
  };
}
