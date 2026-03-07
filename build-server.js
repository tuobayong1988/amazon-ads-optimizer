const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['server/_core/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/index.js',
  external: [
    // 数据库驱动（运行时通过node_modules加载）
    'pg-native',
    'better-sqlite3',
    'mysql2',
    'tedious',
    'pg-query-stream',
    'oracledb',
    // CSS/样式处理（仅前端构建需要）
    '@tailwindcss/oxide',
    'lightningcss',
    // v355: 排除构建时依赖，减少bundle体积约6.85MB（46.9%）
    // 这些依赖仅在开发模式(NODE_ENV=development)下通过vite.ts动态加载
    // 生产环境中setupVite()会直接跳过，不需要这些模块
    'vite',
    '@vitejs/plugin-react',
    '@tailwindcss/vite',
    '@builder.io/vite-plugin-jsx-loc',
    'vite-plugin-manus-runtime',
    'rollup',
    '@babel/parser',
    '@babel/helpers',
    '@babel/types',
    '@babel/preset-typescript',
    'esbuild',
    'tailwindcss',
  ],
  alias: {
    '@db/schema': './drizzle/schema.ts'
  },
  format: 'cjs',
  sourcemap: true,
  // v355: 开启minify压缩，进一步减少bundle体积
  // 原始: 14.59MB → 排除构建依赖: 7.74MB → 排除+压缩: 4.23MB
  // 总计减少71%，预计节省V8堆内存约50-80MB
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
