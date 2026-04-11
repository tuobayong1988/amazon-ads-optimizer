const esbuild = require('esbuild');

esbuild.build({
  bundle: true,
  platform: 'node',
  target: 'node20',
  external: [
    'pg-native','better-sqlite3','mysql2','tedious','pg-query-stream','oracledb',
    '@tailwindcss/oxide','lightningcss','@babel/preset-typescript',
    '@builder.io/vite-plugin-jsx-loc','vite-plugin-manus-runtime','@vitejs/plugin-react','vite'
  ],
  alias: {
    '@db/schema': './drizzle/schema.ts',
    '@db': './drizzle',
    '@shared': './shared'
  },
  format: 'cjs',
  sourcemap: false,
  minify: false,
  entryPoints: ['server/_core/index.ts'],
  outfile: '/home/ubuntu/test_build_debug.js',
  metafile: true,
  write: false,
  loader: {'.node': 'file'},
}).then(result => {
  const inputs = Object.keys(result.metafile.inputs);
  console.log('Total modules:', inputs.length);
  
  const checks = [
    'reportJobScheduler', 'asyncReport', 'commandConfirmation',
    'optimizationAutoCorrector', 'nextGenBid', 'unifiedOptimization',
    'searchTermHarvest', 'placementOptimization', 'dataSyncScheduler',
    'amazonSyncService', 'syncPerformance'
  ];
  
  for (const check of checks) {
    const found = inputs.filter(i => i.includes(check));
    console.log(`${check}: ${found.length > 0 ? found.join(', ') : 'NOT FOUND'}`);
  }
}).catch(e => console.error('Build error:', e.message));
