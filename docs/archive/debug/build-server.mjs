import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['./server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'server.js',
  external: [],  // Bundle all dependencies
  minify: false,
  sourcemap: false,
  banner: {
    js: '// Amazon Ads Optimizer - Bundled Server\n',
  },
  logLevel: 'info',
});

console.log('✅ Server bundled successfully to server.js');
