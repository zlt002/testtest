import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from '../shared/errors.ts';

function canWriteResponse(res: ServerResponse): boolean {
  return !res.headersSent && !res.writableEnded && !res.destroyed;
}

export function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

export function sendJson(res: ServerResponse, status: number, body: unknown): boolean {
  if (!canWriteResponse(res)) {
    return false;
  }
  setCorsHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
  return true;
}

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return (text ? JSON.parse(text) : {}) as T;
}

export function sendError(res: ServerResponse, error: unknown): boolean {
  if (error instanceof HttpError) {
    return sendJson(res, error.status, { error: error.message, code: error.code });
  }
  return sendJson(res, 500, {
    error: error instanceof Error ? error.message : 'Internal server error',
  });
}
