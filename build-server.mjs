import { build } from 'esbuild';

console.log('Bundling src/serverlessHandler.ts -> api/index.js (ESM)...');

await build({
  entryPoints: ['src/serverlessHandler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'api/index.js',
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
  banner: {
    js: `import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});

console.log('✓ Successfully bundled api/index.js');
