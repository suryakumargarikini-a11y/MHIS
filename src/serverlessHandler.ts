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
  const candidatePath =
    (req.headers['x-matched-path'] as string | undefined) ||
    (req.headers['x-vercel-matched-path'] as string | undefined) ||
    (req.headers['x-forwarded-uri'] as string | undefined) ||
    (req.headers['x-original-url'] as string | undefined);

  if (candidatePath && candidatePath.startsWith('/api')) {
    req.url = candidatePath;
  }

  const app = await getServerlessApp();
  app(
    req as unknown as Parameters<Express>[0],
    res as unknown as Parameters<Express>[1],
  );
}
