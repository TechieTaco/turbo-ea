import { useEffect, useRef } from "react";
import { getToken } from "@/api/client";

export function useEventStream(onEvent: (event: Record<string, unknown>) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    const es = new EventSource(`/api/v1/events/stream?token=${encodeURIComponent(token)}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        cbRef.current(data);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // Will auto-reconnect
    };
    return () => es.close();
  }, []);
}
