import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n";

/** Module-level cache so all consumers share a single fetch. */
let cached: SupportedLocale[] | null = null;
let fetchPromise: Promise<SupportedLocale[]> | null = null;

async function doFetch(): Promise<SupportedLocale[]> {
  try {
    const res = await api.get<{ locales: string[] }>("/settings/enabled-locales");
    const valid = res.locales.filter((l): l is SupportedLocale =>
      (SUPPORTED_LOCALES as readonly string[]).includes(l),
    );
    cached = valid.length > 0 ? valid : [...SUPPORTED_LOCALES];
  } catch {
    cached = [...SUPPORTED_LOCALES];
  }
  fetchPromise = null;
  return cached;
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
    if (cached) {
      setLocales(cached);
      return;
    }
    if (!fetchPromise) fetchPromise = doFetch();
    fetchPromise.then(setLocales);
  }, []);

  const invalidate = useCallback((newLocales?: SupportedLocale[]) => {
    if (newLocales) {
      cached = newLocales;
      setLocales(newLocales);
    } else {
      cached = null;
      fetchPromise = doFetch();
      fetchPromise.then(setLocales);
    }
  }, []);

  return { enabledLocales: locales, invalidateEnabledLocales: invalidate };
}
