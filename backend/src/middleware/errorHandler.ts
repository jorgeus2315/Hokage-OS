import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export function structuredErrorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void {
  const isDev = process.env.NODE_ENV === 'development';
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const status = err.status || 500;
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
  const rawMessage = err.message || 'Error interno del servidor';

  // Detalle completo SOLO en el log del servidor.
  console.error(`[ERROR ${requestId}] ${code}: ${rawMessage}`, err.stack || '');

  // No filtrar detalles internos al cliente en 5xx (posible fuga de rutas/SQL/stack). Los 4xx
  // llevan mensajes de validación intencionados y seguros → se conservan.
  const clientMessage = status >= 500 && !isDev ? 'Error interno del servidor' : rawMessage;

  res.status(status).json({
    ok: false,
    error: clientMessage,
    code,
    ...(isDev && { details: err.details, stack: err.stack }),
    timestamp: new Date().toISOString(),
    requestId,
  });
}

export function sendError(res: Response, status: number, error: unknown, fallbackMessage: string): void {
  if (error instanceof Error) {
    const req = (res as any).req || ({} as any);
    const appErr = error as AppError;
    // Honrar el status del llamador (antes se ignoraba → todo caía a 500). Así un 4xx de
    // validación conserva su mensaje y solo los 5xx reales se genericizan.
    if (appErr.status == null) appErr.status = status;
    structuredErrorHandler(appErr, req, res, () => {});
    return;
  }

  const requestId = res.req?.headers?.['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  res.status(status).json({
    ok: false,
    error: fallbackMessage,
    code: status === 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    timestamp: new Date().toISOString(),
    requestId,
  });
}
