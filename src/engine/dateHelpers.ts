export interface DateHelpersResult {
  today: string;
  yesterday: string;
  week_start: string;
  month_start: string;
  last_month_start: string;
  last_month_end_exclusive: string;
  quarter_start: string;
  last_quarter_start: string;
  last_quarter_end_exclusive: string;
  year_start: string;
  last_year_start: string;
  days_ago_7: string;
  days_ago_30: string;
  days_ago_90: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatLocalYMD(year: number, monthIndex: number, day: number): string {
  const localNoon = new Date(year, monthIndex, day, 12, 0, 0, 0);
  const y = localNoon.getFullYear();
  const m = localNoon.getMonth() + 1;
  const d = localNoon.getDate();
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseLocalYMD(ymd: string): { year: number; monthIndex: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    throw new Error(`Invalid YYYY-MM-DD date string: ${ymd}`);
  }
  return {
    year: Number(match[1]),
    monthIndex: Number(match[2]) - 1,
    day: Number(match[3]),
  };
}

export function addDaysYMD(ymd: string, deltaDays: number): string {
  const { year, monthIndex, day } = parseLocalYMD(ymd);
  return formatLocalYMD(year, monthIndex, day + deltaDays);
}

export function daysInMonthLocal(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0, 0).getDate();
}

export function getDateHelpers(now: Date = new Date()): DateHelpersResult {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const localNoon = new Date(y, m, d, 12, 0, 0, 0);
  const dow = localNoon.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;

  const currentQuarterStartMonth = Math.floor(m / 3) * 3;

  const today = formatLocalYMD(y, m, d);
  const yesterday = formatLocalYMD(y, m, d - 1);
  const week_start = formatLocalYMD(y, m, d - daysSinceMonday);

  const month_start = formatLocalYMD(y, m, 1);
  const last_month_start = formatLocalYMD(y, m - 1, 1);
  const last_month_end_exclusive = month_start;

  const quarter_start = formatLocalYMD(y, currentQuarterStartMonth, 1);
  const last_quarter_start = formatLocalYMD(y, currentQuarterStartMonth - 3, 1);
  const last_quarter_end_exclusive = quarter_start;

  const year_start = formatLocalYMD(y, 0, 1);
  const last_year_start = formatLocalYMD(y - 1, 0, 1);

  const days_ago_7 = formatLocalYMD(y, m, d - 7);
  const days_ago_30 = formatLocalYMD(y, m, d - 30);
  const days_ago_90 = formatLocalYMD(y, m, d - 90);

  return {
    today,
    yesterday,
    week_start,
    month_start,
    last_month_start,
    last_month_end_exclusive,
    quarter_start,
    last_quarter_start,
    last_quarter_end_exclusive,
    year_start,
    last_year_start,
    days_ago_7,
    days_ago_30,
    days_ago_90,
  };
}
