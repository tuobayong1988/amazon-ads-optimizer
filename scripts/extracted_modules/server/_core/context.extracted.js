// Extracted from production dist/index.js
// Original module: server/_core/context.ts
// Lines: 2821

async function createContext(opts) {
  let user = null;
  const url3 = opts.req.url || "";
  const hasAuth = !!opts.req.headers.authorization;
  logSystem("Context", `createContext called: url=${url3.substring(0, 80)}, hasAuth=${hasAuth}`);
  try {
    const authTimeout = new Promise(
      (resolve) => setTimeout(() => {
        logSystem("Context", `authenticateRequest TIMEOUT after 30s for url=${url3.substring(0, 50)}`);
        console.error("[Context] authenticateRequest timeout after 30s, falling back to null user");
        resolve(null);
      }, 3e4)
    );
    user = await Promise.race([
      sdk.authenticateRequest(opts.req),
      authTimeout
    ]);
    logSystem("Context", `authenticateRequest result: hasUser=${!!user}, userId=${user?.id}`);
  } catch (error48) {
    logSystem("Context", `authenticateRequest ERROR: ${error48.message?.substring(0, 100)}`);
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}
var init_context = __esm({
  "server/_core/context.ts"() {
    "use strict";
    init_sdk();
    init_opsLogger();
    __name(createContext, "createContext");
  }
});

// node_modules/nanoid/url-alphabet/index.js
var urlAlphabet;
var init_url_alphabet = __esm({
  "node_modules/nanoid/url-alphabet/index.js"() {
    urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  }
});

// node_modules/nanoid/index.js
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    import_node_crypto3.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    import_node_crypto3.webcrypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid3(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}
var import_node_crypto3, POOL_SIZE_MULTIPLIER, pool, poolOffset;
var init_nanoid = __esm({
  "node_modules/nanoid/index.js"() {
    import_node_crypto3 = require("node:crypto");
    init_url_alphabet();
    POOL_SIZE_MULTIPLIER = 128;
    __name(fillPool, "fillPool");
    __name(nanoid3, "nanoid");
  }
});

// node_modules/@rolldown/pluginutils/dist/utils.js
var init_utils5 = __esm({
  "node_modules/@rolldown/pluginutils/dist/utils.js"() {
  }
});

// node_modules/@rolldown/pluginutils/dist/filter/composable-filters.js
var init_composable_filters = __esm({
  "node_modules/@rolldown/pluginutils/dist/filter/composable-filters.js"() {
    init_utils5();
  }
});

// node_modules/@rolldown/pluginutils/dist/filter/filter-vite-plugins.js
var init_filter_vite_plugins = __esm({
  "node_modules/@rolldown/pluginutils/dist/filter/filter-vite-plugins.js"() {
  }
});

// node_modules/@rolldown/pluginutils/dist/filter/simple-filters.js
function exactRegex(str, flags) {
  return new RegExp(`^${escapeRegex2(str)}$`, flags);
}
function escapeRegex2(str) {
  return str.replace(escapeRegexRE, "\\$&");
}
function makeIdFiltersToMatchWithQuery(input) {
  if (!Array.isArray(input)) {
    return makeIdFilterToMatchWithQuery(
      // Array.isArray cannot narrow the type
      // https://github.com/microsoft/TypeScript/issues/17002
      input
    );
  }
  return input.map((i) => makeIdFilterToMatchWithQuery(i));
}
function makeIdFilterToMatchWithQuery(input) {
  if (typeof input === "string") {
    return `${input}{?*,}`;
  }
  return makeRegexIdFilterToMatchWithQuery(input);
}
function makeRegexIdFilterToMatchWithQuery(input) {
  return new RegExp(
    // replace `$` with `(?:\?.*)?$` (ignore `\$`)
    input.source.replace(/(?<!\\)\$/g, "(?:\\?.*)?$"),
    input.flags
  );
}
var escapeRegexRE;
var init_simple_filters = __esm({
  "node_modules/@rolldown/pluginutils/dist/filter/simple-filters.js"() {
    __name(exactRegex, "exactRegex");
    escapeRegexRE = /[-/\\^$*+?.()|[\]{}]/g;
    __name(escapeRegex2, "escapeRegex");
    __name(makeIdFiltersToMatchWithQuery, "makeIdFiltersToMatchWithQuery");
    __name(makeIdFilterToMatchWithQuery, "makeIdFilterToMatchWithQuery");
    __name(makeRegexIdFilterToMatchWithQuery, "makeRegexIdFilterToMatchWithQuery");
  }
});

// node_modules/@rolldown/pluginutils/dist/filter/index.js
var init_filter = __esm({
  "node_modules/@rolldown/pluginutils/dist/filter/index.js"() {
    init_composable_filters();
    init_filter_vite_plugins();
    init_simple_filters();
  }
});

// node_modules/@rolldown/pluginutils/dist/index.js
var init_dist3 = __esm({
  "node_modules/@rolldown/pluginutils/dist/index.js"() {
    init_filter();
  }
});

// node_modules/@vitejs/plugin-react/dist/index.js
var dist_exports2 = {};
__export(dist_exports2, {
  default: () => viteReact,
  "module.exports": () => viteReactForCjs
});
function addRefreshWrapper(code, pluginName, id, reactRefreshHost = "") {
  const hasRefresh = refreshContentRE.test(code);
  const onlyReactComp = !hasRefresh && reactCompRE.test(code);
  if (!hasRefresh && !onlyReactComp) return void 0;
  let newCode = code;
  newCode += `

import * as RefreshRuntime from "${reactRefreshHost}${runtimePublicPath}";
const inWebWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
if (import.meta.hot && !inWebWorker) {
  if (!window.$RefreshReg$) {
    throw new Error(
      "${pluginName} can't detect preamble. Something is wrong."
    );
  }

  RefreshRuntime.__hmr_import(import.meta.url).then((currentExports) => {
    RefreshRuntime.registerExportsForReactRefresh(${JSON.stringify(id)}, currentExports);
    import.meta.hot.accept((nextExports) => {
      if (!nextExports) return;
      const invalidateMessage = RefreshRuntime.validateRefreshBoundaryAndEnqueueUpdate(${JSON.stringify(id)}, currentExports, nextExports);
      if (invalidateMessage) import.meta.hot.invalidate(invalidateMessage);
    });
  });
}
`;
  if (hasRefresh) newCode += `function $RefreshReg$(type, id) { return RefreshRuntime.register(type, ${JSON.stringify(id)} + ' ' + id) }
function $RefreshSig$() { return RefreshRuntime.createSignatureFunctionForTransform(); }
`;
  return newCode;
}
function virtualPreamblePlugin({ name: name2, isEnabled }) {
  return {
    name: "vite:react-virtual-preamble",
    resolveId: {
      order: "pre",
      filter: { id: exactRegex(name2) },
      handler(source) {
        if (source === name2) return "\0" + source;
      }
    },
    load: {
      filter: { id: exactRegex("\0" + name2) },
      handler(id) {
        if (id === "\0" + name2) {
          if (isEnabled()) return preambleCode.replace("__BASE__", "/");
          return "";
        }
      }
    }
  };
}
async function loadBabel() {
  if (!babel) babel = await import("@babel/core");
  return babel;
}
function viteReact(opts = {}) {
  const include = opts.include ?? defaultIncludeRE;
  const exclude = opts.exclude ?? defaultExcludeRE;
  const filter2 = (0, import_vite.createFilter)(include, exclude);
  const jsxImportSource = opts.jsxImportSource ?? "react";
  const jsxImportRuntime = `${jsxImportSource}/jsx-runtime`;
  const jsxImportDevRuntime = `${jsxImportSource}/jsx-dev-runtime`;
  const isRolldownVite = "rolldownVersion" in vite;
  let runningInVite = false;
  let isProduction = true;
  let projectRoot = process.cwd();
  let skipFastRefresh = true;
  let base;
  let isBundledDev = false;
  let runPluginOverrides;
  let staticBabelOptions;
  const importReactRE = /\bimport\s+(?:\*\s+as\s+)?React\b/;
  const viteBabel = {
    name: "vite:react-babel",
    enforce: "pre",
    config(_userConfig, { command }) {
      if ("rolldownVersion" in vite) if (opts.jsxRuntime === "classic") return { oxc: {
        jsx: {
          runtime: "classic",
          refresh: command === "serve",
          development: false
        },
        jsxRefreshInclude: makeIdFiltersToMatchWithQuery(include),
        jsxRefreshExclude: makeIdFiltersToMatchWithQuery(exclude)
      } };
      else return {
        oxc: {
          jsx: {
            runtime: "automatic",
            importSource: opts.jsxImportSource,
            refresh: command === "serve"
          },
          jsxRefreshInclude: makeIdFiltersToMatchWithQuery(include),
          jsxRefreshExclude: makeIdFiltersToMatchWithQuery(exclude)
        },
        optimizeDeps: { rolldownOptions: { transform: { jsx: { runtime: "automatic" } } } }
      };
      if (opts.jsxRuntime === "classic") return { esbuild: { jsx: "transform" } };
      else return {
        esbuild: {
          jsx: "automatic",
          jsxImportSource: opts.jsxImportSource
        },
        optimizeDeps: { esbuildOptions: { jsx: "automatic" } }
      };
    },
    configResolved(config2) {
      runningInVite = true;
      base = config2.base;
      if (config2.experimental.bundledDev) isBundledDev = true;
      projectRoot = config2.root;
      isProduction = config2.isProduction;
      skipFastRefresh = isProduction || config2.command === "build" || config2.server.hmr === false;
      const hooks = config2.plugins.map((plugin) => plugin.api?.reactBabel).filter(defined);
      if (hooks.length > 0) runPluginOverrides = /* @__PURE__ */ __name((babelOptions, context) => {
        hooks.forEach((hook) => hook(babelOptions, context, config2));
      }, "runPluginOverrides");
      else if (typeof opts.babel !== "function") {
        staticBabelOptions = createBabelOptions(opts.babel);
        if ((isRolldownVite || skipFastRefresh) && canSkipBabel(staticBabelOptions.plugins, staticBabelOptions) && (opts.jsxRuntime === "classic" ? isProduction : true)) delete viteBabel.transform;
      }
    },
    options(options) {
      if (!runningInVite) {
        options.transform ??= {};
        options.transform.jsx = {
          runtime: opts.jsxRuntime,
          importSource: opts.jsxImportSource
        };
        return options;
      }
    },
    transform: {
      filter: { id: {
        include: makeIdFiltersToMatchWithQuery(include),
        exclude: makeIdFiltersToMatchWithQuery(exclude)
      } },
      async handler(code, id, options) {
        const [filepath] = id.split("?");
        if (!filter2(filepath)) return;
        const ssr = options?.ssr === true;
        const babelOptions = (() => {
          if (staticBabelOptions) return staticBabelOptions;
          const newBabelOptions = createBabelOptions(typeof opts.babel === "function" ? opts.babel(id, { ssr }) : opts.babel);
          runPluginOverrides?.(newBabelOptions, {
            id,
            ssr
          });
          return newBabelOptions;
        })();
        const plugins = [...babelOptions.plugins];
        let reactCompilerPlugin2 = getReactCompilerPlugin(plugins);
        if (reactCompilerPlugin2 && ssr) {
          plugins.splice(plugins.indexOf(reactCompilerPlugin2), 1);
          reactCompilerPlugin2 = void 0;
        }
        if (Array.isArray(reactCompilerPlugin2) && reactCompilerPlugin2[1]?.compilationMode === "annotation" && !compilerAnnotationRE.test(code)) {
          plugins.splice(plugins.indexOf(reactCompilerPlugin2), 1);
          reactCompilerPlugin2 = void 0;
        }
        const isJSX = filepath.endsWith("x");
        const useFastRefresh = !(isRolldownVite || skipFastRefresh) && !ssr && (isJSX || (opts.jsxRuntime === "classic" ? importReactRE.test(code) : code.includes(jsxImportDevRuntime) || code.includes(jsxImportRuntime)));
        if (useFastRefresh) plugins.push([await loadPlugin("react-refresh/babel"), { skipEnvCheck: true }]);
        if (opts.jsxRuntime === "classic" && isJSX) {
          if (!isProduction) plugins.push(await loadPlugin("@babel/plugin-transform-react-jsx-self"), await loadPlugin("@babel/plugin-transform-react-jsx-source"));
        }
        if (canSkipBabel(plugins, babelOptions)) return;
        const parserPlugins = [...babelOptions.parserOpts.plugins];
        if (!filepath.endsWith(".ts")) parserPlugins.push("jsx");
        if (tsRE.test(filepath)) parserPlugins.push("typescript");
        const result = await (await loadBabel()).transformAsync(code, {
          ...babelOptions,
          root: projectRoot,
          filename: id,
          sourceFileName: filepath,
          retainLines: reactCompilerPlugin2 ? false : !isProduction && isJSX && opts.jsxRuntime !== "classic",
          parserOpts: {
            ...babelOptions.parserOpts,
            sourceType: "module",
            allowAwaitOutsideFunction: true,
            plugins: parserPlugins
          },
          generatorOpts: {
            ...babelOptions.generatorOpts,
            importAttributesKeyword: "with",
            decoratorsBeforeExport: true
          },
          plugins,
          sourceMaps: true
        });
        if (result) {
          if (!useFastRefresh) return {
            code: result.code,
            map: result.map
          };
          return {
            code: addRefreshWrapper(result.code, "@vitejs/plugin-react", id, opts.reactRefreshHost) ?? result.code,
            map: result.map
          };
        }
      }
    }
  };
  const viteRefreshWrapper = {
    name: "vite:react:refresh-wrapper",
    apply: "serve",
    async applyToEnvironment(env) {
      if (env.config.consumer !== "client" || skipFastRefresh) return false;
      let nativePlugin;
      try {
        nativePlugin = (await import("vite/internal")).reactRefreshWrapperPlugin;
      } catch {
      }
      if (!nativePlugin || [
        "7.1.10",
        "7.1.11",
        "7.1.12"
      ].includes(vite.version)) return true;
      delete viteRefreshWrapper.transform;
      return nativePlugin({
        cwd: process.cwd(),
        include: makeIdFiltersToMatchWithQuery(include),
        exclude: makeIdFiltersToMatchWithQuery(exclude),
        jsxImportSource,
        reactRefreshHost: opts.reactRefreshHost ?? ""
      });
    },
    transform: {
      filter: { id: {
        include: makeIdFiltersToMatchWithQuery(include),
        exclude: makeIdFiltersToMatchWithQuery(exclude)
      } },
      handler(code, id, options) {
        const ssr = options?.ssr === true;
        const [filepath] = id.split("?");
        const isJSX = filepath.endsWith("x");
        if (!(!skipFastRefresh && !ssr && (isJSX || code.includes(jsxImportDevRuntime) || code.includes(jsxImportRuntime)))) return;
        const newCode = addRefreshWrapper(code, "@vitejs/plugin-react", id, opts.reactRefreshHost);
        return newCode ? {
          code: newCode,
          map: null
        } : void 0;
      }
    }
  };
  const viteConfigPost = {
    name: "vite:react:config-post",
    enforce: "post",
    config(userConfig) {
      if (userConfig.server?.hmr === false) return { oxc: { jsx: { refresh: false } } };
    }
  };
  const viteReactRefreshBundledDevMode = {
    name: "vite:react-refresh-fbm",
    enforce: "pre",
    transformIndexHtml: {
      handler() {
        if (!skipFastRefresh && isBundledDev) return [{
          tag: "script",
          attrs: { type: "module" },
          children: getPreambleCode(base)
        }];
      },
      order: "pre"
    }
  };
  const dependencies = [
    "react",
    "react-dom",
    jsxImportDevRuntime,
    jsxImportRuntime
  ];
  const reactCompilerPlugin = getReactCompilerPlugin(typeof opts.babel === "object" ? opts.babel?.plugins ?? [] : []);
  if (reactCompilerPlugin != null) {
    const reactCompilerRuntimeModule = getReactCompilerRuntimeModule(reactCompilerPlugin);
    dependencies.push(reactCompilerRuntimeModule);
  }
  const viteReactRefresh = {
    name: "vite:react-refresh",
    enforce: "pre",
    config: /* @__PURE__ */ __name((userConfig) => ({
      build: silenceUseClientWarning(userConfig),
      optimizeDeps: { include: dependencies }
    }), "config"),
    resolveId: {
      filter: { id: exactRegex(runtimePublicPath) },
      handler(id) {
        if (id === runtimePublicPath) return id;
      }
    },
    load: {
      filter: { id: exactRegex(runtimePublicPath) },
      handler(id) {
        if (id === runtimePublicPath) return (0, import_node_fs.readFileSync)(refreshRuntimePath, "utf-8").replace(/__README_URL__/g, "https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react");
      }
    },
    transformIndexHtml() {
      if (!skipFastRefresh && !isBundledDev) return [{
        tag: "script",
        attrs: { type: "module" },
        children: getPreambleCode(base)
      }];
    }
  };
  return [
    viteBabel,
    ...isRolldownVite ? [
      viteRefreshWrapper,
      viteConfigPost,
      viteReactRefreshBundledDevMode
    ] : [],
    viteReactRefresh,
    virtualPreamblePlugin({
      name: "@vitejs/plugin-react/preamble",
      isEnabled: /* @__PURE__ */ __name(() => !skipFastRefresh && !isBundledDev, "isEnabled")
    })
  ];
}
function viteReactForCjs(options) {
  return viteReact.call(this, options);
}
function canSkipBabel(plugins, babelOptions) {
  return !(plugins.length || babelOptions.presets.length || babelOptions.overrides.length || babelOptions.configFile || babelOptions.babelrc);
}
function loadPlugin(path2) {
  const cached2 = loadedPlugin.get(path2);
  if (cached2) return cached2;
  const promise2 = import(path2).then((module2) => {
    const value = module2.default || module2;
    loadedPlugin.set(path2, value);
    return value;
  });
  loadedPlugin.set(path2, promise2);
  return promise2;
}
function createBabelOptions(rawOptions) {
  const babelOptions = {
    babelrc: false,
    configFile: false,
    ...rawOptions
  };
  babelOptions.plugins ||= [];
  babelOptions.presets ||= [];
  babelOptions.overrides ||= [];
  babelOptions.parserOpts ||= {};
  babelOptions.parserOpts.plugins ||= [];
  return babelOptions;
}
function defined(value) {
  return value !== void 0;
}
function getReactCompilerPlugin(plugins) {
  return plugins.find((p) => p === "babel-plugin-react-compiler" || Array.isArray(p) && p[0] === "babel-plugin-react-compiler");
}
function getReactCompilerRuntimeModule(plugin) {
  let moduleName = "react/compiler-runtime";
  if (Array.isArray(plugin)) {
    if (plugin[1]?.target === "17" || plugin[1]?.target === "18") moduleName = "react-compiler-runtime";
  }
  return moduleName;
}
var import_node_fs, import_node_path, import_node_url, vite, import_vite, import_meta, runtimePublicPath, reactCompRE, refreshContentRE, preambleCode, getPreambleCode, silenceUseClientWarning, refreshRuntimePath, babel, defaultIncludeRE, defaultExcludeRE, tsRE, compilerAnnotationRE, loadedPlugin;
var init_dist4 = __esm({
  "node_modules/@vitejs/plugin-react/dist/index.js"() {
    import_node_fs = require("node:fs");
    import_node_path = require("node:path");
    import_node_url = require("node:url");
    init_dist3();
    vite = __toESM(require("vite"), 1);
    import_vite = require("vite");
    import_meta = {};
    runtimePublicPath = "/@react-refresh";
    reactCompRE = /extends\s+(?:React\.)?(?:Pure)?Component/;
    refreshContentRE = /\$RefreshReg\$\(/;
    preambleCode = `import { injectIntoGlobalHook } from "__BASE__${runtimePublicPath.slice(1)}";
injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;`;
    getPreambleCode = /* @__PURE__ */ __name((base) => preambleCode.replace("__BASE__", base), "getPreambleCode");
    __name(addRefreshWrapper, "addRefreshWrapper");
    __name(virtualPreamblePlugin, "virtualPreamblePlugin");
    silenceUseClientWarning = /* @__PURE__ */ __name((userConfig) => ({ rollupOptions: { onwarn(warning, defaultHandler) {
      if (warning.code === "MODULE_LEVEL_DIRECTIVE" && (warning.message.includes("use client") || warning.message.includes("use server"))) return;
      if (warning.code === "SOURCEMAP_ERROR" && warning.message.includes("resolve original location") && warning.pos === 0) return;
      if (userConfig.build?.rollupOptions?.onwarn) userConfig.build.rollupOptions.onwarn(warning, defaultHandler);
      else defaultHandler(warning);
    } } }), "silenceUseClientWarning");
    refreshRuntimePath = (0, import_node_path.join)((0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(import_meta.url)), "refresh-runtime.js");
    __name(loadBabel, "loadBabel");
    defaultIncludeRE = /\.[tj]sx?$/;
    defaultExcludeRE = /\/node_modules\//;
    tsRE = /\.tsx?$/;
    compilerAnnotationRE = /['"]use memo['"]/;
    __name(viteReact, "viteReact");
    viteReact.preambleCode = preambleCode;
    __name(viteReactForCjs, "viteReactForCjs");
    Object.assign(viteReactForCjs, { default: viteReactForCjs });
    __name(canSkipBabel, "canSkipBabel");
    loadedPlugin = /* @__PURE__ */ new Map();
    __name(loadPlugin, "loadPlugin");
    __name(createBabelOptions, "createBabelOptions");
    __name(defined, "defined");
    __name(getReactCompilerPlugin, "getReactCompilerPlugin");
    __name(getReactCompilerRuntimeModule, "getReactCompilerRuntimeModule");
  }
});

// node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.umd.js
var require_sourcemap_codec_umd = __commonJS({
  "node_modules/@jridgewell/sourcemap-codec/dist/sourcemap-codec.umd.js"(exports2, module2) {
    (function(global2, factory2) {
      if (typeof exports2 === "object" && typeof module2 !== "undefined") {
        factory2(module2);
        module2.exports = def(module2);
      } else if (typeof define === "function" && define.amd) {
        define(["module"], function(mod) {
          factory2.apply(this, arguments);
          mod.exports = def(mod);
        });
      } else {
        const mod = { exports: {} };
        factory2(mod);
        global2 = typeof globalThis !== "undefined" ? globalThis : global2 || self;
        global2.sourcemapCodec = def(mod);
      }
      function def(m) {
        return "default" in m.exports ? m.exports.default : m.exports;
      }
      __name(def, "def");
    })(exports2, (function(module3) {
      "use strict";
      var __defProp3 = Object.defineProperty;
      var __getOwnPropDesc3 = Object.getOwnPropertyDescriptor;
      var __getOwnPropNames3 = Object.getOwnPropertyNames;
      var __hasOwnProp3 = Object.prototype.hasOwnProperty;
      var __export2 = /* @__PURE__ */ __name((target, all3) => {
        for (var name2 in all3)
          __defProp3(target, name2, { get: all3[name2], enumerable: true });
      }, "__export");
      var __copyProps3 = /* @__PURE__ */ __name((to, from, except2, desc29) => {
        if (from && typeof from === "object" || typeof from === "function") {
          for (let key of __getOwnPropNames3(from))
            if (!__hasOwnProp3.call(to, key) && key !== except2)
              __defProp3(to, key, { get: /* @__PURE__ */ __name(() => from[key], "get"), enumerable: !(desc29 = __getOwnPropDesc3(from, key)) || desc29.enumerable });
        }
        return to;
      }, "__copyProps");
      var __toCommonJS2 = /* @__PURE__ */ __name((mod) => __copyProps3(__defProp3({}, "__esModule", { value: true }), mod), "__toCommonJS");
      var sourcemap_codec_exports = {};
      __export2(sourcemap_codec_exports, {
        decode: /* @__PURE__ */ __name(() => decode4, "decode"),
        decodeGeneratedRanges: /* @__PURE__ */ __name(() => decodeGeneratedRanges, "decodeGeneratedRanges"),
        decodeOriginalScopes: /* @__PURE__ */ __name(() => decodeOriginalScopes, "decodeOriginalScopes"),
        encode: /* @__PURE__ */ __name(() => encode6, "encode"),
        encodeGeneratedRanges: /* @__PURE__ */ __name(() => encodeGeneratedRanges, "encodeGeneratedRanges"),
        encodeOriginalScopes: /* @__PURE__ */ __name(() => encodeOriginalScopes, "encodeOriginalScopes")
      });
      module3.exports = __toCommonJS2(sourcemap_codec_exports);
      var comma = ",".charCodeAt(0);
      var semicolon = ";".charCodeAt(0);
      var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var intToChar = new Uint8Array(64);
      var charToInt = new Uint8Array(128);
      for (let i = 0; i < chars.length; i++) {
        const c = chars.charCodeAt(i);
        intToChar[i] = c;
        charToInt[c] = i;
      }
      function decodeInteger(reader, relative) {
        let value = 0;
        let shift = 0;
        let integer2 = 0;
        do {
          const c = reader.next();
          integer2 = charToInt[c];
          value |= (integer2 & 31) << shift;
          shift += 5;
        } while (integer2 & 32);
        const shouldNegate = value & 1;
        value >>>= 1;
        if (shouldNegate) {
          value = -2147483648 | -value;
        }
        return relative + value;
      }
      __name(decodeInteger, "decodeInteger");
      function encodeInteger(builder, num, relative) {
        let delta = num - relative;
        delta = delta < 0 ? -delta << 1 | 1 : delta << 1;
        do {
          let clamped = delta & 31;
          delta >>>= 5;
          if (delta > 0) clamped |= 32;
          builder.write(intToChar[clamped]);
        } while (delta > 0);
        return num;
      }
      __name(encodeInteger, "encodeInteger");
      function hasMoreVlq(reader, max2) {
        if (reader.pos >= max2) return false;
        return reader.peek() !== comma;
      }
      __name(hasMoreVlq, "hasMoreVlq");
      var bufLength = 1024 * 16;
      var td = typeof TextDecoder !== "undefined" ? /* @__PURE__ */ new TextDecoder() : typeof Buffer !== "undefined" ? {
        decode(buf) {
          const out = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
          return out.toString();
        }
      } : {
        decode(buf) {
          let out = "";
          for (let i = 0; i < buf.length; i++) {
            out += String.fromCharCode(buf[i]);
          }
          return out;
        }
      };
      var StringWriter = class {
        static {
          __name(this, "StringWriter");
        }
        constructor() {
          this.pos = 0;
          this.out = "";
          this.buffer = new Uint8Array(bufLength);
        }
        write(v) {
          const { buffer: buffer2 } = this;
          buffer2[this.pos++] = v;
          if (this.pos === bufLength) {
            this.out += td.decode(buffer2);
            this.pos = 0;
          }
        }
        flush() {
          const { buffer: buffer2, out, pos } = this;
          return pos > 0 ? out + td.decode(buffer2.subarray(0, pos)) : out;
        }
      };
      var StringReader = class {
        static {
          __name(this, "StringReader");
        }
        constructor(buffer2) {
          this.pos = 0;
          this.buffer = buffer2;
        }
        next() {
          return this.buffer.charCodeAt(this.pos++);
        }
        peek() {
          return this.buffer.charCodeAt(this.pos);
        }
        indexOf(char2) {
          const { buffer: buffer2, pos } = this;
          const idx = buffer2.indexOf(char2, pos);
          return idx === -1 ? buffer2.length : idx;
        }
      };
      var EMPTY = [];
      function decodeOriginalScopes(input) {
        const { length } = input;
        const reader = new StringReader(input);
        const scopes = [];
        const stack = [];
        let line = 0;
        for (; reader.pos < length; reader.pos++) {
          line = decodeInteger(reader, line);
          const column = decodeInteger(reader, 0);
          if (!hasMoreVlq(reader, length)) {
            const last = stack.pop();
            last[2] = line;
            last[3] = column;
            continue;
          }
          const kind = decodeInteger(reader, 0);
          const fields = decodeInteger(reader, 0);
          const hasName = fields & 1;
          const scope = hasName ? [line, column, 0, 0, kind, decodeInteger(reader, 0)] : [line, column, 0, 0, kind];
          let vars = EMPTY;
          if (hasMoreVlq(reader, length)) {
            vars = [];
            do {
              const varsIndex = decodeInteger(reader, 0);
              vars.push(varsIndex);
            } while (hasMoreVlq(reader, length));
          }
          scope.vars = vars;
          scopes.push(scope);
          stack.push(scope);
        }
        return scopes;
      }
      __name(decodeOriginalScopes, "decodeOriginalScopes");
      function encodeOriginalScopes(scopes) {
        const writer = new StringWriter();
        for (let i = 0; i < scopes.length; ) {
          i = _encodeOriginalScopes(scopes, i, writer, [0]);
        }
        return writer.flush();
      }
      __name(encodeOriginalScopes, "encodeOriginalScopes");
      function _encodeOriginalScopes(scopes, index2, writer, state) {
        const scope = scopes[index2];
        const { 0: startLine, 1: startColumn, 2: endLine, 3: endColumn, 4: kind, vars } = scope;
        if (index2 > 0) writer.write(comma);
        state[0] = encodeInteger(writer, startLine, state[0]);
        encodeInteger(writer, startColumn, 0);
        encodeInteger(writer, kind, 0);
        const fields = scope.length === 6 ? 1 : 0;
        encodeInteger(writer, fields, 0);
        if (scope.length === 6) encodeInteger(writer, scope[5], 0);
        for (const v of vars) {
          encodeInteger(writer, v, 0);
        }
        for (index2++; index2 < scopes.length; ) {
          const next = scopes[index2];
          const { 0: l, 1: c } = next;
          if (l > endLine || l === endLine && c >= endColumn) {
            break;
          }
          index2 = _encodeOriginalScopes(scopes, index2, writer, state);
        }
        writer.write(comma);
        state[0] = encodeInteger(writer, endLine, state[0]);
        encodeInteger(writer, endColumn, 0);
        return index2;
      }
      __name(_encodeOriginalScopes, "_encodeOriginalScopes");
      function decodeGeneratedRanges(input) {
        const { length } = input;
        const reader = new StringReader(input);
        const ranges = [];
        const stack = [];
        let genLine = 0;
        let definitionSourcesIndex = 0;
        let definitionScopeIndex = 0;
        let callsiteSourcesIndex = 0;
        let callsiteLine = 0;
        let callsiteColumn = 0;
        let bindingLine = 0;
        let bindingColumn = 0;
        do {
          const semi = reader.indexOf(";");
          let genColumn = 0;
          for (; reader.pos < semi; reader.pos++) {
            genColumn = decodeInteger(reader, genColumn);
            if (!hasMoreVlq(reader, semi)) {
              const last = stack.pop();
              last[2] = genLine;
              last[3] = genColumn;
              continue;
            }
            const fields = decodeInteger(reader, 0);
            const hasDefinition = fields & 1;
            const hasCallsite = fields & 2;
            const hasScope = fields & 4;
            let callsite = null;
            let bindings = EMPTY;
            let range;
            if (hasDefinition) {
              const defSourcesIndex = decodeInteger(reader, definitionSourcesIndex);
              definitionScopeIndex = decodeInteger(
                reader,
                definitionSourcesIndex === defSourcesIndex ? definitionScopeIndex : 0
              );
              definitionSourcesIndex = defSourcesIndex;
              range = [genLine, genColumn, 0, 0, defSourcesIndex, definitionScopeIndex];
            } else {
              range = [genLine, genColumn, 0, 0];
            }
            range.isScope = !!hasScope;
            if (hasCallsite) {
              const prevCsi = callsiteSourcesIndex;
              const prevLine = callsiteLine;
              callsiteSourcesIndex = decodeInteger(reader, callsiteSourcesIndex);
              const sameSource = prevCsi === callsiteSourcesIndex;
              callsiteLine = decodeInteger(reader, sameSource ? callsiteLine : 0);
              callsiteColumn = decodeInteger(
                reader,
                sameSource && prevLine === callsiteLine ? callsiteColumn : 0
              );
              callsite = [callsiteSourcesIndex, callsiteLine, callsiteColumn];
            }
            range.callsite = callsite;
            if (hasMoreVlq(reader, semi)) {
              bindings = [];
              do {
                bindingLine = genLine;
                bindingColumn = genColumn;
                const expressionsCount = decodeInteger(reader, 0);
                let expressionRanges;
                if (expressionsCount < -1) {
                  expressionRanges = [[decodeInteger(reader, 0)]];
                  for (let i = -1; i > expressionsCount; i--) {
                    const prevBl = bindingLine;
                    bindingLine = decodeInteger(reader, bindingLine);
                    bindingColumn = decodeInteger(reader, bindingLine === prevBl ? bindingColumn : 0);
                    const expression = decodeInteger(reader, 0);
                    expressionRanges.push([expression, bindingLine, bindingColumn]);
                  }
                } else {
                  expressionRanges = [[expressionsCount]];
                }
                bindings.push(expressionRanges);
              } while (hasMoreVlq(reader, semi));
            }
            range.bindings = bindings;
            ranges.push(range);
            stack.push(range);
          }
          genLine++;
          reader.pos = semi + 1;
        } while (reader.pos < length);
        return ranges;
      }
      __name(decodeGeneratedRanges, "decodeGeneratedRanges");
      function encodeGeneratedRanges(ranges) {
        if (ranges.length === 0) return "";
        const writer = new StringWriter();
        for (let i = 0; i < ranges.length; ) {
          i = _encodeGeneratedRanges(ranges, i, writer, [0, 0, 0, 0, 0, 0, 0]);
        }
        return writer.flush();
      }
      __name(encodeGeneratedRanges, "encodeGeneratedRanges");
      function _encodeGeneratedRanges(ranges, index2, writer, state) {
        const range = ranges[index2];
        const {
          0: startLine,
          1: startColumn,
          2: endLine,
          3: endColumn,
          isScope,
          callsite,
          bindings
        } = range;
        if (state[0] < startLine) {
          catchupLine(writer, state[0], startLine);
          state[0] = startLine;
          state[1] = 0;
        } else if (index2 > 0) {
          writer.write(comma);
        }
        state[1] = encodeInteger(writer, range[1], state[1]);
        const fields = (range.length === 6 ? 1 : 0) | (callsite ? 2 : 0) | (isScope ? 4 : 0);
        encodeInteger(writer, fields, 0);
        if (range.length === 6) {
          const { 4: sourcesIndex, 5: scopesIndex } = range;
          if (sourcesIndex !== state[2]) {
            state[3] = 0;
          }
          state[2] = encodeInteger(writer, sourcesIndex, state[2]);
          state[3] = encodeInteger(writer, scopesIndex, state[3]);
        }
        if (callsite) {
          const { 0: sourcesIndex, 1: callLine, 2: callColumn } = range.callsite;
          if (sourcesIndex !== state[4]) {
            state[5] = 0;
            state[6] = 0;
          } else if (callLine !== state[5]) {
            state[6] = 0;
          }
          state[4] = encodeInteger(writer, sourcesIndex, state[4]);
          state[5] = encodeInteger(writer, callLine, state[5]);
          state[6] = encodeInteger(writer, callColumn, state[6]);
        }
        if (bindings) {
          for (const binding of bindings) {
            if (binding.length > 1) encodeInteger(writer, -binding.length, 0);
            const expression = binding[0][0];
            encodeInteger(writer, expression, 0);
            let bindingStartLine = startLine;
            let bindingStartColumn = startColumn;
            for (let i = 1; i < binding.length; i++) {
              const expRange = binding[i];
              bindingStartLine = encodeInteger(writer, expRange[1], bindingStartLine);
              bindingStartColumn = encodeInteger(writer, expRange[2], bindingStartColumn);
              encodeInteger(writer, expRange[0], 0);
            }
          }
        }
        for (index2++; index2 < ranges.length; ) {
          const next = ranges[index2];
          const { 0: l, 1: c } = next;
          if (l > endLine || l === endLine && c >= endColumn) {
            break;
          }
          index2 = _encodeGeneratedRanges(ranges, index2, writer, state);
        }
        if (state[0] < endLine) {
          catchupLine(writer, state[0], endLine);
          state[0] = endLine;
          state[1] = 0;
        } else {
          writer.write(comma);
        }
        state[1] = encodeInteger(writer, endColumn, state[1]);
        return index2;
      }
      __name(_encodeGeneratedRanges, "_encodeGeneratedRanges");
      function catchupLine(writer, lastLine, line) {
        do {
          writer.write(semicolon);
        } while (++lastLine < line);
      }
      __name(catchupLine, "catchupLine");
      function decode4(mappings) {
        const { length } = mappings;
        const reader = new StringReader(mappings);
        const decoded = [];
        let genColumn = 0;
        let sourcesIndex = 0;
        let sourceLine = 0;
        let sourceColumn = 0;
        let namesIndex = 0;
        do {
          const semi = reader.indexOf(";");
          const line = [];
          let sorted = true;
          let lastCol = 0;
          genColumn = 0;
          while (reader.pos < semi) {
            let seg;
            genColumn = decodeInteger(reader, genColumn);
            if (genColumn < lastCol) sorted = false;
            lastCol = genColumn;
            if (hasMoreVlq(reader, semi)) {
              sourcesIndex = decodeInteger(reader, sourcesIndex);
              sourceLine = decodeInteger(reader, sourceLine);
              sourceColumn = decodeInteger(reader, sourceColumn);
              if (hasMoreVlq(reader, semi)) {
                namesIndex = decodeInteger(reader, namesIndex);
                seg = [genColumn, sourcesIndex, sourceLine, sourceColumn, namesIndex];
              } else {
                seg = [genColumn, sourcesIndex, sourceLine, sourceColumn];
              }
            } else {
              seg = [genColumn];
            }
            line.push(seg);
            reader.pos++;
          }
          if (!sorted) sort(line);
          decoded.push(line);
          reader.pos = semi + 1;
        } while (reader.pos <= length);
        return decoded;
      }
      __name(decode4, "decode");
      function sort(line) {
        line.sort(sortComparator);
      }
      __name(sort, "sort");
      function sortComparator(a, b) {
        return a[0] - b[0];
      }
      __name(sortComparator, "sortComparator");
      function encode6(decoded) {
        const writer = new StringWriter();
        let sourcesIndex = 0;
        let sourceLine = 0;
        let sourceColumn = 0;
        let namesIndex = 0;
        for (let i = 0; i < decoded.length; i++) {
          const line = decoded[i];
          if (i > 0) writer.write(semicolon);
          if (line.length === 0) continue;
          let genColumn = 0;
          for (let j = 0; j < line.length; j++) {
            const segment = line[j];
            if (j > 0) writer.write(comma);
            genColumn = encodeInteger(writer, segment[0], genColumn);
            if (segment.length === 1) continue;
            sourcesIndex = encodeInteger(writer, segment[1], sourcesIndex);
            sourceLine = encodeInteger(writer, segment[2], sourceLine);
            sourceColumn = encodeInteger(writer, segment[3], sourceColumn);
            if (segment.length === 4) continue;
            namesIndex = encodeInteger(writer, segment[4], namesIndex);
          }
        }
        return writer.flush();
      }
      __name(encode6, "encode");
    }));
  }
});

// node_modules/magic-string/dist/magic-string.cjs.js
var require_magic_string_cjs = __commonJS({
  "node_modules/magic-string/dist/magic-string.cjs.js"(exports2, module2) {
    "use strict";
    var sourcemapCodec = require_sourcemap_codec_umd();
    var BitSet = class _BitSet {
      static {
        __name(this, "BitSet");
      }
      constructor(arg) {
        this.bits = arg instanceof _BitSet ? arg.bits.slice() : [];
      }
      add(n2) {
        this.bits[n2 >> 5] |= 1 << (n2 & 31);
      }
      has(n2) {
        return !!(this.bits[n2 >> 5] & 1 << (n2 & 31));
      }
    };
    var Chunk = class _Chunk {
      static {
        __name(this, "Chunk");
      }
      constructor(start, end, content) {
        this.start = start;
        this.end = end;
        this.original = content;
        this.intro = "";
        this.outro = "";
        this.content = content;
        this.storeName = false;
        this.edited = false;
        {
          this.previous = null;
          this.next = null;
        }
      }
      appendLeft(content) {
        this.outro += content;
      }
      appendRight(content) {
        this.intro = this.intro + content;
      }
      clone() {
        const chunk2 = new _Chunk(this.start, this.end, this.original);
        chunk2.intro = this.intro;
        chunk2.outro = this.outro;
        chunk2.content = this.content;
        chunk2.storeName = this.storeName;
        chunk2.edited = this.edited;
        return chunk2;
      }
      contains(index2) {
        return this.start < index2 && index2 < this.end;
      }
      eachNext(fn) {
        let chunk2 = this;
        while (chunk2) {
          fn(chunk2);
          chunk2 = chunk2.next;
        }
      }
      eachPrevious(fn) {
        let chunk2 = this;
        while (chunk2) {
          fn(chunk2);
          chunk2 = chunk2.previous;
        }
      }
      edit(content, storeName, contentOnly) {
        this.content = content;
        if (!contentOnly) {
          this.intro = "";
          this.outro = "";
        }
        this.storeName = storeName;
        this.edited = true;
        return this;
      }
      prependLeft(content) {
        this.outro = content + this.outro;
      }
      prependRight(content) {
        this.intro = content + this.intro;
      }
      reset() {
        this.intro = "";
        this.outro = "";
        if (this.edited) {
          this.content = this.original;
          this.storeName = false;
          this.edited = false;
        }
      }
      split(index2) {
        const sliceIndex = index2 - this.start;
        const originalBefore = this.original.slice(0, sliceIndex);
        const originalAfter = this.original.slice(sliceIndex);
        this.original = originalBefore;
        const newChunk = new _Chunk(index2, this.end, originalAfter);
        newChunk.outro = this.outro;
        this.outro = "";
        this.end = index2;
        if (this.edited) {
          newChunk.edit("", false);
          this.content = "";
        } else {
          this.content = originalBefore;
        }
        newChunk.next = this.next;
        if (newChunk.next) newChunk.next.previous = newChunk;
        newChunk.previous = this;
        this.next = newChunk;
        return newChunk;
      }
      toString() {
        return this.intro + this.content + this.outro;
      }
      trimEnd(rx) {
        this.outro = this.outro.replace(rx, "");
        if (this.outro.length) return true;
        const trimmed = this.content.replace(rx, "");
        if (trimmed.length) {
          if (trimmed !== this.content) {
            this.split(this.start + trimmed.length).edit("", void 0, true);
            if (this.edited) {
              this.edit(trimmed, this.storeName, true);
            }
          }
          return true;
        } else {
          this.edit("", void 0, true);
          this.intro = this.intro.replace(rx, "");
          if (this.intro.length) return true;
        }
      }
      trimStart(rx) {
        this.intro = this.intro.replace(rx, "");
        if (this.intro.length) return true;
        const trimmed = this.content.replace(rx, "");
        if (trimmed.length) {
          if (trimmed !== this.content) {
            const newChunk = this.split(this.end - trimmed.length);
            if (this.edited) {
              newChunk.edit(trimmed, this.storeName, true);
            }
            this.edit("", void 0, true);
          }
          return true;
        } else {
          this.edit("", void 0, true);
          this.outro = this.outro.replace(rx, "");
          if (this.outro.length) return true;
        }
      }
    };
    function getBtoa() {
      if (typeof globalThis !== "undefined" && typeof globalThis.btoa === "function") {
        return (str) => globalThis.btoa(unescape(encodeURIComponent(str)));
      } else if (typeof Buffer === "function") {
        return (str) => Buffer.from(str, "utf-8").toString("base64");
      } else {
        return () => {
          throw new Error("Unsupported environment: `window.btoa` or `Buffer` should be supported.");
        };
      }
    }
    __name(getBtoa, "getBtoa");
    var btoa2 = /* @__PURE__ */ getBtoa();
    var SourceMap = class {
      static {
        __name(this, "SourceMap");
      }
      constructor(properties) {
        this.version = 3;
        this.file = properties.file;
        this.sources = properties.sources;
        this.sourcesContent = properties.sourcesContent;
        this.names = properties.names;
        this.mappings = sourcemapCodec.encode(properties.mappings);
        if (typeof properties.x_google_ignoreList !== "undefined") {
          this.x_google_ignoreList = properties.x_google_ignoreList;
        }
        if (typeof properties.debugId !== "undefined") {
          this.debugId = properties.debugId;
        }
      }
      toString() {
        return JSON.stringify(this);
      }
      toUrl() {
        return "data:application/json;charset=utf-8;base64," + btoa2(this.toString());
      }
    };
    function guessIndent(code) {
      const lines = code.split("\n");
      const tabbed = lines.filter((line) => /^\t+/.test(line));
      const spaced = lines.filter((line) => /^ {2,}/.test(line));
      if (tabbed.length === 0 && spaced.length === 0) {
        return null;
      }
      if (tabbed.length >= spaced.length) {
        return "	";
      }
      const min2 = spaced.reduce((previous, current) => {
        const numSpaces = /^ +/.exec(current)[0].length;
        return Math.min(numSpaces, previous);
      }, Infinity);
      return new Array(min2 + 1).join(" ");
    }
    __name(guessIndent, "guessIndent");
    function getRelativePath(from, to) {
      const fromParts = from.split(/[/\\]/);
      const toParts = to.split(/[/\\]/);
      fromParts.pop();
      while (fromParts[0] === toParts[0]) {
        fromParts.shift();
        toParts.shift();
      }
      if (fromParts.length) {
        let i = fromParts.length;
        while (i--) fromParts[i] = "..";
      }
      return fromParts.concat(toParts).join("/");
    }
    __name(getRelativePath, "getRelativePath");
    var toString3 = Object.prototype.toString;
    function isObject4(thing) {
      return toString3.call(thing) === "[object Object]";
    }
    __name(isObject4, "isObject");
    function getLocator(source) {
      const originalLines = source.split("\n");
      const lineOffsets = [];
      for (let i = 0, pos = 0; i < originalLines.length; i++) {
        lineOffsets.push(pos);
        pos += originalLines[i].length + 1;
      }
      return /* @__PURE__ */ __name(function locate(index2) {
        let i = 0;
        let j = lineOffsets.length;
        while (i < j) {
          const m = i + j >> 1;
          if (index2 < lineOffsets[m]) {
            j = m;
          } else {
            i = m + 1;
          }
        }
        const line = i - 1;
        const column = index2 - lineOffsets[line];
        return { line, column };
      }, "locate");
    }
    __name(getLocator, "getLocator");
    var wordRegex = /\w/;
    var Mappings = class {
      static {
        __name(this, "Mappings");
      }
      constructor(hires) {
        this.hires = hires;
        this.generatedCodeLine = 0;
        this.generatedCodeColumn = 0;
        this.raw = [];
        this.rawSegments = this.raw[this.generatedCodeLine] = [];
        this.pending = null;
      }
      addEdit(sourceIndex, content, loc, nameIndex) {
        if (content.length) {
          const contentLengthMinusOne = content.length - 1;
          let contentLineEnd = content.indexOf("\n", 0);
          let previousContentLineEnd = -1;
          while (contentLineEnd >= 0 && contentLengthMinusOne > contentLineEnd) {
            const segment2 = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
            if (nameIndex >= 0) {
              segment2.push(nameIndex);
            }
            this.rawSegments.push(segment2);
            this.generatedCodeLine += 1;
            this.raw[this.generatedCodeLine] = this.rawSegments = [];
            this.generatedCodeColumn = 0;
            previousContentLineEnd = contentLineEnd;
            contentLineEnd = content.indexOf("\n", contentLineEnd + 1);
          }
          const segment = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
          if (nameIndex >= 0) {
            segment.push(nameIndex);
          }
          this.rawSegments.push(segment);
          this.advance(content.slice(previousContentLineEnd + 1));
        } else if (this.pending) {
          this.rawSegments.push(this.pending);
          this.advance(content);
        }
        this.pending = null;
      }
      addUneditedChunk(sourceIndex, chunk2, original, loc, sourcemapLocations) {
        let originalCharIndex = chunk2.start;
        let first = true;
        let charInHiresBoundary = false;
        while (originalCharIndex < chunk2.end) {
          if (original[originalCharIndex] === "\n") {
            loc.line += 1;
            loc.column = 0;
            this.generatedCodeLine += 1;
            this.raw[this.generatedCodeLine] = this.rawSegments = [];
            this.generatedCodeColumn = 0;
            first = true;
            charInHiresBoundary = false;
          } else {
            if (this.hires || first || sourcemapLocations.has(originalCharIndex)) {
              const segment = [this.generatedCodeColumn, sourceIndex, loc.line, loc.column];
              if (this.hires === "boundary") {
                if (wordRegex.test(original[originalCharIndex])) {
                  if (!charInHiresBoundary) {
                    this.rawSegments.push(segment);
                    charInHiresBoundary = true;
                  }
                } else {
                  this.rawSegments.push(segment);
                  charInHiresBoundary = false;
                }
              } else {
                this.rawSegments.push(segment);
              }
            }
            loc.column += 1;
            this.generatedCodeColumn += 1;
            first = false;
          }
          originalCharIndex += 1;
        }
        this.pending = null;
      }
      advance(str) {
        if (!str) return;
        const lines = str.split("\n");
        if (lines.length > 1) {
          for (let i = 0; i < lines.length - 1; i++) {
            this.generatedCodeLine++;
            this.raw[this.generatedCodeLine] = this.rawSegments = [];
          }
          this.generatedCodeColumn = 0;
        }
        this.generatedCodeColumn += lines[lines.length - 1].length;
      }
    };
    var n = "\n";
    var warned = {
      insertLeft: false,
      insertRight: false,
      storeName: false
    };
    var MagicString = class _MagicString {
      static {
        __name(this, "MagicString");
      }
      constructor(string4, options = {}) {
        const chunk2 = new Chunk(0, string4.length, string4);
        Object.defineProperties(this, {
          original: { writable: true, value: string4 },
          outro: { writable: true, value: "" },
          intro: { writable: true, value: "" },
          firstChunk: { writable: true, value: chunk2 },
          lastChunk: { writable: true, value: chunk2 },
          lastSearchedChunk: { writable: true, value: chunk2 },
          byStart: { writable: true, value: {} },
          byEnd: { writable: true, value: {} },
          filename: { writable: true, value: options.filename },
          indentExclusionRanges: { writable: true, value: options.indentExclusionRanges },
          sourcemapLocations: { writable: true, value: new BitSet() },
          storedNames: { writable: true, value: {} },
          indentStr: { writable: true, value: void 0 },
          ignoreList: { writable: true, value: options.ignoreList },
          offset: { writable: true, value: options.offset || 0 }
        });
        this.byStart[0] = chunk2;
        this.byEnd[string4.length] = chunk2;
      }
      addSourcemapLocation(char2) {
        this.sourcemapLocations.add(char2);
      }
      append(content) {
        if (typeof content !== "string") throw new TypeError("outro content must be a string");
        this.outro += content;
        return this;
      }
      appendLeft(index2, content) {
        index2 = index2 + this.offset;
        if (typeof content !== "string") throw new TypeError("inserted content must be a string");
        this._split(index2);
        const chunk2 = this.byEnd[index2];
        if (chunk2) {
          chunk2.appendLeft(content);
        } else {
          this.intro += content;
        }
        return this;
      }
      appendRight(index2, content) {
        index2 = index2 + this.offset;
        if (typeof content !== "string") throw new TypeError("inserted content must be a string");
        this._split(index2);
        const chunk2 = this.byStart[index2];
        if (chunk2) {
          chunk2.appendRight(content);
        } else {
          this.outro += content;
        }
        return this;
      }
      clone() {
        const cloned = new _MagicString(this.original, { filename: this.filename, offset: this.offset });
        let originalChunk = this.firstChunk;
        let clonedChunk = cloned.firstChunk = cloned.lastSearchedChunk = originalChunk.clone();
        while (originalChunk) {
          cloned.byStart[clonedChunk.start] = clonedChunk;
          cloned.byEnd[clonedChunk.end] = clonedChunk;
          const nextOriginalChunk = originalChunk.next;
          const nextClonedChunk = nextOriginalChunk && nextOriginalChunk.clone();
          if (nextClonedChunk) {
            clonedChunk.next = nextClonedChunk;
            nextClonedChunk.previous = clonedChunk;
            clonedChunk = nextClonedChunk;
          }
          originalChunk = nextOriginalChunk;
        }
        cloned.lastChunk = clonedChunk;
        if (this.indentExclusionRanges) {
          cloned.indentExclusionRanges = this.indentExclusionRanges.slice();
        }
        cloned.sourcemapLocations = new BitSet(this.sourcemapLocations);
        cloned.intro = this.intro;
        cloned.outro = this.outro;
        return cloned;
      }
      generateDecodedMap(options) {
        options = options || {};
        const sourceIndex = 0;
        const names = Object.keys(this.storedNames);
        const mappings = new Mappings(options.hires);
        const locate = getLocator(this.original);
        if (this.intro) {
          mappings.advance(this.intro);
        }
        this.firstChunk.eachNext((chunk2) => {
          const loc = locate(chunk2.start);
          if (chunk2.intro.length) mappings.advance(chunk2.intro);
          if (chunk2.edited) {
            mappings.addEdit(
              sourceIndex,
              chunk2.content,
              loc,
              chunk2.storeName ? names.indexOf(chunk2.original) : -1
            );
          } else {
            mappings.addUneditedChunk(sourceIndex, chunk2, this.original, loc, this.sourcemapLocations);
          }
          if (chunk2.outro.length) mappings.advance(chunk2.outro);
        });
        if (this.outro) {
          mappings.advance(this.outro);
        }
        return {
          file: options.file ? options.file.split(/[/\\]/).pop() : void 0,
          sources: [
            options.source ? getRelativePath(options.file || "", options.source) : options.file || ""
          ],
          sourcesContent: options.includeContent ? [this.original] : void 0,
          names,
          mappings: mappings.raw,
          x_google_ignoreList: this.ignoreList ? [sourceIndex] : void 0
        };
      }
      generateMap(options) {
        return new SourceMap(this.generateDecodedMap(options));
      }
      _ensureindentStr() {
        if (this.indentStr === void 0) {
          this.indentStr = guessIndent(this.original);
        }
      }
      _getRawIndentString() {
        this._ensureindentStr();
        return this.indentStr;
      }
      getIndentString() {
        this._ensureindentStr();
        return this.indentStr === null ? "	" : this.indentStr;
      }
      indent(indentStr, options) {
        const pattern = /^[^\r\n]/gm;
        if (isObject4(indentStr)) {
          options = indentStr;
          indentStr = void 0;
        }
        if (indentStr === void 0) {
          this._ensureindentStr();
          indentStr = this.indentStr || "	";
        }
        if (indentStr === "") return this;
        options = options || {};
        const isExcluded = {};
        if (options.exclude) {
          const exclusions = typeof options.exclude[0] === "number" ? [options.exclude] : options.exclude;
          exclusions.forEach((exclusion) => {
            for (let i = exclusion[0]; i < exclusion[1]; i += 1) {
              isExcluded[i] = true;
            }
          });
        }
        let shouldIndentNextCharacter = options.indentStart !== false;
        const replacer = /* @__PURE__ */ __name((match) => {
          if (shouldIndentNextCharacter) return `${indentStr}${match}`;
          shouldIndentNextCharacter = true;
          return match;
        }, "replacer");
        this.intro = this.intro.replace(pattern, replacer);
        let charIndex = 0;
        let chunk2 = this.firstChunk;
        while (chunk2) {
          const end = chunk2.end;
          if (chunk2.edited) {
            if (!isExcluded[charIndex]) {
              chunk2.content = chunk2.content.replace(pattern, replacer);
              if (chunk2.content.length) {
                shouldIndentNextCharacter = chunk2.content[chunk2.content.length - 1] === "\n";
              }
            }
          } else {
            charIndex = chunk2.start;
            while (charIndex < end) {
              if (!isExcluded[charIndex]) {
                const char2 = this.original[charIndex];
                if (char2 === "\n") {
                  shouldIndentNextCharacter = true;
                } else if (char2 !== "\r" && shouldIndentNextCharacter) {
                  shouldIndentNextCharacter = false;
                  if (charIndex === chunk2.start) {
                    chunk2.prependRight(indentStr);
                  } else {
                    this._splitChunk(chunk2, charIndex);
                    chunk2 = chunk2.next;
                    chunk2.prependRight(indentStr);
                  }
                }
              }
              charIndex += 1;
            }
          }
          charIndex = chunk2.end;
          chunk2 = chunk2.next;
        }
        this.outro = this.outro.replace(pattern, replacer);
        return this;
      }
      insert() {
        throw new Error(
          "magicString.insert(...) is deprecated. Use prependRight(...) or appendLeft(...)"
        );
      }
      insertLeft(index2, content) {
        if (!warned.insertLeft) {
          console.warn(
            "magicString.insertLeft(...) is deprecated. Use magicString.appendLeft(...) instead"
          );
          warned.insertLeft = true;
        }
        return this.appendLeft(index2, content);
      }
      insertRight(index2, content) {
        if (!warned.insertRight) {
          console.warn(
            "magicString.insertRight(...) is deprecated. Use magicString.prependRight(...) instead"
          );
          warned.insertRight = true;
        }
        return this.prependRight(index2, content);
      }
      move(start, end, index2) {
        start = start + this.offset;
        end = end + this.offset;
        index2 = index2 + this.offset;
        if (index2 >= start && index2 <= end) throw new Error("Cannot move a selection inside itself");
        this._split(start);
        this._split(end);
        this._split(index2);
        const first = this.byStart[start];
        const last = this.byEnd[end];
        const oldLeft = first.previous;
        const oldRight = last.next;
        const newRight = this.byStart[index2];
        if (!newRight && last === this.lastChunk) return this;
        const newLeft = newRight ? newRight.previous : this.lastChunk;
        if (oldLeft) oldLeft.next = oldRight;
        if (oldRight) oldRight.previous = oldLeft;
        if (newLeft) newLeft.next = first;
        if (newRight) newRight.previous = last;
        if (!first.previous) this.firstChunk = last.next;
        if (!last.next) {
          this.lastChunk = first.previous;
          this.lastChunk.next = null;
        }
        first.previous = newLeft;
        last.next = newRight || null;
        if (!newLeft) this.firstChunk = first;
        if (!newRight) this.lastChunk = last;
        return this;
      }
      overwrite(start, end, content, options) {
        options = options || {};
        return this.update(start, end, content, { ...options, overwrite: !options.contentOnly });
      }
      update(start, end, content, options) {
        start = start + this.offset;
        end = end + this.offset;
        if (typeof content !== "string") throw new TypeError("replacement content must be a string");
        if (this.original.length !== 0) {
          while (start < 0) start += this.original.length;
          while (end < 0) end += this.original.length;
        }
        if (end > this.original.length) throw new Error("end is out of bounds");
        if (start === end)
          throw new Error(
            "Cannot overwrite a zero-length range \u2013 use appendLeft or prependRight instead"
          );
        this._split(start);
        this._split(end);
        if (options === true) {
          if (!warned.storeName) {
            console.warn(
              "The final argument to magicString.overwrite(...) should be an options object. See https://github.com/rich-harris/magic-string"
            );
            warned.storeName = true;
          }
          options = { storeName: true };
        }
        const storeName = options !== void 0 ? options.storeName : false;
        const overwrite = options !== void 0 ? options.overwrite : false;
        if (storeName) {
          const original = this.original.slice(start, end);
          Object.defineProperty(this.storedNames, original, {
            writable: true,
            value: true,
            enumerable: true
          });
        }
        const first = this.byStart[start];
        const last = this.byEnd[end];
        if (first) {
          let chunk2 = first;
          while (chunk2 !== last) {
            if (chunk2.next !== this.byStart[chunk2.end]) {
              throw new Error("Cannot overwrite across a split point");
            }
            chunk2 = chunk2.next;
            chunk2.edit("", false);
          }
          first.edit(content, storeName, !overwrite);
        } else {
          const newChunk = new Chunk(start, end, "").edit(content, storeName);
          last.next = newChunk;
          newChunk.previous = last;
        }
        return this;
      }
      prepend(content) {
        if (typeof content !== "string") throw new TypeError("outro content must be a string");
        this.intro = content + this.intro;
        return this;
      }
      prependLeft(index2, content) {
        index2 = index2 + this.offset;
        if (typeof content !== "string") throw new TypeError("inserted content must be a string");
        this._split(index2);
        const chunk2 = this.byEnd[index2];
        if (chunk2) {
          chunk2.prependLeft(content);
        } else {
          this.intro = content + this.intro;
        }
        return this;
      }
      prependRight(index2, content) {
        index2 = index2 + this.offset;
        if (typeof content !== "string") throw new TypeError("inserted content must be a string");
        this._split(index2);
        const chunk2 = this.byStart[index2];
        if (chunk2) {
          chunk2.prependRight(content);
        } else {
          this.outro = content + this.outro;
        }
        return this;
      }
      remove(start, end) {
        start = start + this.offset;
        end = end + this.offset;
        if (this.original.length !== 0) {
          while (start < 0) start += this.original.length;
          while (end < 0) end += this.original.length;
        }
        if (start === end) return this;
        if (start < 0 || end > this.original.length) throw new Error("Character is out of bounds");
        if (start > end) throw new Error("end must be greater than start");
        this._split(start);
        this._split(end);
        let chunk2 = this.byStart[start];
        while (chunk2) {
          chunk2.intro = "";
          chunk2.outro = "";
          chunk2.edit("");
          chunk2 = end > chunk2.end ? this.byStart[chunk2.end] : null;
        }
        return this;
      }
      reset(start, end) {
        start = start + this.offset;
        end = end + this.offset;
        if (this.original.length !== 0) {
          while (start < 0) start += this.original.length;
          while (end < 0) end += this.original.length;
        }
        if (start === end) return this;
        if (start < 0 || end > this.original.length) throw new Error("Character is out of bounds");
        if (start > end) throw new Error("end must be greater than start");
        this._split(start);
        this._split(end);
        let chunk2 = this.byStart[start];
        while (chunk2) {
          chunk2.reset();
          chunk2 = end > chunk2.end ? this.byStart[chunk2.end] : null;
        }
        return this;
      }
      lastChar() {
        if (this.outro.length) return this.outro[this.outro.length - 1];
        let chunk2 = this.lastChunk;
        do {
          if (chunk2.outro.length) return chunk2.outro[chunk2.outro.length - 1];
          if (chunk2.content.length) return chunk2.content[chunk2.content.length - 1];
          if (chunk2.intro.length) return chunk2.intro[chunk2.intro.length - 1];
        } while (chunk2 = chunk2.previous);
        if (this.intro.length) return this.intro[this.intro.length - 1];
        return "";
      }
      lastLine() {
        let lineIndex = this.outro.lastIndexOf(n);
        if (lineIndex !== -1) return this.outro.substr(lineIndex + 1);
        let lineStr = this.outro;
        let chunk2 = this.lastChunk;
        do {
          if (chunk2.outro.length > 0) {
            lineIndex = chunk2.outro.lastIndexOf(n);
            if (lineIndex !== -1) return chunk2.outro.substr(lineIndex + 1) + lineStr;
            lineStr = chunk2.outro + lineStr;
          }
          if (chunk2.content.length > 0) {
            lineIndex = chunk2.content.lastIndexOf(n);
            if (lineIndex !== -1) return chunk2.content.substr(lineIndex + 1) + lineStr;
            lineStr = chunk2.content + lineStr;
          }
          if (chunk2.intro.length > 0) {
            lineIndex = chunk2.intro.lastIndexOf(n);
            if (lineIndex !== -1) return chunk2.intro.substr(lineIndex + 1) + lineStr;
            lineStr = chunk2.intro + lineStr;
          }
        } while (chunk2 = chunk2.previous);
        lineIndex = this.intro.lastIndexOf(n);
        if (lineIndex !== -1) return this.intro.substr(lineIndex + 1) + lineStr;
        return this.intro + lineStr;
      }
      slice(start = 0, end = this.original.length - this.offset) {
        start = start + this.offset;
        end = end + this.offset;
        if (this.original.length !== 0) {
          while (start < 0) start += this.original.length;
          while (end < 0) end += this.original.length;
        }
        let result = "";
        let chunk2 = this.firstChunk;
        while (chunk2 && (chunk2.start > start || chunk2.end <= start)) {
          if (chunk2.start < end && chunk2.end >= end) {
            return result;
          }
          chunk2 = chunk2.next;
        }
        if (chunk2 && chunk2.edited && chunk2.start !== start)
          throw new Error(`Cannot use replaced character ${start} as slice start anchor.`);
        const startChunk = chunk2;
        while (chunk2) {
          if (chunk2.intro && (startChunk !== chunk2 || chunk2.start === start)) {
            result += chunk2.intro;
          }
          const containsEnd = chunk2.start < end && chunk2.end >= end;
          if (containsEnd && chunk2.edited && chunk2.end !== end)
            throw new Error(`Cannot use replaced character ${end} as slice end anchor.`);
          const sliceStart = startChunk === chunk2 ? start - chunk2.start : 0;
          const sliceEnd = containsEnd ? chunk2.content.length + end - chunk2.end : chunk2.content.length;
          result += chunk2.content.slice(sliceStart, sliceEnd);
          if (chunk2.outro && (!containsEnd || chunk2.end === end)) {
            result += chunk2.outro;
          }
          if (containsEnd) {
            break;
          }
          chunk2 = chunk2.next;
        }
        return result;
      }
      // TODO deprecate this? not really very useful
      snip(start, end) {
        const clone2 = this.clone();
        clone2.remove(0, start);
        clone2.remove(end, clone2.original.length);
        return clone2;
      }
      _split(index2) {
        if (this.byStart[index2] || this.byEnd[index2]) return;
        let chunk2 = this.lastSearchedChunk;
        let previousChunk = chunk2;
        const searchForward = index2 > chunk2.end;
        while (chunk2) {
          if (chunk2.contains(index2)) return this._splitChunk(chunk2, index2);
          chunk2 = searchForward ? this.byStart[chunk2.end] : this.byEnd[chunk2.start];
          if (chunk2 === previousChunk) return;
          previousChunk = chunk2;
        }
      }
      _splitChunk(chunk2, index2) {
        if (chunk2.edited && chunk2.content.length) {
          const loc = getLocator(this.original)(index2);
          throw new Error(
            `Cannot split a chunk that has already been edited (${loc.line}:${loc.column} \u2013 "${chunk2.original}")`
          );
        }
        const newChunk = chunk2.split(index2);
        this.byEnd[index2] = chunk2;
        this.byStart[index2] = newChunk;
        this.byEnd[newChunk.end] = newChunk;
        if (chunk2 === this.lastChunk) this.lastChunk = newChunk;
        this.lastSearchedChunk = chunk2;
        return true;
      }
      toString() {
        let str = this.intro;
        let chunk2 = this.firstChunk;
        while (chunk2) {
          str += chunk2.toString();
          chunk2 = chunk2.next;
        }
        return str + this.outro;
      }
      isEmpty() {
        let chunk2 = this.firstChunk;
        do {
          if (chunk2.intro.length && chunk2.intro.trim() || chunk2.content.length && chunk2.content.trim() || chunk2.outro.length && chunk2.outro.trim())
            return false;
        } while (chunk2 = chunk2.next);
        return true;
      }
      length() {
        let chunk2 = this.firstChunk;
        let length = 0;
        do {
          length += chunk2.intro.length + chunk2.content.length + chunk2.outro.length;
        } while (chunk2 = chunk2.next);
        return length;
      }
      trimLines() {
        return this.trim("[\\r\\n]");
      }
      trim(charType) {
        return this.trimStart(charType).trimEnd(charType);
      }
      trimEndAborted(charType) {
        const rx = new RegExp((charType || "\\s") + "+$");
        this.outro = this.outro.replace(rx, "");
        if (this.outro.length) return true;
        let chunk2 = this.lastChunk;
        do {
          const end = chunk2.end;
          const aborted2 = chunk2.trimEnd(rx);
          if (chunk2.end !== end) {
            if (this.lastChunk === chunk2) {
              this.lastChunk = chunk2.next;
            }
            this.byEnd[chunk2.end] = chunk2;
            this.byStart[chunk2.next.start] = chunk2.next;
            this.byEnd[chunk2.next.end] = chunk2.next;
          }
          if (aborted2) return true;
          chunk2 = chunk2.previous;
        } while (chunk2);
        return false;
      }
      trimEnd(charType) {
        this.trimEndAborted(charType);
        return this;
      }
      trimStartAborted(charType) {
        const rx = new RegExp("^" + (charType || "\\s") + "+");
        this.intro = this.intro.replace(rx, "");
        if (this.intro.length) return true;
        let chunk2 = this.firstChunk;
        do {
          const end = chunk2.end;
          const aborted2 = chunk2.trimStart(rx);
          if (chunk2.end !== end) {
            if (chunk2 === this.lastChunk) this.lastChunk = chunk2.next;
            this.byEnd[chunk2.end] = chunk2;
            this.byStart[chunk2.next.start] = chunk2.next;
            this.byEnd[chunk2.next.end] = chunk2.next;
          }
          if (aborted2) return true;
          chunk2 = chunk2.next;
        } while (chunk2);
        return false;
      }
      trimStart(charType) {
        this.trimStartAborted(charType);
        return this;
      }
      hasChanged() {
        return this.original !== this.toString();
      }
      _replaceRegexp(searchValue, replacement) {
        function getReplacement(match, str) {
          if (typeof replacement === "string") {
            return replacement.replace(/\$(\$|&|\d+)/g, (_, i) => {
              if (i === "$") return "$";
              if (i === "&") return match[0];
              const num = +i;
              if (num < match.length) return match[+i];
              return `$${i}`;
            });
          } else {
            return replacement(...match, match.index, str, match.groups);
          }
        }
        __name(getReplacement, "getReplacement");
        function matchAll2(re, str) {
          let match;
          const matches = [];
          while (match = re.exec(str)) {
            matches.push(match);
          }
          return matches;
        }
        __name(matchAll2, "matchAll");
        if (searchValue.global) {
          const matches = matchAll2(searchValue, this.original);
          matches.forEach((match) => {
            if (match.index != null) {
              const replacement2 = getReplacement(match, this.original);
              if (replacement2 !== match[0]) {
                this.overwrite(match.index, match.index + match[0].length, replacement2);
              }
            }
          });
        } else {
          const match = this.original.match(searchValue);
          if (match && match.index != null) {
            const replacement2 = getReplacement(match, this.original);
            if (replacement2 !== match[0]) {
              this.overwrite(match.index, match.index + match[0].length, replacement2);
            }
          }
        }
        return this;
      }
      _replaceString(string4, replacement) {
        const { original } = this;
        const index2 = original.indexOf(string4);
        if (index2 !== -1) {
          if (typeof replacement === "function") {
            replacement = replacement(string4, index2, original);
          }
          if (string4 !== replacement) {
            this.overwrite(index2, index2 + string4.length, replacement);
          }
        }
        return this;
      }
      replace(searchValue, replacement) {
        if (typeof searchValue === "string") {
          return this._replaceString(searchValue, replacement);
        }
        return this._replaceRegexp(searchValue, replacement);
      }
      _replaceAllString(string4, replacement) {
        const { original } = this;
        const stringLength = string4.length;
        for (let index2 = original.indexOf(string4); index2 !== -1; index2 = original.indexOf(string4, index2 + stringLength)) {
          const previous = original.slice(index2, index2 + stringLength);
          let _replacement = replacement;
          if (typeof replacement === "function") {
            _replacement = replacement(previous, index2, original);
          }
          if (previous !== _replacement) this.overwrite(index2, index2 + stringLength, _replacement);
        }
        return this;
      }
      replaceAll(searchValue, replacement) {
        if (typeof searchValue === "string") {
          return this._replaceAllString(searchValue, replacement);
        }
        if (!searchValue.global) {
          throw new TypeError(
            "MagicString.prototype.replaceAll called with a non-global RegExp argument"
          );
        }
        return this._replaceRegexp(searchValue, replacement);
      }
    };
    var hasOwnProp = Object.prototype.hasOwnProperty;
    var Bundle = class _Bundle {
      static {
        __name(this, "Bundle");
      }
      constructor(options = {}) {
        this.intro = options.intro || "";
        this.separator = options.separator !== void 0 ? options.separator : "\n";
        this.sources = [];
        this.uniqueSources = [];
        this.uniqueSourceIndexByFilename = {};
      }
      addSource(source) {
        if (source instanceof MagicString) {
          return this.addSource({
            content: source,
            filename: source.filename,
            separator: this.separator
          });
        }
        if (!isObject4(source) || !source.content) {
          throw new Error(
            "bundle.addSource() takes an object with a `content` property, which should be an instance of MagicString, and an optional `filename`"
          );
        }
        ["filename", "ignoreList", "indentExclusionRanges", "separator"].forEach((option) => {
          if (!hasOwnProp.call(source, option)) source[option] = source.content[option];
        });
        if (source.separator === void 0) {
          source.separator = this.separator;
        }
        if (source.filename) {
          if (!hasOwnProp.call(this.uniqueSourceIndexByFilename, source.filename)) {
            this.uniqueSourceIndexByFilename[source.filename] = this.uniqueSources.length;
            this.uniqueSources.push({ filename: source.filename, content: source.content.original });
          } else {
            const uniqueSource = this.uniqueSources[this.uniqueSourceIndexByFilename[source.filename]];
            if (source.content.original !== uniqueSource.content) {
              throw new Error(`Illegal source: same filename (${source.filename}), different contents`);
            }
          }
        }
        this.sources.push(source);
        return this;
      }
      append(str, options) {
        this.addSource({
          content: new MagicString(str),
          separator: options && options.separator || ""
        });
        return this;
      }
      clone() {
        const bundle = new _Bundle({
          intro: this.intro,
          separator: this.separator
        });
        this.sources.forEach((source) => {
          bundle.addSource({
            filename: source.filename,
            content: source.content.clone(),
            separator: source.separator
          });
        });
        return bundle;
      }
      generateDecodedMap(options = {}) {
        const names = [];
        let x_google_ignoreList = void 0;
        this.sources.forEach((source) => {
          Object.keys(source.content.storedNames).forEach((name2) => {
            if (!~names.indexOf(name2)) names.push(name2);
          });
        });
        const mappings = new Mappings(options.hires);
        if (this.intro) {
          mappings.advance(this.intro);
        }
        this.sources.forEach((source, i) => {
          if (i > 0) {
            mappings.advance(this.separator);
          }
          const sourceIndex = source.filename ? this.uniqueSourceIndexByFilename[source.filename] : -1;
          const magicString = source.content;
          const locate = getLocator(magicString.original);
          if (magicString.intro) {
            mappings.advance(magicString.intro);
          }
          magicString.firstChunk.eachNext((chunk2) => {
            const loc = locate(chunk2.start);
            if (chunk2.intro.length) mappings.advance(chunk2.intro);
            if (source.filename) {
              if (chunk2.edited) {
                mappings.addEdit(
                  sourceIndex,
                  chunk2.content,
                  loc,
                  chunk2.storeName ? names.indexOf(chunk2.original) : -1
                );
              } else {
                mappings.addUneditedChunk(
                  sourceIndex,
                  chunk2,
                  magicString.original,
                  loc,
                  magicString.sourcemapLocations
                );
              }
            } else {
              mappings.advance(chunk2.content);
            }
            if (chunk2.outro.length) mappings.advance(chunk2.outro);
          });
          if (magicString.outro) {
            mappings.advance(magicString.outro);
          }
          if (source.ignoreList && sourceIndex !== -1) {
            if (x_google_ignoreList === void 0) {
              x_google_ignoreList = [];
            }
            x_google_ignoreList.push(sourceIndex);
          }
        });
        return {
          file: options.file ? options.file.split(/[/\\]/).pop() : void 0,
          sources: this.uniqueSources.map((source) => {
            return options.file ? getRelativePath(options.file, source.filename) : source.filename;
          }),
          sourcesContent: this.uniqueSources.map((source) => {
            return options.includeContent ? source.content : null;
          }),
          names,
          mappings: mappings.raw,
          x_google_ignoreList
        };
      }
      generateMap(options) {
        return new SourceMap(this.generateDecodedMap(options));
      }
      getIndentString() {
        const indentStringCounts = {};
        this.sources.forEach((source) => {
          const indentStr = source.content._getRawIndentString();
          if (indentStr === null) return;
          if (!indentStringCounts[indentStr]) indentStringCounts[indentStr] = 0;
          indentStringCounts[indentStr] += 1;
        });
        return Object.keys(indentStringCounts).sort((a, b) => {
          return indentStringCounts[a] - indentStringCounts[b];
        })[0] || "	";
      }
      indent(indentStr) {
        if (!arguments.length) {
          indentStr = this.getIndentString();
        }
        if (indentStr === "") return this;
        let trailingNewline = !this.intro || this.intro.slice(-1) === "\n";
        this.sources.forEach((source, i) => {
          const separator = source.separator !== void 0 ? source.separator : this.separator;
          const indentStart = trailingNewline || i > 0 && /\r?\n$/.test(separator);
          source.content.indent(indentStr, {
            exclude: source.indentExclusionRanges,
            indentStart
            //: trailingNewline || /\r?\n$/.test( separator )  //true///\r?\n/.test( separator )
          });
          trailingNewline = source.content.lastChar() === "\n";
        });
        if (this.intro) {
          this.intro = indentStr + this.intro.replace(/^[^\n]/gm, (match, index2) => {
            return index2 > 0 ? indentStr + match : match;
          });
        }
        return this;
      }
      prepend(str) {
        this.intro = str + this.intro;
        return this;
      }
      toString() {
        const body = this.sources.map((source, i) => {
          const separator = source.separator !== void 0 ? source.separator : this.separator;
          const str = (i > 0 ? separator : "") + source.content.toString();
          return str;
        }).join("");
        return this.intro + body;
      }
      isEmpty() {
        if (this.intro.length && this.intro.trim()) return false;
        if (this.sources.some((source) => !source.content.isEmpty())) return false;
        return true;
      }
      length() {
        return this.sources.reduce(
          (length, source) => length + source.content.length(),
          this.intro.length
        );
      }
      trimLines() {
        return this.trim("[\\r\\n]");
      }
      trim(charType) {
        return this.trimStart(charType).trimEnd(charType);
      }
      trimStart(charType) {
        const rx = new RegExp("^" + (charType || "\\s") + "+");
        this.intro = this.intro.replace(rx, "");
        if (!this.intro) {
          let source;
          let i = 0;
          do {
            source = this.sources[i++];
            if (!source) {
              break;
            }
          } while (!source.content.trimStartAborted(charType));
        }
        return this;
      }
      trimEnd(charType) {
        const rx = new RegExp((charType || "\\s") + "+$");
        let source;
        let i = this.sources.length - 1;
        do {
          source = this.sources[i--];
          if (!source) {
            this.intro = this.intro.replace(rx, "");
            break;
          }
        } while (!source.content.trimEndAborted(charType));
        return this;
      }
    };
    MagicString.Bundle = Bundle;
    MagicString.SourceMap = SourceMap;
    MagicString.default = MagicString;
    module2.exports = MagicString;
  }
});

// node_modules/estree-walker/dist/umd/estree-walker.js
var require_estree_walker = __commonJS({
  "node_modules/estree-walker/dist/umd/estree-walker.js"(exports2, module2) {
    (function(global2, factory2) {
      typeof exports2 === "object" && typeof module2 !== "undefined" ? factory2(exports2) : typeof define === "function" && define.amd ? define(["exports"], factory2) : (global2 = global2 || self, factory2(global2.estreeWalker = {}));
    })(exports2, (function(exports3) {
      "use strict";
      class WalkerBase {
        static {
          __name(this, "WalkerBase");
        }
        constructor() {
          this.should_skip = false;
          this.should_remove = false;
          this.replacement = null;
          this.context = {
            skip: /* @__PURE__ */ __name(() => this.should_skip = true, "skip"),
            remove: /* @__PURE__ */ __name(() => this.should_remove = true, "remove"),
            replace: /* @__PURE__ */ __name((node) => this.replacement = node, "replace")
          };
        }
        /**
         *
         * @param {any} parent
         * @param {string} prop
         * @param {number} index
         * @param {BaseNode} node
         */
        replace(parent, prop, index2, node) {
          if (parent) {
            if (index2 !== null) {
              parent[prop][index2] = node;
            } else {
              parent[prop] = node;
            }
          }
        }
        /**
         *
         * @param {any} parent
         * @param {string} prop
         * @param {number} index
         */
        remove(parent, prop, index2) {
          if (parent) {
            if (index2 !== null) {
              parent[prop].splice(index2, 1);
            } else {
              delete parent[prop];
            }
          }
        }
      }
      class SyncWalker extends WalkerBase {
        static {
          __name(this, "SyncWalker");
        }
        /**
         *
         * @param {SyncHandler} enter
         * @param {SyncHandler} leave
         */
        constructor(enter, leave) {
          super();
          this.enter = enter;
          this.leave = leave;
        }
        /**
         *
         * @param {BaseNode} node
         * @param {BaseNode} parent
         * @param {string} [prop]
         * @param {number} [index]
         * @returns {BaseNode}
         */
        visit(node, parent, prop, index2) {
          if (node) {
            if (this.enter) {
              const _should_skip = this.should_skip;
              const _should_remove = this.should_remove;
              const _replacement = this.replacement;
              this.should_skip = false;
              this.should_remove = false;
              this.replacement = null;
              this.enter.call(this.context, node, parent, prop, index2);
              if (this.replacement) {
                node = this.replacement;
                this.replace(parent, prop, index2, node);
              }
              if (this.should_remove) {
                this.remove(parent, prop, index2);
              }
              const skipped = this.should_skip;
              const removed = this.should_remove;
              this.should_skip = _should_skip;
              this.should_remove = _should_remove;
              this.replacement = _replacement;
              if (skipped) return node;
              if (removed) return null;
            }
            for (const key in node) {
              const value = node[key];
              if (typeof value !== "object") {
                continue;
              } else if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i += 1) {
                  if (value[i] !== null && typeof value[i].type === "string") {
                    if (!this.visit(value[i], node, key, i)) {
                      i--;
                    }
                  }
                }
              } else if (value !== null && typeof value.type === "string") {
                this.visit(value, node, key, null);
              }
            }
            if (this.leave) {
              const _replacement = this.replacement;
              const _should_remove = this.should_remove;
              this.replacement = null;
              this.should_remove = false;
              this.leave.call(this.context, node, parent, prop, index2);
              if (this.replacement) {
                node = this.replacement;
                this.replace(parent, prop, index2, node);
              }
              if (this.should_remove) {
                this.remove(parent, prop, index2);
              }
              const removed = this.should_remove;
              this.replacement = _replacement;
              this.should_remove = _should_remove;
              if (removed) return null;
            }
          }
          return node;
        }
      }
      class AsyncWalker extends WalkerBase {
        static {
          __name(this, "AsyncWalker");
        }
        /**
         *
         * @param {AsyncHandler} enter
         * @param {AsyncHandler} leave
         */
        constructor(enter, leave) {
          super();
          this.enter = enter;
          this.leave = leave;
        }
        /**
         *
         * @param {BaseNode} node
         * @param {BaseNode} parent
         * @param {string} [prop]
         * @param {number} [index]
         * @returns {Promise<BaseNode>}
         */
        async visit(node, parent, prop, index2) {
          if (node) {
            if (this.enter) {
              const _should_skip = this.should_skip;
              const _should_remove = this.should_remove;
              const _replacement = this.replacement;
              this.should_skip = false;
              this.should_remove = false;
              this.replacement = null;
              await this.enter.call(this.context, node, parent, prop, index2);
              if (this.replacement) {
                node = this.replacement;
                this.replace(parent, prop, index2, node);
              }
              if (this.should_remove) {
                this.remove(parent, prop, index2);
              }
              const skipped = this.should_skip;
              const removed = this.should_remove;
              this.should_skip = _should_skip;
              this.should_remove = _should_remove;
              this.replacement = _replacement;
              if (skipped) return node;
              if (removed) return null;
            }
            for (const key in node) {
              const value = node[key];
              if (typeof value !== "object") {
                continue;
              } else if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i += 1) {
                  if (value[i] !== null && typeof value[i].type === "string") {
                    if (!await this.visit(value[i], node, key, i)) {
                      i--;
                    }
                  }
                }
              } else if (value !== null && typeof value.type === "string") {
                await this.visit(value, node, key, null);
              }
            }
            if (this.leave) {
              const _replacement = this.replacement;
              const _should_remove = this.should_remove;
              this.replacement = null;
              this.should_remove = false;
              await this.leave.call(this.context, node, parent, prop, index2);
              if (this.replacement) {
                node = this.replacement;
                this.replace(parent, prop, index2, node);
              }
              if (this.should_remove) {
                this.remove(parent, prop, index2);
              }
              const removed = this.should_remove;
              this.replacement = _replacement;
              this.should_remove = _should_remove;
              if (removed) return null;
            }
          }
          return node;
        }
      }
      function walk(ast, { enter, leave }) {
        const instance2 = new SyncWalker(enter, leave);
        return instance2.visit(ast, null);
      }
      __name(walk, "walk");
      async function asyncWalk(ast, { enter, leave }) {
        const instance2 = new AsyncWalker(enter, leave);
        return await instance2.visit(ast, null);
      }
      __name(asyncWalk, "asyncWalk");
      exports3.asyncWalk = asyncWalk;
      exports3.walk = walk;
      Object.defineProperty(exports3, "__esModule", { value: true });
    }));
  }
});

