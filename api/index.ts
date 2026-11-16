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
      throw err;
    });
  }
  return cachedAppPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getServerlessApp();
  return app(
    req as unknown as Parameters<Express>[0],
    res as unknown as Parameters<Express>[1],
  );
}
