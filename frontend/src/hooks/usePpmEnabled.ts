/**
 * usePpmEnabled — module-level singleton that caches whether the PPM feature
 * is enabled. Same pattern as useBpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

let _cached: boolean | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: boolean) => void> = [];

function _notify(v: boolean) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidatePpmEnabled(v: boolean) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ enabled: boolean }>("/settings/ppm-enabled");
      _notify(res.enabled);
    } catch {
      // default to false (opt-in) if fetch fails
      if (_cached === null) _notify(false);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function usePpmEnabled() {
  const [enabled, setEnabled] = useState<boolean>(_cached ?? false);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: boolean) => {
      setEnabled(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setEnabled(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal?: boolean) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      _fetch();
    }
  }, []);

  return { ppmEnabled: enabled, ppmLoaded: loaded, invalidatePpm: invalidate };
}
