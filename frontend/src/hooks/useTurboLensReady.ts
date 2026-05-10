/**
 * useTurboLensReady — module-level singleton that caches whether TurboLens is
 * ready to use (AI configured with commercial provider + connection synced).
 * Same pattern as useBpmEnabled / usePpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { TurboLensStatus } from "@/features/turbolens/utils";

let _cached: TurboLensStatus | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(v: TurboLensStatus) => void>();

const _default: TurboLensStatus = {
  ai_configured: false,
  ready: false,
  enabled: true,
};

function _notify(v: TurboLensStatus) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<TurboLensStatus>("/turbolens/status");
      _notify(res);
    } catch {
      // default to not ready if fetch fails (user may lack permission)
      if (_cached === null) _notify(_default);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useTurboLensReady() {
  const [status, setStatus] = useState<TurboLensStatus>(_cached ?? _default);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: TurboLensStatus) => {
      setStatus(v);
      setLoaded(true);
    };
    _listeners.add(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setStatus(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners.delete(listener);
    };
  }, []);

  const invalidate = useCallback(() => {
    _cached = null;
    _fetch();
  }, []);

  return {
    turboLensReady: status.ready,
    turboLensAiConfigured: status.ai_configured,
    turboLensEnabled: status.enabled ?? true,
    turboLensLoaded: loaded,
    invalidateTurboLens: invalidate,
  };
}