// node_modules/@builder.io/jsx-loc-internals/dist/index.js
var require_dist3 = __commonJS({
  "node_modules/@builder.io/jsx-loc-internals/dist/index.js"(exports2, module2) {
    "use strict";
    var __create3 = Object.create;
    var __defProp3 = Object.defineProperty;
    var __getOwnPropDesc3 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames3 = Object.getOwnPropertyNames;
    var __getProtoOf3 = Object.getPrototypeOf;
    var __hasOwnProp3 = Object.prototype.hasOwnProperty;
    var __export2 = /* @__PURE__ */ __name((target, all3) => {
      for (var name2 in all3)
        __defProp3(target, name2, { get: all3[name2], enumerable: true });
    }, "__export");
    var __copyProps3 = /* @__PURE__ */ __name((to, from, except2, desc29) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames3(from))
          if (!__hasOwnProp3.call(to, key) && key !== except2)
            __defProp3(to, key, { get: /* @__PURE__ */ __name(() => from[key], "get"), enumerable: !(desc29 = __getOwnPropDesc3(from, key)) || desc29.enumerable });
      }
      return to;
    }, "__copyProps");
    var __toESM3 = /* @__PURE__ */ __name((mod, isNodeMode, target) => (target = mod != null ? __create3(__getProtoOf3(mod)) : {}, __copyProps3(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp3(target, "default", { value: mod, enumerable: true }) : target,
      mod
    )), "__toESM");
    var __toCommonJS2 = /* @__PURE__ */ __name((mod) => __copyProps3(__defProp3({}, "__esModule", { value: true }), mod), "__toCommonJS");
    var index_exports2 = {};
    __export2(index_exports2, {
      defaultParserOptions: /* @__PURE__ */ __name(() => defaultParserOptions, "defaultParserOptions"),
      findInsertionPoint: /* @__PURE__ */ __name(() => findInsertionPoint, "findInsertionPoint"),
      getElementName: /* @__PURE__ */ __name(() => getElementName, "getElementName"),
      isValidJsxNode: /* @__PURE__ */ __name(() => isValidJsxNode, "isValidJsxNode"),
      shouldProcessFile: /* @__PURE__ */ __name(() => shouldProcessFile, "shouldProcessFile"),
      shouldSkipElement: /* @__PURE__ */ __name(() => shouldSkipElement, "shouldSkipElement"),
      transformJsxCode: /* @__PURE__ */ __name(() => transformJsxCode, "transformJsxCode"),
      validExtensions: /* @__PURE__ */ __name(() => validExtensions, "validExtensions")
    });
    module2.exports = __toCommonJS2(index_exports2);
    var import_parser = require("@babel/parser");
    var import_magic_string = __toESM3(require_magic_string_cjs());
    var import_path2 = __toESM3(require("path"));
    var import_estree_walker = require_estree_walker();
    var defaultParserOptions = {
      sourceType: "module",
      plugins: [
        // JSX support
        "jsx",
        // TypeScript support
        "typescript",
        // Class features
        "decorators-legacy",
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "classStaticBlock",
        // Modern JS features
        "dynamicImport",
        "nullishCoalescingOperator",
        "optionalChaining",
        "objectRestSpread",
        "optionalCatchBinding",
        "asyncGenerators",
        "bigInt",
        "importAssertions",
        "importMeta",
        "numericSeparator",
        "privateIn",
        "topLevelAwait"
      ],
      allowImportExportEverywhere: true,
      errorRecovery: true
      // Try to continue parsing even if there are errors
    };
    var validExtensions = /* @__PURE__ */ new Set([".jsx", ".tsx"]);
    function getElementName(jsxNode) {
      try {
        if (!jsxNode.name) return null;
        if (jsxNode.name.type === "JSXIdentifier") {
          return jsxNode.name.name;
        } else if (jsxNode.name.type === "JSXMemberExpression") {
          const getMemberName = /* @__PURE__ */ __name((expr) => {
            if (expr.type === "JSXMemberExpression") {
              return `${getMemberName(expr.object)}.${expr.property.name}`;
            } else {
              return expr.name;
            }
          }, "getMemberName");
          return getMemberName(jsxNode.name);
        } else if (jsxNode.name.type === "JSXNamespacedName") {
          return `${jsxNode.name.namespace.name}:${jsxNode.name.name.name}`;
        }
      } catch (error48) {
        return null;
      }
      return null;
    }
    __name(getElementName, "getElementName");
    function shouldSkipElement(elementName) {
      if (!elementName) return true;
      if (elementName === "Fragment" || elementName.endsWith(".Fragment") || elementName === "React.Fragment") {
        return true;
      }
      return false;
    }
    __name(shouldSkipElement, "shouldSkipElement");
    function isValidJsxNode(node) {
      return node && node.type === "JSXOpeningElement" && node.name && node.loc && node.loc.start && typeof node.loc.start.line === "number";
    }
    __name(isValidJsxNode, "isValidJsxNode");
    function findInsertionPoint(jsxNode, source) {
      let insertionPoint = jsxNode.name.end;
      if (source[insertionPoint] === "<") {
        let depth = 0;
        let inGeneric = false;
        let pos = insertionPoint;
        while (pos < jsxNode.end) {
          if (source[pos] === "<") {
            depth++;
            inGeneric = true;
          } else if (source[pos] === ">") {
            depth--;
            if (depth === 0 && inGeneric) {
              insertionPoint = pos + 1;
              break;
            }
          } else if (source[pos] === "{" && !inGeneric) {
            break;
          } else if (source[pos] === " " && !inGeneric) {
            break;
          }
          pos++;
        }
      }
      return insertionPoint;
    }
    __name(findInsertionPoint, "findInsertionPoint");
    function transformJsxCode(source, filePath, options = {}) {
      try {
        const parserOptions = options.parserOptions || defaultParserOptions;
        const ast = (0, import_parser.parse)(source, parserOptions);
        const magicString = new import_magic_string.default(source);
        const resourcePath = filePath;
        (0, import_estree_walker.walk)(ast, {
          enter(node) {
            if (node.type === "JSXOpeningElement") {
              try {
                const jsxNode = node;
                if (!isValidJsxNode(jsxNode)) {
                  return;
                }
                const elementName = getElementName(jsxNode);
                if (shouldSkipElement(elementName)) {
                  return;
                }
                const line = jsxNode.loc.start.line;
                const relativePath = import_path2.default.relative(process.cwd(), resourcePath);
                const dataLoc = `${relativePath}:${line}`;
                if (jsxNode.name && jsxNode.name.end) {
                  const insertionPoint = findInsertionPoint(jsxNode, source);
                  magicString.appendLeft(insertionPoint, ` data-loc="${dataLoc}"`);
                }
              } catch (error48) {
                console.error(`Error processing JSX node:`, error48);
              }
            }
          }
        });
        return {
          code: magicString.toString(),
          map: magicString.generateMap({ hires: true })
        };
      } catch (error48) {
        console.error(`Error processing file ${filePath}:`, error48);
        return null;
      }
    }
    __name(transformJsxCode, "transformJsxCode");
    function shouldProcessFile(filePath) {
      const ext = import_path2.default.extname(filePath);
      return validExtensions.has(ext) && !filePath.includes("node_modules");
    }
    __name(shouldProcessFile, "shouldProcessFile");
  }
});

