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

const app: Express = await getServerlessApp();

export default app;
