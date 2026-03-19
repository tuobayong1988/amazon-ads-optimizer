import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  // 全局忽略
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "drizzle/migrations/**",
      "server/_archived/**",
      "server/_archived_v149/**",
      "server/sync/**",
      "*.cjs",
      "*.mjs",
      "build-server*.js",
      "vite.*.ts",
    ],
  },

  // ========================================
  // 前端代码 (React + TypeScript)
  // ========================================
  {
    files: ["client/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // ===== React Hooks 严格规则 (防止 useCallback is not defined 类错误) =====
      "react-hooks/rules-of-hooks": "error",           // Hook 调用规则
      "react-hooks/exhaustive-deps": "warn",            // 依赖数组完整性

      // ===== 变量引用检查 (防止 xxx is not defined 类错误) =====
      "no-undef": "off",                                // TypeScript 自身处理
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],

      // ===== TypeScript 类型安全 (逐步收紧 any 使用) =====
      "@typescript-eslint/no-explicit-any": "warn",     // 警告 any 使用
      "@typescript-eslint/no-non-null-assertion": "warn",

      // ===== React Refresh (Vite HMR 兼容性) =====
      "react-refresh/only-export-components": ["warn", {
        allowConstantExport: true,
      }],

      // ===== 通用代码质量 =====
      "no-console": "off",                              // 允许 console（生产环境由构建工具处理）
      "no-debugger": "error",                           // 禁止 debugger
      "no-duplicate-imports": "error",                  // 禁止重复导入
      "no-var": "error",                                // 禁止 var
      "prefer-const": "warn",                           // 优先 const
      "eqeqeq": ["error", "always", {                  // 严格等号
        null: "ignore"
      }],
    },
  },

  // ========================================
  // 后端代码 (Node.js + TypeScript)
  // ========================================
  {
    files: ["server/**/*.ts"],
    ignores: ["server/_archived/**", "server/_archived_v149/**", "server/sync/**"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // ===== TypeScript 类型安全 =====
      "@typescript-eslint/no-explicit-any": "warn",     // 警告 any 使用
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-non-null-assertion": "warn",

      // ===== 通用代码质量 =====
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "no-var": "error",
      "prefer-const": "warn",
      "eqeqeq": ["error", "always", {
        null: "ignore"
      }],
    },
  },

  // ========================================
  // Drizzle Schema (仅类型检查)
  // ========================================
  {
    files: ["drizzle/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",    // Schema 中禁止 any
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
];
