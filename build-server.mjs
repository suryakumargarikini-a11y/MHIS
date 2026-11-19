import { build } from 'esbuild';

console.log('Bundling src/serverlessHandler.ts -> api/index.js (CJS)...');

await build({
  entryPoints: ['src/serverlessHandler.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
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
  footer: {
    js: `module.exports = handler; module.exports.default = handler; module.exports.getServerlessApp = getServerlessApp; module.exports.config = config;`,
  },
  logLevel: 'info',
});

console.log('✓ Successfully bundled api/index.js as CommonJS');
