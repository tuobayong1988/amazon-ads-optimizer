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
    '@db/schema': './drizzle/schema.ts',
    '@db': './drizzle',
    '@shared': './shared',
  },
  format: 'cjs',
  sourcemap: true,
  // v355: 开启minify压缩，减少bundle体积约50%
  // 注意：不排除构建时依赖（vite等），因为vite.ts在启动时会被加载
  // 即使生产模式下setupVite()会跳过，模块级别的import仍然会执行
  minify: true,
  logLevel: 'info',
  loader: {
    '.node': 'file'
  },
}).then(() => {
  const fs = require('fs');
  const stats = fs.statSync('dist/index.js');
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`✅ Server build completed! Bundle size: ${sizeMB}MB`);
}).catch((error) => {
  console.error('❌ Server build failed:', error);
  process.exit(1);
});
