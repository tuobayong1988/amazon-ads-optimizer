import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

/**
 * v268 性能优化: 全局QueryClient缓存策略
 * 
 * staleTime: 数据在多长时间内被认为是"新鲜的"，不会触发后台重新获取
 *   - 设为2分钟，避免频繁的重复请求（默认是0，每次组件挂载都请求）
 * gcTime: 数据在缓存中保留多长时间（即使已过期）
 *   - 设为10分钟，账号切换回来时可以立即显示缓存数据
 * refetchOnWindowFocus: 窗口获得焦点时是否重新获取
 *   - 设为false，避免切换标签页时大量请求
 * retry: 失败重试次数
 *   - 设为1次，减少失败时的等待时间
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,        // 2分钟内数据视为新鲜
      gcTime: 10 * 60 * 1000,           // 缓存保留10分钟
      refetchOnWindowFocus: false,       // 禁止窗口聚焦时自动刷新
      refetchOnReconnect: 'always',      // 网络恢复时刷新
      retry: 1,                          // 最多重试1次
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // v481: 不在注册页面、登录页面和营销页面触发重定向
  // 这些页面允许未登录用户访问，不应因为某些publicProcedure调用失败而跳转
  const publicPaths = ['/register', '/login', '/local-login', '/landing', '/how-it-works', '/contact', '/blog', '/onboarding', '/seller-onboarding'];
  const currentPath = window.location.pathname;
  if (publicPaths.some(p => currentPath.startsWith(p))) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/**
 * v261: 统一的fetch函数 — 确保所有trpc请求（包括batch和非batch）都携带Authorization头
 * 
 * 问题背景: httpBatchLink在某些情况下会发出非batch请求（如延迟加载的查询），
 * 这些请求虽然经过自定义fetch，但如果trpc内部在某些路径下绕过了batch机制，
 * 就可能导致认证失败（401）。通过在fetch层统一注入token，确保所有请求都能通过认证。
 */
const authenticatedFetch: typeof globalThis.fetch = (input, init) => {
  const token = localStorage.getItem('authToken');
  // @ts-ignore
  const headers = new Headers((init as unknown)?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
    headers,
  });
};

const NON_BATCHED_QUERY_PATHS = new Set([
  // v785: 首页首屏关键接口单独请求，避免被慢查询拖住整个 tRPC batch 响应。
  'analytics.getKPIs',
  'analytics.getTrendData',
  // v785: 跨区域、监控和归因接口查询成本较高，也不应与关键 KPI 合批。
  'analytics.getRegionComparison',
  'monitoring.getHealthMetrics',
  'monitoring.getDeployCorrectionReport',
  'specialScenario.getAttributionAdjustedData',
]);

const createHttpLink = () => httpLink({
  url: "/api/trpc",
  transformer: superjson,
  fetch: authenticatedFetch,
});

const createHttpBatchLink = () => httpBatchLink({
  url: "/api/trpc",
  transformer: superjson,
  fetch: authenticatedFetch,
  /**
   * v261: 增加maxURLLength限制
   * 当URL超过此长度时，httpBatchLink会将请求拆分为多个较小的batch
   * 这确保了即使拆分后的请求也会经过authenticatedFetch
   */
  maxURLLength: 2083,
});

const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition(op) {
        return NON_BATCHED_QUERY_PATHS.has(op.path);
      },
      true: createHttpLink(),
      false: createHttpBatchLink(),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
