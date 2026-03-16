const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

/**
 * v422: 自定义esbuild插件 - 将动态import()转换为同步require()
 * 
 * 问题：esbuild CJS格式保留动态import()调用，运行时路径解析失败
 * 解决：在打包后的代码中，将所有 import("./xxx") 替换为 Promise.resolve(require("./xxx"))
 * 但由于esbuild已经把所有模块打包到一个文件中，这些require会失败
 * 
 * 真正的解决方案：使用esbuild的banner注入一个import shim
 */

// 方案: 使用esbuild的define + banner来处理
// 在bundle完成后，后处理替换所有动态import为内联require

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
  minify: false, // v422: 不minify以便后处理
  logLevel: 'info',
  loader: {
    '.node': 'file'
  },
}).then(() => {
  // v422: 后处理 - 将动态import()替换为同步require()包装
  console.log('v422: Post-processing dynamic imports...');
  
  let code = fs.readFileSync('dist/index.js', 'utf-8');
  
  // 统计替换
  let count = 0;
  
  // 替换模式: import("./xxx") 或 import("../xxx") -> Promise.resolve(require("./xxx"))
  // 但这些路径在bundle后不存在，所以我们需要不同的方案
  
  // 实际上，esbuild在CJS模式下，动态import的模块如果在bundle中已经存在，
  // 它们应该被内联。问题是esbuild认为这些是外部模块。
  
  // 让我们检查哪些动态import路径实际上指向bundle内部的模块
  const importRegex = /import\(["'](\.[^"']+)["']\)/g;
  let match;
  const imports = new Set();
  while ((match = importRegex.exec(code)) !== null) {
    imports.add(match[1]);
  }
  
  console.log(`Found ${imports.size} unique dynamic import paths:`);
  for (const imp of imports) {
    console.log(`  ${imp}`);
  }
  
  // 这些都是内部模块，已经被打包到bundle中了
  // 我们不需要替换它们，因为它们的代码已经在bundle中
  // 问题是动态import()试图从文件系统加载它们
  
  // 解决方案：将这些动态import替换为直接引用bundle内部的模块
  // 但这需要知道esbuild给每个模块的内部变量名...
  
  // 更简单的方案：完全不用动态import，改用静态import
  // 但源代码有564个动态import，改动太大
  
  // 最终方案：使用esbuild的splitting功能（需要ESM格式）
  // 或者：不打包，直接用tsx运行源代码
  
  const stats = fs.statSync('dist/index.js');
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`Bundle size: ${sizeMB}MB`);
  
}).catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});
