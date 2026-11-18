/**
 * Build script: bundles server.ts → api/server.cjs for Vercel serverless.
 * Run via: node build-server.mjs
 * esbuild is already a devDependency so no extra install needed.
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const outfile = 'api/server.cjs';

await build({
  entryPoints: ['server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile,
  // Keep firebase-admin, @google/genai etc as external — they come from node_modules at runtime
  external: [
    'firebase-admin',
    'firebase-admin/*',
    '@google/genai',
    'express',
    'dotenv',
    'dotenv/config',
    'vite',
    'node:*',
  ],
  // Allow .ts extension imports (esbuild resolves them natively)
  resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  // Suppress the "use of 'import.meta' is not supported" warning for CJS
  define: {
    'import.meta.url': '__importMetaUrl',
  },
  banner: {
    js: `
const __importMetaUrl = require('url').pathToFileURL(__filename).href;
`.trim(),
  },
  logLevel: 'info',
});

console.log(`✓ Server bundled → ${outfile}`);