// node_modules/@builder.io/vite-plugin-jsx-loc/dist/index.js
var require_dist4 = __commonJS({
  "node_modules/@builder.io/vite-plugin-jsx-loc/dist/index.js"(exports2, module2) {
    "use strict";
    var __defProp3 = Object.defineProperty;
    var __getOwnPropDesc3 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames3 = Object.getOwnPropertyNames;
    var __hasOwnProp3 = Object.prototype.hasOwnProperty;
    var __export2 = /* @__PURE__ */ __name((target, all3) => {
      for (var name2 in all3)
        __defProp3(target, name2, { get: all3[name2], enumerable: true });
    }, "__export");
    var __copyProps3 = /* @__PURE__ */ __name((to, from, except2, desc29) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames3(from))
          if (!__hasOwnProp3.call(to, key) && key !== except2)
            __defProp3(to, key, { get: /* @__PURE__ */ __name(() => from[key], "get"), enumerable: !(desc29 = __getOwnPropDesc3(from, key)) || desc29.enumerable });
      }
      return to;
    }, "__copyProps");
    var __toCommonJS2 = /* @__PURE__ */ __name((mod) => __copyProps3(__defProp3({}, "__esModule", { value: true }), mod), "__toCommonJS");
    var index_exports2 = {};
    __export2(index_exports2, {
      jsxLocPlugin: /* @__PURE__ */ __name(() => jsxLocPlugin, "jsxLocPlugin")
    });
    module2.exports = __toCommonJS2(index_exports2);
    var import_jsx_loc_internals = require_dist3();
    function jsxLocPlugin() {
      return {
        name: "vite-plugin-jsx-loc",
        enforce: "pre",
        async transform(code, id) {
          if (!(0, import_jsx_loc_internals.shouldProcessFile)(id)) {
            return null;
          }
          const result = (0, import_jsx_loc_internals.transformJsxCode)(code, id);
          return result;
        }
      };
    }
    __name(jsxLocPlugin, "jsxLocPlugin");
  }
});

