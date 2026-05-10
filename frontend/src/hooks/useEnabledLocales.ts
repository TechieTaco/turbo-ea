import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";

/** Module-level cache so all consumers share a single fetch. */
let cached: SupportedLocale[] | null = null;
let fetchPromise: Promise<SupportedLocale[]> | null = null;
const _listeners = new Set<(v: SupportedLocale[]) => void>();

function _notify(v: SupportedLocale[]) {
  cached = v;
  for (const fn of _listeners) fn(v);
}

async function doFetch(): Promise<SupportedLocale[]> {
  try {
    const res = await api.get<{ locales: string[] }>("/settings/enabled-locales");
    const valid = res.locales.filter((l): l is SupportedLocale =>
      (SUPPORTED_LOCALES as readonly string[]).includes(l),
    );
    _notify(valid.length > 0 ? valid : [...SUPPORTED_LOCALES]);
  } catch {
    _notify([...SUPPORTED_LOCALES]);
  }
  fetchPromise = null;
  return cached!;
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidateEnabledLocalesGlobal(v: SupportedLocale[]) {
  _notify(v);
}

/**
 * Returns the list of admin-enabled locales.
 * Defaults to all SUPPORTED_LOCALES until the setting is fetched.
 */
export function useEnabledLocales() {
  const [locales, setLocales] = useState<SupportedLocale[]>(
    cached || [...SUPPORTED_LOCALES],
  );

  useEffect(() => {
    _listeners.add(setLocales);
    if (cached) {
      setLocales(cached);
    } else {
      if (!fetchPromise) fetchPromise = doFetch();
      fetchPromise.then(setLocales);
    }
    return () => {
      _listeners.delete(setLocales);
    };
  }, []);

  const invalidate = useCallback((newLocales?: SupportedLocale[]) => {
    if (newLocales) {
      _notify(newLocales);
    } else {
      cached = null;
      fetchPromise = doFetch();
      fetchPromise.then(setLocales);
    }
  }, []);

  return { enabledLocales: locales, invalidateEnabledLocales: invalidate };
}
