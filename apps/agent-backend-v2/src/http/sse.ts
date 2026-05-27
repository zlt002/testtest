import type { ServerResponse } from 'node:http';
import type { AgentEvent } from '../agent/domain/events.ts';
import { setCorsHeaders } from './json.ts';

export function startSse(res: ServerResponse): void {
  setCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}

export function writeSseData(res: ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSseEvent(res: ServerResponse, event: AgentEvent): void {
  writeSseData(res, event);
}
