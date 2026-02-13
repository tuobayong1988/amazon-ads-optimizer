const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['server/_core/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  external: [
    'pg-native',
    'better-sqlite3',
    'mysql2',
    'tedious',
    'pg-query-stream',
    'oracledb',
    '@tailwindcss/oxide',
    'lightningcss',
    '@babel/preset-typescript'
  ],
  alias: {
    '@db/schema': './drizzle/schema.ts'
  },
  format: 'cjs',
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  loader: {
    '.node': 'file'
  },
}).then(() => {
  console.log('✅ Server build completed successfully!');
}).catch((error) => {
  console.error('❌ Server build failed:', error);
  process.exit(1);
});
