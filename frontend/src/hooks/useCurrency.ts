import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api/client";

let _cache: string | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(c: string) => void>();

function notify(c: string) {
  _cache = c;
  for (const fn of _listeners) fn(c);
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidateCurrency(c: string) {
  notify(c);
}

function _fetchOnce(): Promise<void> {
  if (_cache) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = api
    .get<{ currency: string }>("/settings/currency")
    .then((r) => notify(r.currency))
    .catch(() => {
      /* keep default */
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function useCurrency() {
  const [currency, setCurrency] = useState(_cache || "USD");
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setCurrency);
    if (!_cache) {
      _fetchOnce().finally(() => setLoading(false));
    }
    return () => {
      _listeners.delete(setCurrency);
    };
  }, []);

  /** Full-format: e.g. $1,200,000 or 1.200.000 € */
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  /** Currency symbol extracted from the formatter, e.g. "$", "€" */
  const symbol = useMemo(() => {
    const parts = fmt.formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || currency;
  }, [fmt, currency]);

  /** Short format for tight spaces: e.g. $450k, €1.2M */
  const fmtShort = useCallback(
    (v: number) => {
      if (Math.abs(v) >= 1_000) {
        return `${symbol}${(v / 1_000).toFixed(0)}k`;
      }
      return fmt.format(v);
    },
    [symbol, fmt],
  );

  /** Call after admin changes the currency to update all consumers. */
  const invalidate = useCallback((newCurrency: string) => {
    notify(newCurrency);
  }, []);

  return { currency, loading, fmt, fmtShort, symbol, invalidate };
}
