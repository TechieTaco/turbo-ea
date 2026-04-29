import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";

export type DateFormatKey =
  | "MM/DD/YYYY"
  | "DD/MM/YYYY"
  | "YYYY-MM-DD"
  | "DD MMM YYYY"
  | "MMM DD, YYYY";

export const DEFAULT_DATE_FORMAT: DateFormatKey = "DD MMM YYYY";

export const DATE_FORMAT_OPTIONS: DateFormatKey[] = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
  "DD MMM YYYY",
  "MMM DD, YYYY",
];

let _cache: DateFormatKey | null = null;
const _listeners = new Set<(f: DateFormatKey) => void>();

function notify(f: DateFormatKey) {
  _cache = f;
  for (const fn of _listeners) fn(f);
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shortMonth(d: Date): string {
  return d.toLocaleString(undefined, { month: "short" });
}

export function formatDateWith(
  fmt: DateFormatKey,
  value: Date | string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "MMM DD, YYYY":
      return `${shortMonth(d)} ${dd}, ${yyyy}`;
    case "DD MMM YYYY":
    default:
      return `${dd} ${shortMonth(d)} ${yyyy}`;
  }
}

export function formatDateTimeWith(
  fmt: DateFormatKey,
  value: Date | string | number | null | undefined,
): string {
  const d = toDate(value);
  if (!d) return "";
  const datePart = formatDateWith(fmt, d);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${datePart} ${hh}:${mi}`;
}

export function invalidateDateFormat(next: DateFormatKey) {
  notify(next);
}

export function getCachedDateFormat(): DateFormatKey {
  return _cache ?? DEFAULT_DATE_FORMAT;
}

export function useDateFormat() {
  const [dateFormat, setDateFormat] = useState<DateFormatKey>(
    _cache ?? DEFAULT_DATE_FORMAT,
  );
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setDateFormat);
    if (!_cache) {
      api
        .get<{ date_format: string }>("/settings/date-format")
        .then((r) => {
          const next = (DATE_FORMAT_OPTIONS as string[]).includes(r.date_format)
            ? (r.date_format as DateFormatKey)
            : DEFAULT_DATE_FORMAT;
          notify(next);
        })
        .catch(() => {
          notify(DEFAULT_DATE_FORMAT);
        })
        .finally(() => setLoading(false));
    }
    return () => {
      _listeners.delete(setDateFormat);
    };
  }, []);

  const formatDate = useCallback(
    (value: Date | string | number | null | undefined) =>
      formatDateWith(dateFormat, value),
    [dateFormat],
  );

  const formatDateTime = useCallback(
    (value: Date | string | number | null | undefined) =>
      formatDateTimeWith(dateFormat, value),
    [dateFormat],
  );

  const invalidate = useCallback((next: DateFormatKey) => {
    notify(next);
  }, []);

  const example = useMemo(
    () => formatDateWith(dateFormat, new Date(2026, 3, 29)),
    [dateFormat],
  );

  return {
    dateFormat,
    loading,
    formatDate,
    formatDateTime,
    invalidate,
    example,
  };
}