// node_modules/vite-plugin-manus-runtime/dist/index.js
var dist_exports3 = {};
__export(dist_exports3, {
  vitePluginManusRuntime: () => vitePluginManusRuntime
});
function loadContentSource() {
  if (cachedContentSource === void 0) {
    cachedContentSource = fs2.readFileSync(RUNTIME_FILE_PATH, "utf8");
  }
  return cachedContentSource;
}
function vitePluginManusRuntime(options = {}) {
  const scriptId = options.scriptId || DEFAULT_SCRIPT_ID;
  const injectTo = options.injectTo || "body-prepend";
  return {
    name: "vite-plugin-manus-runtime",
    enforce: "post",
    transformIndexHtml(_, ctx) {
      const isHostDev = ctx.server !== void 0;
      return [
        {
          tag: "script",
          attrs: { id: scriptId },
          children: `window.__MANUS_HOST_DEV__ = ${isHostDev};
${loadContentSource()}`,
          injectTo
        }
      ];
    }
  };
}
var fs2, import_meta2, RUNTIME_FILE_PATH, DEFAULT_SCRIPT_ID, cachedContentSource;
var init_dist5 = __esm({
  "node_modules/vite-plugin-manus-runtime/dist/index.js"() {
    fs2 = __toESM(require("node:fs"), 1);
    import_meta2 = {};
    RUNTIME_FILE_PATH = new URL("../runtime_dist/manus-runtime.js", import_meta2.url);
    DEFAULT_SCRIPT_ID = "manus-runtime";
    __name(loadContentSource, "loadContentSource");
    __name(vitePluginManusRuntime, "vitePluginManusRuntime");
  }
});

