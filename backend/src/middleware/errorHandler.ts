import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export function structuredErrorHandler(err: AppError, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Error interno del servidor';

  console.error(`[ERROR ${requestId}] ${code}: ${message}`, err.stack || '');

  res.status(status).json({
    ok: false,
    error: message,
    code,
    ...(process.env.NODE_ENV === 'development' && { details: err.details, stack: err.stack }),
    timestamp: new Date().toISOString(),
    requestId,
  });
}

export function sendError(res: Response, status: number, error: unknown, fallbackMessage: string): void {
  if (error instanceof Error) {
    const req = (res as any).req || ({} as any);
    structuredErrorHandler(error as AppError, req, res, () => {});
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
