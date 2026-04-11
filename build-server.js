const esbuild = require('esbuild');

const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: [
    'pg-native',
    'better-sqlite3',
    'mysql2',
    'tedious',
    'pg-query-stream',
    'oracledb',
    '@tailwindcss/oxide',
    'lightningcss',
    '@babel/preset-typescript',
    // v449: Vite plugins only used in dev mode, not needed in production bundle
    '@builder.io/vite-plugin-jsx-loc',
    'vite-plugin-manus-runtime',
    '@vitejs/plugin-react',
    'vite',
  ],
  alias: {
    '@db/schema': './drizzle/schema.ts',
    '@db': './drizzle',
    '@shared': './shared',
  },
  format: 'cjs',
  sourcemap: true,
  // v355: 开启minify压缩，减少bundle体积约50%
  minify: true,
  logLevel: 'info',
  loader: {
    '.node': 'file'
  },
};

async function build() {
  // 构建主服务器入口
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ['server/_core/index.ts'],
    outfile: 'dist/index.js',
    metafile: true,
  });
  
  const fs = require('fs');
  const mainStats = fs.statSync('dist/index.js');
  const mainSizeMB = (mainStats.size / 1024 / 1024).toFixed(2);
  console.log(`\u2705 Main server build completed! Bundle size: ${mainSizeMB}MB`);
  
  // P5: 构建 Worker 进程入口
  await esbuild.build({
    ...sharedConfig,
    entryPoints: ['server/worker.ts'],
    outfile: 'dist/worker.js',
  });
  
  const workerStats = fs.statSync('dist/worker.js');
  const workerSizeMB = (workerStats.size / 1024 / 1024).toFixed(2);
  console.log(`\u2705 Worker build completed! Bundle size: ${workerSizeMB}MB`);
}

build().catch((error) => {
  console.error('\u274c Server build failed:', error);
  process.exit(1);
});
