import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsEnvelope } from './types';

const MAX_BACKOFF = 15000;

declare global {
  interface ImportMeta {
    readonly env?: {
      readonly VITE_ADMIN_TOKEN?: string;
    };
  }
}

function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = '3000';
  const token = (import.meta as any)?.env?.VITE_ADMIN_TOKEN || '';
  const params = new URLSearchParams();
  if (token) params.set('token', token);
  const qs = params.toString();
  return `${proto}//${host}:${port}${qs ? `?${qs}` : ''}`;
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
    const ws = new WebSocket(wsUrl());
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
