// Vercel serverless entry — imports the esbuild-bundled server.
// This file is plain JS so Vercel's Node.js runtime can execute it directly.
'use strict';

let cachedAppPromise = null;

function getServerlessApp() {
  if (!cachedAppPromise) {
    cachedAppPromise = Promise.resolve()
      .then(() => require('./server.cjs'))
      .then((mod) => {
        const factory = mod.createApp ?? mod.default?.createApp;
        if (typeof factory !== 'function') {
          throw new Error('createApp not exported from bundled server.cjs');
        }
        return factory();
      })
      .catch((err) => {
        cachedAppPromise = null;
        throw err;
      });
  }
  return cachedAppPromise;
}

module.exports = async function handler(req, res) {
  try {
    const app = await getServerlessApp();
    return app(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: false,
          error: 'Server initialization failed',
          detail: message,
          stack: process.env.NODE_ENV !== 'production' ? stack : undefined,
        }),
      );
    }
  }
};
