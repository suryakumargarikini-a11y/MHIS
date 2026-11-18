import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Express } from 'express';
import { createApp } from '../server.ts';

export const config = {
  maxDuration: 60,
};

let cachedAppPromise: Promise<Express> | null = null;

export function getServerlessApp(): Promise<Express> {
  if (!cachedAppPromise) {
    cachedAppPromise = createApp().catch((err) => {
      cachedAppPromise = null;
      console.error('[MHIS Serverless Init Error]:', err);
      throw err;
    });
  }
  return cachedAppPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getServerlessApp();
    await new Promise<void>((resolve, reject) => {
      res.on('finish', () => resolve());
      res.on('close', () => resolve());
      res.on('error', (err) => reject(err));
      app(
        req as unknown as Parameters<Express>[0],
        res as unknown as Parameters<Express>[1],
        (err: unknown) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MHIS Serverless Request Handler Error]:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      await new Promise<void>((resolve) => {
        res.end(
          JSON.stringify({
            success: false,
            ok: false,
            error: `Server initialization error: ${message}`,
            code: 'SERVER_INIT_ERROR',
            detail: message,
          }),
          () => resolve(),
        );
      });
    }
  }
}
