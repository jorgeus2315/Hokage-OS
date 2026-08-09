import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsEnvelope } from './types';
import { ADMIN_TOKEN } from './api';

const MAX_BACKOFF = 15000;

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket(onEvent: (e: WsEnvelope) => void) {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const stoppedRef = useRef(false);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    // A.2: el token viaja como subprotocolo (Sec-WebSocket-Protocol), no en la URL —
    // el backend lo exige en verifyClient antes de aceptar la conexión.
    const ws = new WebSocket(wsUrl(), ADMIN_TOKEN ? [ADMIN_TOKEN] : undefined);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setConnected(true);
    };
    ws.onmessage = (e) => {
      try {
        onEventRef.current(JSON.parse(e.data));
      } catch {
        /* ignora frames no-JSON */
      }
    };
    ws.onclose = () => {
      setConnected(false);
      if (stoppedRef.current) return;
      const delay = Math.min(MAX_BACKOFF, 500 * 2 ** attemptRef.current);
      attemptRef.current += 1;
      timerRef.current = setTimeout(connect, delay);
    };
    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    connect();
    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return connected;
}
